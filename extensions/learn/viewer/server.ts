import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { authorize, CSP, COOKIE_NAME, hostAllowed } from "./security.ts";

export const DEFAULT_PORT = 4747;
const PORT_TRIES = 10;
const HEARTBEAT_MS = 20_000;
const MAX_BODY = 32 * 1024;

function readBody(req: http.IncomingMessage): Promise<string | null> {
	return new Promise((resolve) => {
		let size = 0;
		const chunks: Buffer[] = [];
		const onData = (c: Buffer) => {
			size += c.length;
			if (size > MAX_BODY) {
				// Stop keeping it, answer 413, and let the rest drain unread.
				req.off("data", onData);
				req.resume();
				resolve(null);
				return;
			}
			chunks.push(c);
		};
		req.on("data", onData);
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
		req.on("error", () => resolve(null));
	});
}

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".woff2": "font/woff2",
	".woff": "font/woff",
	".ttf": "font/ttf",
};

export interface ViewerOptions {
	token: string;
	// Browser-side files this server may serve, by public path. Anything not
	// listed here is a 404: there is no directory serving and no path joining
	// with user input.
	files: Record<string, string>;
	fontsDir?: string;
	getBootstrap: () => unknown;
	// A browser answer to a pending question. Absent: the viewer is read-only.
	onAnswer?: (id: unknown, value: unknown) => { status: number; error?: string };
	port?: number;
}

export interface ViewerServer {
	port: number;
	url(withToken?: boolean): string;
	push(event: string, data: unknown): void;
	clientCount(): number;
	close(): Promise<void>;
}

function listen(server: http.Server, port: number): Promise<number> {
	return new Promise((resolve, reject) => {
		const onError = (e: NodeJS.ErrnoException) => reject(e);
		server.once("error", onError);
		server.listen(port, "127.0.0.1", () => {
			server.off("error", onError);
			resolve((server.address() as { port: number }).port);
		});
	});
}

