// The answer bridge lets a question be answered in the terminal or in the live
// viewer, whichever comes first. It lives on globalThis (like the shared UI
// lock) so quiz.ts and ask-user-question.ts can use it without importing the
// viewer. With no viewer running there is no bridge, and popups behave as before.
//
// The bridge only ever sees what the learner may see before answering: never
// the correct option.

export interface WebOffer {
	kind: "quiz" | "ask";
	payload: Record<string, unknown>;
	// Returns an error message for a malformed answer; the browser shows it.
	validate: (value: unknown) => string | null;
}

export interface OfferHandle {
	answer: Promise<unknown>;
	withdraw(by: "terminal" | "cancelled"): void;
}

export interface Bridge {
	offer(o: WebOffer): OfferHandle;
}

const KEY = "__learnAnswerBridge";

export function setBridge(b: Bridge | null): void {
	(globalThis as any)[KEY] = b ?? undefined;
}

export function getBridge(): Bridge | null {
	return ((globalThis as any)[KEY] as Bridge | undefined) ?? null;
}

type Custom<T> = (factory: (tui: any, theme: any, kb: any, done: (r: T) => void) => any) => Promise<T>;

// Wraps a ctx.ui.custom popup so the browser can answer it too. The factory gets
// a guarded `done` and a `claim()`: call claim() when the terminal commits to an
// answer before the popup closes (for example when a quiz moves to its feedback
// view). claim() returns false if the browser already answered.
export function raceCustom<T>(
	custom: Custom<T>,
	offer: WebOffer | null,
	factory: (tui: any, theme: any, kb: any, done: (r: T) => void, claim: () => boolean) => any,
	fromWeb: (value: any) => T,
): Promise<T> {
	return custom((tui, theme, kb, done) => {
		const bridge = offer ? getBridge() : null;
		const handle = bridge && offer ? bridge.offer(offer) : null;
		let owner: "none" | "terminal" | "web" = "none";
		const claim = (): boolean => {
			if (owner === "web") return false;
			if (owner === "none") {
				owner = "terminal";
				handle?.withdraw("terminal");
			}
			return true;
		};
		const finish = (r: T) => {
			if (!claim()) return;
			done(r);
		};
		handle?.answer.then(
			(value) => {
				if (owner !== "none") return;
				owner = "web";
				done(fromWeb(value));
				tui?.requestRender?.();
			},
			() => {},
		);
		return factory(tui, theme, kb, finish, claim);
	});
}

// --- validators shared by the popups ---

export const MAX_TEXT = 4000;

export function isText(v: unknown, field = "text", allowEmpty = false): string | null {
	const t = (v as any)?.[field];
	if (typeof t !== "string") return `${field} must be a string`;
	if (!allowEmpty && !t.trim()) return `${field} is empty`;
	if (t.length > MAX_TEXT) return `${field} is longer than ${MAX_TEXT} characters`;
	return null;
}

export function isIndexList(v: unknown, max: number, multi: boolean): string | null {
	const idx = (v as any)?.indices;
	if (!Array.isArray(idx) || idx.length === 0) return "choose an option";
	if (!multi && idx.length !== 1) return "choose exactly one option";
	if (idx.some((i) => !Number.isInteger(i) || i < 1 || i > max)) return "unknown option";
	if (new Set(idx).size !== idx.length) return "an option is listed twice";
	return null;
}

export function optionalNote(v: unknown): string | null {
	const n = (v as any)?.note;
	if (n === undefined) return null;
	if (typeof n !== "string" || n.length > MAX_TEXT) return "note must be text";
	return null;
}
