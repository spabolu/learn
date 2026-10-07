import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { markdownFiles, topicDir, topicTitle } from "../paths.ts";
import { askResult, assistantItem, FeedStore, noteItem, quizResult, textOf, userItem, type FeedItem } from "./feed.ts";
import { PendingAnswers } from "./pending.ts";
import { setBridge } from "../answer-bridge.ts";
import { DEFAULT_PORT, startViewer, type ViewerServer } from "./server.ts";
import { loadOrCreateToken } from "./security.ts";

const VIEWER_DIR = path.dirname(fileURLToPath(import.meta.url));
const LEARN_DIR = path.dirname(VIEWER_DIR);
const NM = path.join(LEARN_DIR, "node_modules");

export function assetFiles(): Record<string, string> {
	return {
		"/index.html": path.join(VIEWER_DIR, "public", "index.html"),
		"/app.js": path.join(VIEWER_DIR, "public", "app.js"),
		"/render.js": path.join(VIEWER_DIR, "public", "render.js"),
		"/style.css": path.join(VIEWER_DIR, "public", "style.css"),
		"/vendor/marked.js": path.join(NM, "marked", "lib", "marked.umd.js"),
		"/vendor/katex.js": path.join(NM, "katex", "dist", "katex.min.js"),
		"/vendor/katex.css": path.join(NM, "katex", "dist", "katex.min.css"),
		"/vendor/purify.js": path.join(NM, "dompurify", "dist", "purify.min.js"),
		"/vendor/mermaid.js": path.join(NM, "mermaid", "dist", "mermaid.min.js"),
	};
}

interface Doc {
	title: string;
	markdown: string;
}

// The Plan tab shows the mission and the plan; the Library tab shows everything
// else the teacher wrote: notes, sources, reference sheets, learning records.
function workspaceDocs(dir: string): { plan: Doc[]; library: Doc[] } {
	const read = (f: string): Doc => ({ title: path.relative(dir, f), markdown: fs.readFileSync(f, "utf-8") });
	const files = markdownFiles(dir);
	const at = (name: string) => files.filter((f) => path.relative(dir, f) === name).map(read);
	const under = (sub: string) => files.filter((f) => path.relative(dir, f).startsWith(sub + path.sep)).sort();
	return {
		plan: [...at("MISSION.md"), ...at("PLAN.md")],
		library: [...at("NOTES.md"), ...under("reference").map(read), ...under("records").reverse().map(read), ...at("RESOURCES.md")],
	};
}

function openInBrowser(url: string): void {
	const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
	const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
	try {
		const child = spawn(cmd, args, { stdio: "ignore", detached: true });
		child.on("error", () => {});
		child.unref();
	} catch {
		// Opening is a convenience; the URL is always shown.
	}
}