export async function startViewer(opts: ViewerOptions): Promise<ViewerServer> {
	const clients = new Set<http.ServerResponse>();
	let boundPort = 0;

	const baseHeaders = () => ({
		"Content-Security-Policy": CSP,
		"X-Content-Type-Options": "nosniff",
		"Referrer-Policy": "no-referrer",
		"Cache-Control": "no-store",
		"Cross-Origin-Resource-Policy": "same-origin",
	});

	function send(res: http.ServerResponse, status: number, body: string | Buffer, type: string, extra: Record<string, string> = {}) {
		res.writeHead(status, { ...baseHeaders(), "Content-Type": type, ...extra });
		res.end(body);
	}

	function sendFile(res: http.ServerResponse, file: string) {
		let data: Buffer;
		try {
			data = fs.readFileSync(file);
		} catch {
			send(res, 404, "not found", "text/plain; charset=utf-8");
			return;
		}
		send(res, 200, data, MIME[path.extname(file)] ?? "application/octet-stream");
	}

	const server = http.createServer(async (req, res) => {
		if (!hostAllowed(req.headers.host, boundPort)) {
			send(res, 403, "forbidden host", "text/plain; charset=utf-8");
			return;
		}
		const url = new URL(req.url ?? "/", `http://127.0.0.1:${boundPort}`);
		const isAnswer = req.method === "POST" && url.pathname === "/api/answer" && !!opts.onAnswer;
		if (req.method !== "GET" && req.method !== "HEAD" && !isAnswer) {
			send(res, 405, "method not allowed", "text/plain; charset=utf-8", { Allow: "GET, HEAD" });
			return;
		}
		const auth = authorize(opts.token, url.searchParams.get("t"), req.headers.cookie);
		if (!auth.ok) {
			send(res, 403, "Not authorised. In pi, run /learn open to get a link with the access token.", "text/plain; charset=utf-8");
			return;
		}
		if (auth.setCookie) {
			// Store the token in a cookie and drop it from the address bar and history.
			res.writeHead(302, {
				...baseHeaders(),
				Location: url.pathname === "/" ? "/" : url.pathname,
				"Set-Cookie": `${COOKIE_NAME}=${opts.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
			});
			res.end();
			return;
		}

		const p = url.pathname;
		if (isAnswer) {
			await handleAnswer(req, res, auth.setCookie);
			return;
		}
		if (p === "/api/bootstrap") {
			send(res, 200, JSON.stringify(opts.getBootstrap()), MIME[".json"]);
			return;
		}
		if (p === "/events") {
			res.writeHead(200, {
				...baseHeaders(),
				"Content-Type": "text/event-stream; charset=utf-8",
				Connection: "keep-alive",
			});
			res.write("retry: 2000\n\n");
			clients.add(res);
			req.on("close", () => clients.delete(res));
			return;
		}
		const font = /^\/vendor\/fonts\/(KaTeX_[A-Za-z0-9_-]+\.(?:woff2|woff|ttf))$/.exec(p);
		if (font && opts.fontsDir) {
			sendFile(res, path.join(opts.fontsDir, font[1]));
			return;
		}
		const key = p === "/" ? "/index.html" : p;
		const file = Object.prototype.hasOwnProperty.call(opts.files, key) ? opts.files[key] : undefined;
		if (file) {
			sendFile(res, file);
			return;
		}
		send(res, 404, "not found", "text/plain; charset=utf-8");
	});

	// Writing is the one thing a malicious page could want to forge, so a browser
	// answer must come from this page: the cookie (not a URL token), JSON, a
	// custom header (forces a CORS preflight, which this server never grants),
	// and a same-origin Origin when the browser sends one.
	async function handleAnswer(req: http.IncomingMessage, res: http.ServerResponse, viaUrlToken: boolean) {
		const json = (status: number, body: unknown) => send(res, status, JSON.stringify(body), MIME[".json"]);
		const origin = req.headers.origin;
		const okOrigin = !origin || origin === `http://127.0.0.1:${boundPort}` || origin === `http://localhost:${boundPort}`;
		const site = req.headers["sec-fetch-site"];
		if (viaUrlToken || !okOrigin || (site && site !== "same-origin") || req.headers["x-learn-answer"] !== "1" || !String(req.headers["content-type"] ?? "").startsWith("application/json")) {
			json(403, { error: "forbidden" });
			return;
		}
		const raw = await readBody(req);
		if (raw === null) {
			send(res, 413, JSON.stringify({ error: "answer too large" }), MIME[".json"], { Connection: "close" });
			return;
		}
		let body: any;
		try {
			body = JSON.parse(raw);
		} catch {
			json(400, { error: "not JSON" });
			return;
		}
		const out = opts.onAnswer!(body?.id, body?.value);
		json(out.status, out.error ? { error: out.error } : { ok: true });
	}

	const first = opts.port ?? DEFAULT_PORT;
	let lastError: unknown;
	for (let i = 0; i < (first === 0 ? 1 : PORT_TRIES); i++) {
		try {
			boundPort = await listen(server, first === 0 ? 0 : first + i);
			lastError = undefined;
			break;
		} catch (e) {
			lastError = e;
			if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") break;
		}
	}
	if (lastError) throw lastError;

	const heartbeat = setInterval(() => {
		for (const c of clients) c.write(": ping\n\n");
	}, HEARTBEAT_MS);
	heartbeat.unref();

	return {
		port: boundPort,
		url: (withToken = true) => `http://127.0.0.1:${boundPort}/${withToken ? `?t=${opts.token}` : ""}`,
		push(event, data) {
			const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
			for (const c of clients) c.write(frame);
		},
		clientCount: () => clients.size,
		close() {
			clearInterval(heartbeat);
			for (const c of clients) c.end();
			clients.clear();
			return new Promise((resolve) => {
				server.close(() => resolve());
				server.closeAllConnections?.();
			});
		},
	};
}
