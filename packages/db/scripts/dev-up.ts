#!/usr/bin/env bun
import { type SpawnSyncOptions, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.resolve(SELF_DIR, "..");
const SERVER_ENV = path.resolve(DB_DIR, "../../apps/server/.env");
const WEB_ENV = path.resolve(DB_DIR, "../../apps/web/.env");
const POSTGRES_SERVICE = "postgres";
const RSSHUB_SERVICE = "rsshub";
const DEFAULT_POSTGRES_PORT = 5432;
const DEFAULT_RSSHUB_PORT = 1200;
const DEFAULT_SERVER_PORT = 3000;
const SERVER_FALLBACK_PORT_START = 3100;
const HEALTH_TIMEOUT_MS = 60_000;
const MIN_BETTER_AUTH_SECRET_LENGTH = 32;
const SENSITIVE_ENV_KEY_RE = /(SECRET|PASSWORD|TOKEN|API_KEY)/;

interface ExecResult {
	status: number | null;
	stderr: string;
	stdout: string;
}

function exec(
	cmd: string,
	args: string[],
	opts: SpawnSyncOptions = {}
): ExecResult {
	const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
	return {
		status: r.status,
		stdout: typeof r.stdout === "string" ? r.stdout : "",
		stderr: typeof r.stderr === "string" ? r.stderr : "",
	};
}

function isPortFree(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = net.createServer();
		server.once("error", () => resolve(false));
		server.once("listening", () => server.close(() => resolve(true)));
		server.listen(port, "0.0.0.0");
	});
}

async function findFreePort(start: number): Promise<number> {
	for (let p = start; p < start + 100; p++) {
		if (await isPortFree(p)) {
			return p;
		}
	}
	throw new Error(`No free port in [${start}, ${start + 100})`);
}

function getServiceContainerId(service: string): string | null {
	const r = exec("docker", ["compose", "ps", "-aq", service], { cwd: DB_DIR });
	return r.status === 0 ? r.stdout.trim() || null : null;
}

function inspect(id: string, fmt: string): string | null {
	const r = exec("docker", ["inspect", id, "--format", fmt]);
	return r.status === 0 ? r.stdout.trim() : null;
}

function getContainerHostPort(
	id: string,
	containerPort: number
): number | null {
	const v = inspect(
		id,
		`{{with index .HostConfig.PortBindings "${containerPort}/tcp"}}{{(index . 0).HostPort}}{{end}}`
	);
	const n = v ? Number(v) : Number.NaN;
	return Number.isFinite(n) && n > 0 ? n : null;
}

function isRunning(id: string): boolean {
	return inspect(id, "{{.State.Running}}") === "true";
}

function isHealthy(id: string): boolean {
	const v = inspect(
		id,
		"{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}"
	);
	return v === "healthy" || v === "none";
}

async function waitHealthy(id: string): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < HEALTH_TIMEOUT_MS) {
		if (isHealthy(id) && isRunning(id)) {
			return;
		}
		await new Promise((r) => setTimeout(r, 1000));
	}
	throw new Error(
		`container ${id} did not become healthy within ${HEALTH_TIMEOUT_MS / 1000}s`
	);
}

function upsertEnvLine(content: string, key: string, value: string): string {
	const re = new RegExp(`^${key}=.*$`, "m");
	if (re.test(content)) {
		return content.replace(re, `${key}=${value}`);
	}
	const sep = content === "" || content.endsWith("\n") ? "" : "\n";
	return `${content}${sep}${key}=${value}\n`;
}

