import { createServerFn } from "@tanstack/react-start";

export const GITHUB_REPOSITORY_URL =
	"https://github.com/IvyYang1999/opentrends";

const GITHUB_REPOSITORY_API_URL =
	"https://api.github.com/repos/IvyYang1999/opentrends";
const GITHUB_STARS_BADGE_API_URL =
	"https://img.shields.io/github/stars/IvyYang1999/opentrends.json";

interface GitHubRepositoryApiResponse {
	html_url?: unknown;
	stargazers_count?: unknown;
}

interface GitHubStarsBadgeApiResponse {
	message?: unknown;
}

export interface GitHubRepositoryStats {
	stars: number | null;
	url: string;
}

function readRepositoryStats(data: unknown): GitHubRepositoryStats {
	const repo = data as GitHubRepositoryApiResponse;
	const stars =
		typeof repo.stargazers_count === "number" ? repo.stargazers_count : null;
	const url =
		typeof repo.html_url === "string" ? repo.html_url : GITHUB_REPOSITORY_URL;

	return { stars, url };
}

function readBadgeStars(data: unknown): number | null {
	const badge = data as GitHubStarsBadgeApiResponse;

	if (typeof badge.message !== "string") {
		return null;
	}

	const stars = Number(badge.message.replaceAll(",", ""));
	return Number.isFinite(stars) ? stars : null;
}

async function fetchGithubApiStats(): Promise<GitHubRepositoryStats | null> {
	const response = await fetch(GITHUB_REPOSITORY_API_URL, {
		headers: {
			Accept: "application/vnd.github+json",
			"User-Agent": "opentrends-web",
		},
	});

	if (!response.ok) {
		return null;
	}

	return readRepositoryStats(await response.json());
}

async function fetchBadgeStats(): Promise<GitHubRepositoryStats | null> {
	const response = await fetch(GITHUB_STARS_BADGE_API_URL, {
		headers: { "User-Agent": "opentrends-web" },
	});

	if (!response.ok) {
		return null;
	}

	return {
		stars: readBadgeStars(await response.json()),
		url: GITHUB_REPOSITORY_URL,
	};
}

export const getGithubRepositoryStats = createServerFn({
	method: "GET",
}).handler(async (): Promise<GitHubRepositoryStats> => {
	try {
		return (
			(await fetchGithubApiStats()) ??
			(await fetchBadgeStats()) ?? { stars: null, url: GITHUB_REPOSITORY_URL }
		);
	} catch {
		return { stars: null, url: GITHUB_REPOSITORY_URL };
	}
});
