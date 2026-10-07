import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// The viewer is a local web server, so it needs three defences:
//  - loopback only (the server binds 127.0.0.1)
//  - a secret token, so other local pages and users cannot read the lesson
//  - a Host check, so a malicious site cannot reach it by DNS rebinding

export const COOKIE_NAME = "learn_viewer";

export function tokenFile(home = os.homedir()): string {
	return path.join(home, ".pi", "agent", "learn-viewer.json");
}

// One stable token per machine, so the URL stays bookmarkable across restarts.
export function loadOrCreateToken(file = tokenFile()): string {
	try {
		const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
		if (typeof parsed.token === "string" && /^[a-f0-9]{32,}$/.test(parsed.token)) return parsed.token;
	} catch {
		// Missing or unreadable: create a new one below.
	}
	const token = crypto.randomBytes(24).toString("hex");
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify({ token }) + "\n", { encoding: "utf-8", mode: 0o600 });
	return token;
}

export function safeEqual(a: string, b: string): boolean {
	const ba = Buffer.from(a);
	const bb = Buffer.from(b);
	return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function parseCookies(header: string | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	for (const part of (header ?? "").split(";")) {
		const i = part.indexOf("=");
		if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
	}
	return out;
}

export function hostAllowed(hostHeader: string | undefined, port: number): boolean {
	if (!hostHeader) return false;
	return hostHeader === `127.0.0.1:${port}` || hostHeader === `localhost:${port}`;
}

export interface AuthResult {
	ok: boolean;
	// True when the token came from the URL, so the server should set the cookie.
	setCookie: boolean;
}

export function authorize(token: string, urlToken: string | null, cookieHeader: string | undefined): AuthResult {
	if (urlToken && safeEqual(urlToken, token)) return { ok: true, setCookie: true };
	const cookie = parseCookies(cookieHeader)[COOKIE_NAME];
	if (cookie && safeEqual(cookie, token)) return { ok: true, setCookie: false };
	return { ok: false, setCookie: false };
}

export const CSP = [
	"default-src 'none'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"font-src 'self'",
	"img-src 'self' data:",
	"connect-src 'self'",
	"base-uri 'none'",
	"form-action 'none'",
	"frame-ancestors 'none'",
].join("; ");