export function createViewer() {
	let server: ViewerServer | null = null;
	let starting: Promise<ViewerServer | null> | null = null;
	let store: FeedStore | null = null;
	let slug: string | null = null;
	let cwd = "";
	let opened = false;
	const pending = new PendingAnswers((event, data) => server?.push(event, data));

	function snapshot() {
		if (!slug) return null;
		const dir = topicDir(cwd, slug);
		return { topic: { slug, title: topicTitle(dir, slug) }, ...workspaceDocs(dir) };
	}

	// Re-send the workspace files after the teacher writes to them.
	function refresh(): void {
		const s = snapshot();
		if (s) server?.push("state", s);
	}

	function publish(item: FeedItem | null): void {
		if (!item || !store) return;
		store.upsert(item);
		server?.push("feed", item);
	}

	async function start(ctx: any): Promise<ViewerServer | null> {
		if (process.env.LEARN_VIEWER === "off") return null;
		if (server) return server;
		if (starting) return starting;
		starting = (async () => {
			const missing = Object.entries(assetFiles()).filter(([, f]) => !fs.existsSync(f));
			if (missing.length) {
				ctx.ui?.notify?.(`Viewer unavailable: run  cd ${LEARN_DIR} && npm install`, "warning");
				return null;
			}
			try {
				server = await startViewer({
					token: loadOrCreateToken(),
					files: assetFiles(),
					fontsDir: path.join(NM, "katex", "dist", "fonts"),
					getBootstrap: () => {
						const s = snapshot();
						return s ? { ...s, feed: store?.all() ?? [], pending: pending.list() } : null;
					},
					onAnswer: (id, value) => pending.answer(id, value),
					port: DEFAULT_PORT,
				});
				setBridge(pending);
				ctx.ui?.setStatus?.("learn-view", `view: 127.0.0.1:${server.port}`);
				return server;
			} catch (e) {
				ctx.ui?.notify?.(`Viewer failed to start: ${(e as Error).message}`, "warning");
				return null;
			} finally {
				starting = null;
			}
		})();
		return starting;
	}

	return {
		setTopic(newCwd: string, newSlug: string | null) {
			cwd = newCwd;
			slug = newSlug;
			// Hidden, so the teacher doesn't read the chat history as workspace notes.
			store = newSlug ? new FeedStore(path.join(topicDir(newCwd, newSlug), ".viewer")) : null;
			server?.push("reset", {});
		},

		async start(ctx: any, open = false): Promise<string | null> {
			const s = await start(ctx);
			if (!s) return null;
			const url = s.url(true);
			if (open && !opened && s.clientCount() === 0) {
				opened = true;
				openInBrowser(url);
			}
			return url;
		},

		async open(ctx: any): Promise<string | null> {
			const s = await start(ctx);
			if (!s) return null;
			openInBrowser(s.url(true));
			return s.url(true);
		},

		async stop() {
			setBridge(null);
			pending.clear();
			const s = server;
			server = null;
			opened = false;
			if (s) await s.close();
		},

		note(text: string) {
			if (store) publish(noteItem(store, text));
		},

		attach(pi: any) {
			pi.on("message_end", async (event: any) => {
				const msg = event.message;
				if (!store || !msg) return;
				if (msg.role === "user") publish(userItem(store, textOf(msg.content)));
				else if (msg.role === "assistant") publish(assistantItem(store, textOf(msg.content)));
			});

			// ask_user_question never shuffles, so its call args are the display order.
			pi.on("tool_call", async (event: any) => {
				if (!store || event.toolName !== "ask_user_question") return;
				const input = event.input ?? {};
				publish({
					id: `t:${event.toolCallId}`,
					kind: "ask",
					at: new Date().toISOString(),
					question: String(input.question ?? ""),
					context: input.details ? String(input.details) : undefined,
					options: Array.isArray(input.options) ? input.options.map((o: any, i: number) => ({ index: i + 1, label: String(o.label ?? "") })) : [],
				});
			});

			// quiz shuffles inside execute(); the first update carries the shown order
			// and, deliberately, no correct answer.
			pi.on("tool_execution_update", async (event: any) => {
				if (!store || event.toolName !== "quiz") return;
				const id = `t:${event.toolCallId}`;
				if (store.get(id)) return;
				const opts = event.partialResult?.details?.options as Array<{ index: number; label: string }> | undefined;
				if (!opts?.length) return;
				const args = event.args ?? {};
				publish({
					id,
					kind: "quiz",
					at: new Date().toISOString(),
					question: String(args.question ?? ""),
					context: args.details ? String(args.details) : undefined,
					options: opts.map((o) => ({ index: o.index, label: o.label })),
				});
			});

			pi.on("tool_result", async (event: any) => {
				const name = event.toolName;
				if (name === "write" || name === "edit" || name === "bash") refresh();
				if (!store || (name !== "quiz" && name !== "ask_user_question")) return;
				const id = `t:${event.toolCallId}`;
				const details = event.details;
				const result = name === "quiz" ? quizResult(details) : askResult(details);
				const existing = store.get(id);
				if (existing) return publish({ ...existing, result });
				const opts = Array.isArray(details?.options) ? details.options : [];
				publish({
					id,
					kind: name === "quiz" ? "quiz" : "ask",
					at: new Date().toISOString(),
					question: String(details?.question ?? event.input?.question ?? ""),
					context: details?.context ? String(details.context) : undefined,
					options: opts.map((o: any) => ({ index: o.index, label: o.label })),
					result,
				});
			});
		},
	};
}
