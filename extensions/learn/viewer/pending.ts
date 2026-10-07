import type { Bridge, OfferHandle, WebOffer } from "../answer-bridge.ts";

// Questions waiting for an answer that the browser may give. The first answer
// wins: a web answer settles it here; a terminal answer withdraws it. Either way
// the browser is told, so the card disappears in every open tab.

export interface PendingView {
	id: string;
	kind: WebOffer["kind"];
	payload: Record<string, unknown>;
}

export interface AnswerOutcome {
	status: 200 | 400 | 409;
	error?: string;
}

export class PendingAnswers implements Bridge {
	private items = new Map<string, { offer: WebOffer; resolve: (v: unknown) => void }>();
	private n = 0;

	private push: (event: string, data: unknown) => void;

	constructor(push: (event: string, data: unknown) => void) {
		this.push = push;
	}

	offer(o: WebOffer): OfferHandle {
		const id = `q${Date.now().toString(36)}-${++this.n}`;
		let resolve!: (v: unknown) => void;
		const answer = new Promise<unknown>((r) => (resolve = r));
		this.items.set(id, { offer: o, resolve });
		this.push("pending", { id, kind: o.kind, payload: o.payload } satisfies PendingView);
		return {
			answer,
			withdraw: (by) => {
				if (this.items.delete(id)) this.push("settled", { id, by });
			},
		};
	}

	list(): PendingView[] {
		return [...this.items].map(([id, { offer }]) => ({ id, kind: offer.kind, payload: offer.payload }));
	}

	answer(id: unknown, value: unknown): AnswerOutcome {
		const item = typeof id === "string" ? this.items.get(id) : undefined;
		if (!item) return { status: 409, error: "This question was already answered or closed." };
		const err = item.offer.validate(value);
		if (err) return { status: 400, error: err };
		this.items.delete(id as string);
		this.push("settled", { id, by: "web" });
		item.resolve(value);
		return { status: 200 };
	}

	clear(): void {
		for (const id of this.items.keys()) this.push("settled", { id, by: "cancelled" });
		this.items.clear();
	}
}
