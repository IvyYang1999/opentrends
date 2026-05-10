import { defineHandler } from "void";

import server from "../src/index";

const handleRequest = defineHandler((c) =>
	server.fetch(c.req.raw, c.env, c.executionCtx)
);

export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;
export const OPTIONS = handleRequest;