function getEnvValue(content: string, key: string): string | undefined {
	const match = content.match(new RegExp(`^${key}=(.*)$`, "m"));
	if (!match) {
		return;
	}
	return match[1]?.trim().replace(/^["']|["']$/g, "");
}

function formatEnvLogValue(key: string, value: string): string {
	if (SENSITIVE_ENV_KEY_RE.test(key)) {
		return "<redacted>";
	}
	return value;
}

function updateEnvFile(envFile: string, updates: Record<string, string>): void {
	const prev = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
	let next = prev;
	for (const [key, value] of Object.entries(updates)) {
		next = upsertEnvLine(next, key, value);
	}
	if (next !== prev) {
		writeFileSync(envFile, next);
		for (const [key, value] of Object.entries(updates)) {
			log(`${key} → ${formatEnvLogValue(key, value)}`);
		}
	}
}

function updateServerEnv(updates: Record<string, string>): void {
	updateEnvFile(SERVER_ENV, updates);
}

function updateWebEnv(updates: Record<string, string>): void {
	updateEnvFile(WEB_ENV, updates);
}

function ensureBetterAuthSecret(): void {
	const prev = existsSync(SERVER_ENV) ? readFileSync(SERVER_ENV, "utf8") : "";
	const current = getEnvValue(prev, "BETTER_AUTH_SECRET");
	if (current && current.length >= MIN_BETTER_AUTH_SECRET_LENGTH) {
		return;
	}
	updateServerEnv({
		BETTER_AUTH_SECRET: randomBytes(32).toString("base64url"),
	});
}

function log(msg: string): void {
	console.log(`[db:start] ${msg}`);
}

async function pickPort(
	existingPort: number | null,
	defaultPort: number,
	fallbackStart = defaultPort + 1
): Promise<number> {
	if (existingPort != null && (await isPortFree(existingPort))) {
		return existingPort;
	}
	if (await isPortFree(defaultPort)) {
		return defaultPort;
	}
	const port = await findFreePort(fallbackStart);
	log(`port ${defaultPort} is in use; falling back to ${port}`);
	return port;
}

function bringUpServices(postgresPort: number, rsshubPort: number): void {
	const up = exec("docker", ["compose", "up", "-d"], {
		cwd: DB_DIR,
		env: {
			...process.env,
			POSTGRES_PORT: String(postgresPort),
			RSSHUB_PORT: String(rsshubPort),
		},
		stdio: "inherit",
	});
	if (up.status !== 0) {
		process.exit(up.status ?? 1);
	}
}

async function ensurePostgres(): Promise<number> {
	const cid = getServiceContainerId(POSTGRES_SERVICE);
	const existingPort = cid ? getContainerHostPort(cid, 5432) : null;
	if (cid && isRunning(cid) && existingPort != null) {
		log(`reusing running postgres on port ${existingPort}`);
		await waitHealthy(cid);
		return existingPort;
	}
	return await pickPort(existingPort, DEFAULT_POSTGRES_PORT);
}

async function ensureRsshub(): Promise<number> {
	const cid = getServiceContainerId(RSSHUB_SERVICE);
	const existingPort = cid ? getContainerHostPort(cid, 1200) : null;
	if (cid && isRunning(cid) && existingPort != null) {
		log(`reusing running rsshub on port ${existingPort}`);
		return existingPort;
	}
	return await pickPort(existingPort, DEFAULT_RSSHUB_PORT);
}

async function main(): Promise<void> {
	if (
		exec("docker", ["info"], { stdio: ["ignore", "ignore", "ignore"] })
			.status !== 0
	) {
		console.error(
			"[db:start] docker is not running. Please start Docker and try again."
		);
		process.exit(1);
	}

	const postgresPort = await ensurePostgres();
	const rsshubPort = await ensureRsshub();
	const serverPort = await pickPort(
		null,
		DEFAULT_SERVER_PORT,
		SERVER_FALLBACK_PORT_START
	);

	bringUpServices(postgresPort, rsshubPort);

	const postgresCid = getServiceContainerId(POSTGRES_SERVICE);
	if (!postgresCid) {
		console.error("[db:start] could not locate postgres container after up");
		process.exit(1);
	}
	await waitHealthy(postgresCid);

	const rsshubCid = getServiceContainerId(RSSHUB_SERVICE);
	if (rsshubCid) {
		// RSSHub takes longer to boot; don't block the dev server on it.
		log(
			`rsshub starting on port ${rsshubPort} (will become healthy in the background)`
		);
	}

	updateServerEnv({
		DATABASE_URL: `postgresql://postgres:password@localhost:${postgresPort}/opentrends`,
		RSSHUB_BASE_URLS: `http://localhost:${rsshubPort}`,
		SERVER_PORT: String(serverPort),
	});
	updateWebEnv({
		VITE_SERVER_URL: `http://localhost:${serverPort}`,
	});
	ensureBetterAuthSecret();

	log(`postgres ready on port ${postgresPort}`);
}

main().catch((err) => {
	console.error("[db:start]", err instanceof Error ? err.message : err);
	process.exit(1);
});
