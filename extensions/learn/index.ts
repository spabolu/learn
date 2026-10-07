import * as fs from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { lastTouched, listTopics, slugify, topicDir, topicTitle } from "./paths.ts";
import { createViewer } from "./viewer/controller.ts";

// /learn picks a topic folder, opens the live viewer, and reminds the teacher
// each turn where the workspace is. Everything else lives in the teach skill
// and in plain markdown files the teacher reads and writes itself.

const ENTRY = "learn";
const DAY = 86_400_000;

export default function learn(pi: ExtensionAPI) {
	let active: string | null = null;
	const viewer = createViewer();
	viewer.attach(pi);

	function activate(ctx: ExtensionContext, slug: string, remember = true): void {
		fs.mkdirSync(topicDir(ctx.cwd, slug), { recursive: true });
		active = slug;
		if (remember) pi.appendEntry(ENTRY, { slug });
		ctx.ui.setStatus(ENTRY, `learn: ${topicTitle(topicDir(ctx.cwd, slug), slug)}`);
		viewer.setTopic(ctx.cwd, slug);
		void viewer.start(ctx, true).then((url) => url && ctx.ui.notify(`Viewer: ${url}`, "info"));
	}

	pi.on("session_start", async (_event, ctx) => {
		const entries: any[] = (ctx.sessionManager as any).getBranch?.() ?? (ctx.sessionManager as any).getEntries();
		const last = entries.filter((e) => e.type === "custom" && e.customType === ENTRY).at(-1);
		const slug = last?.data?.slug;
		if (slug && fs.existsSync(topicDir(ctx.cwd, slug))) activate(ctx, slug, false);
	});

	pi.on("session_shutdown", async () => {
		await viewer.stop();
	});

	pi.on("before_agent_start", async (event: any, ctx) => {
		if (!active) return;
		const dir = topicDir(ctx.cwd, active);
		const days = Math.floor((Date.now() - lastTouched(dir)) / DAY);
		event.systemPromptOptions.sections.learn = [
			`[learn] Topic: ${topicTitle(dir, active)}. Workspace: topics/${active}/ (MISSION.md, PLAN.md, NOTES.md, RESOURCES.md, records/, reference/). Files that don't exist yet are yours to create. Ignore .viewer/ (the viewer's chat log).`,
			`Today is ${new Date().toISOString().slice(0, 10)}; the workspace was last changed ${days === 0 ? "today" : `${days} day(s) ago`}.`,
			"Follow the teach skill. At the start of a session, read MISSION.md, PLAN.md, NOTES.md and the newest records before teaching.",
			"The learner reads everything in a live web viewer that renders markdown, LaTeX ($...$), mermaid and inline SVG.",
		].join("\n");
	});

	pi.registerCommand("learn", {
		description: "Learn a topic: /learn <topic> | /learn (resume the latest) | /learn list | /learn view",
		handler: async (args, ctx) => {
			const arg = args.trim();
			const topics = listTopics(ctx.cwd);

			if (arg === "view") {
				const url = await viewer.open(ctx);
				ctx.ui.notify(url ? `Viewer: ${url}` : "Start a topic first: /learn <topic>", "info");
				return;
			}
			if (arg === "list") {
				ctx.ui.notify(topics.length ? topics.map((t) => `- ${t.slug}`).join("\n") : "No topics yet. Start one with /learn <topic>.", "info");
				return;
			}

			const slug = arg ? slugify(arg) : (active ?? topics[0]?.slug);
			if (!slug) {
				ctx.ui.notify("No topics yet. Start one with /learn <topic>.", "info");
				return;
			}
			const known = topics.some((t) => t.slug === slug);
			activate(ctx, slug);
			pi.sendUserMessage(
				known
					? `Let's continue ${topicTitle(topicDir(ctx.cwd, slug), slug)}.`
					: `Teach me: ${arg}. Use the teach skill; the workspace is topics/${slug}/.`,
			);
		},
	});
}
