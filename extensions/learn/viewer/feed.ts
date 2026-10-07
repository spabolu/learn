import * as fs from "node:fs";
import * as path from "node:path";

// The feed is what the Lesson view shows: teaching messages, the learner's own
// typed answers, and questions with their verdicts. It is deliberately not a
// raw transcript: no tool noise, and a question never carries its answer until
// the learner has answered it.

export type FeedKind = "user" | "assistant" | "quiz" | "ask" | "note";

export interface FeedOption {
	index: number;
	label: string;
}

export interface FeedItem {
	id: string;
	kind: FeedKind;
	at: string;
	text?: string;
	question?: string;
	context?: string;
	options?: FeedOption[];
	// Present only after the learner has answered.
	result?: {
		status: "answered" | "cancelled" | "unavailable";
		selected?: number[];
		typed?: string[];
		correctIndices?: number[];
		correct?: boolean;
		dontKnow?: boolean;
		note?: string;
		explanation?: string;
	};
}

const SKILL_BLOCK = /<skill\b([^>]*)>[\s\S]*?<\/skill>/g;

// Skill declarations are injected context, not something the learner typed.
export function stripSkillBlocks(text: string): string {
	return text.replace(SKILL_BLOCK, "").trim();
}

export function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((c: any) => c && c.type === "text" && typeof c.text === "string")
		.map((c: any) => c.text)
		.join("\n\n");
}

export function dayStamp(d: Date): string {
	return d.toISOString().slice(0, 10);
}

export class FeedStore {
	private items = new Map<string, FeedItem>();
	private order: string[] = [];
	private counter = 0;
	private readonly max: number;
	private dir: string | null;

	constructor(sessionsDir: string | null, max = 500) {
		this.dir = sessionsDir;
		this.max = max;
		if (sessionsDir) this.load(sessionsDir);
	}

	private load(dir: string): void {
		if (!fs.existsSync(dir)) return;
		const files = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();
		for (const f of files.slice(-3)) {
			for (const line of fs.readFileSync(path.join(dir, f), "utf-8").split("\n")) {
				if (!line.trim()) continue;
				try {
					this.apply(JSON.parse(line) as FeedItem);
				} catch {
					// Ignore a torn line.
				}
			}
		}
	}

	private apply(item: FeedItem): void {
		if (!this.items.has(item.id)) this.order.push(item.id);
		this.items.set(item.id, item);
		const n = Number(/^m(\d+)$/.exec(item.id)?.[1]);
		if (Number.isFinite(n)) this.counter = Math.max(this.counter, n);
		while (this.order.length > this.max) this.items.delete(this.order.shift()!);
	}

	nextId(): string {
		this.counter += 1;
		return `m${this.counter}`;
	}

	// Insert or replace by id, and append the new version to today's file. Replay
	// is last-write-wins, so a question and its later answer collapse into one card.
	upsert(item: FeedItem, now = new Date()): FeedItem {
		this.apply(item);
		if (this.dir) {
			try {
				fs.mkdirSync(this.dir, { recursive: true });
				fs.appendFileSync(path.join(this.dir, `${dayStamp(now)}.jsonl`), JSON.stringify(item) + "\n", "utf-8");
			} catch {
				// Persistence is best-effort; the live view must not break the lesson.
			}
		}
		return item;
	}

	get(id: string): FeedItem | undefined {
		return this.items.get(id);
	}

	all(): FeedItem[] {
		return this.order.map((id) => this.items.get(id)!).filter(Boolean);
	}
}

export function userItem(store: FeedStore, text: string, now = new Date()): FeedItem | null {
	const clean = stripSkillBlocks(text);
	if (!clean) return null;
	return { id: store.nextId(), kind: "user", at: now.toISOString(), text: clean };
}

export function assistantItem(store: FeedStore, text: string, now = new Date()): FeedItem | null {
	const clean = text.trim();
	if (!clean) return null;
	return { id: store.nextId(), kind: "assistant", at: now.toISOString(), text: clean };
}

export function noteItem(store: FeedStore, text: string, now = new Date()): FeedItem {
	return { id: store.nextId(), kind: "note", at: now.toISOString(), text };
}

// Quiz and ask results arrive as tool results. These map their details onto the
// card without ever exposing the correct answer before the learner answers.
export function quizResult(details: any): FeedItem["result"] {
	if (!details || details.status !== "answered") {
		return { status: details?.status === "unavailable" ? "unavailable" : "cancelled" };
	}
	return {
		status: "answered",
		selected: Array.isArray(details.answers) ? details.answers.map((a: any) => a.index) : [],
		correctIndices: Array.isArray(details.correctIndices) ? details.correctIndices : [],
		correct: details.correct === true,
		dontKnow: details.dontKnow === true,
		note: typeof details.note === "string" ? details.note : undefined,
		explanation: typeof details.explanation === "string" ? details.explanation : undefined,
	};
}

export function askResult(details: any): FeedItem["result"] {
	if (!details || details.status !== "answered") {
		return { status: details?.status === "unavailable" ? "unavailable" : "cancelled" };
	}
	const selected: number[] = [];
	const typed: string[] = [];
	for (const a of Array.isArray(details.answers) ? details.answers : []) {
		if (a.type === "option" && typeof a.index === "number") selected.push(a.index);
		else if (typeof a.label === "string") typed.push(a.label);
	}
	return { status: "answered", selected, typed };
}
