(function () {
	"use strict";
	const dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
	const R = LearnRender.create({ Marked: marked.Marked, katex, DOMPurify, mermaid });
	R.initMermaid(dark);

	const $ = (id) => document.getElementById(id);
	const feedEl = $("feed");
	const cards = new Map();
	let current = null;

	function el(tag, cls, text) {
		const e = document.createElement(tag);
		if (cls) e.className = cls;
		if (text !== undefined) e.textContent = text;
		return e;
	}

	// All lesson content goes through the sanitising renderer; labels and
	// metadata use textContent. The only innerHTML assignments take sanitiser
	// output.
	function md(cls, text) {
		const d = el("div", cls);
		R.mount(d, text);
		return d;
	}

	function optionsList(item) {
		const ul = el("ul", "opts");
		const r = item.result;
		const picked = new Set((r && r.selected) || []);
		const right = new Set((r && r.correctIndices) || []);
		const graded = r && r.status === "answered" && item.kind === "quiz" && !r.dontKnow;
		for (const o of item.options || []) {
			const li = el("li");
			li.appendChild(el("span", "n", o.index + "."));
			const body = el("span");
			body.innerHTML = R.renderMarkdown(o.label);
			li.appendChild(body);
			if (picked.has(o.index)) li.classList.add("picked");
			if (graded) {
				if (right.has(o.index)) {
					li.classList.add("right");
					li.appendChild(el("span", "mark", "✓"));
				} else if (picked.has(o.index)) {
					li.classList.add("wrong");
					li.appendChild(el("span", "mark", "✗"));
				}
			} else if (r && r.dontKnow && right.has(o.index)) {
				li.classList.add("right");
				li.appendChild(el("span", "mark", "✓"));
			}
			ul.appendChild(li);
		}
		return ul;
	}

	function questionCard(item) {
		const card = el("div", "card q");
		card.appendChild(el("div", "kicker", item.kind === "quiz" ? "Quiz" : "Question"));
		card.appendChild(md("", item.question || ""));
		if (item.context) card.appendChild(md("", item.context));
		if (item.options && item.options.length) card.appendChild(optionsList(item));
		const r = item.result;
		if (!r) {
			card.appendChild(el("div", "waiting", "Waiting for your answer."));
		} else if (r.status !== "answered") {
			card.appendChild(el("div", "waiting", r.status === "cancelled" ? "Skipped." : "Unavailable."));
		} else {
			if (item.kind === "quiz") {
				const v = r.dontKnow ? ["dk", "I don't know"] : r.correct ? ["good", "Correct"] : ["bad", "Incorrect"];
				card.appendChild(el("div", "verdict " + v[0], v[1]));
			}
			if (r.typed && r.typed.length) card.appendChild(el("div", "typed", r.typed.join("\n")));
			if (r.note) card.appendChild(el("div", "typed", "Note: " + r.note));
			if (r.explanation) card.appendChild(md("explain", r.explanation));
		}
		return card;
	}

	function build(item) {
		let card;
		if (item.kind === "user") {
			card = el("div", "card you");
			card.appendChild(el("div", "kicker", "You"));
			card.appendChild(md("", item.text || ""));
		} else if (item.kind === "assistant") {
			card = el("div", "card");
			card.appendChild(md("", item.text || ""));
		} else if (item.kind === "note") {
			card = el("div", "card note", item.text || "");
		} else {
			card = questionCard(item);
		}
		card.dataset.id = item.id;
		return card;
	}

	function nearBottom() {
		return window.innerHeight + window.scrollY >= document.body.scrollHeight - 160;
	}

	function showItem(item) {
		const stick = nearBottom();
		const card = build(item);
		const old = cards.get(item.id);
		if (old) old.replaceWith(card);
		else feedEl.appendChild(card);
		cards.set(item.id, card);
		$("empty").hidden = cards.size > 0;
		if (stick) window.scrollTo({ top: document.body.scrollHeight });
		else $("jump").hidden = false;
	}

	function renderDocs(rootId, docs, empty) {
		const root = $(rootId);
		root.textContent = "";
		if (!docs.length) {
			const p = el("section", "panel");
			p.appendChild(el("div", "waiting", empty));
			root.appendChild(p);
			return;
		}
		for (const doc of docs) {
			const p = el("section", "panel");
			p.appendChild(el("div", "kicker", doc.title));
			p.appendChild(md("", doc.markdown));
			root.appendChild(p);
		}
	}

	function applyState(s) {
		current = s;
		$("topic").textContent = s.topic.title;
		document.title = s.topic.title + " · learn";
		renderDocs("plan", s.plan, "No mission or plan yet.");
		renderDocs("library", s.library, "Notes, reference sheets and learning records collect here as you learn.");
	}


	// --- Your turn: answer pending questions here or in the terminal ---------
	// Only what the terminal shows before answering ever reaches this page. The
	// first answer wins; the other side's prompt closes by itself.

	const pending = new Map();

	async function postAnswer(id, value, errEl, buttons) {
		buttons.forEach((b) => (b.disabled = true));
		errEl.textContent = "";
		try {
			const res = await fetch("/api/answer", {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/json", "X-Learn-Answer": "1" },
				body: JSON.stringify({ id, value }),
			});
			if (res.ok) {
				removePending(id);
				return;
			}
			const body = await res.json().catch(() => ({}));
			errEl.textContent = body.error || "Could not send the answer (" + res.status + ").";
			if (res.status === 409) setTimeout(() => removePending(id), 1500);
		} catch {
			errEl.textContent = "Could not reach pi. Is the session still running?";
		}
		buttons.forEach((b) => (b.disabled = false));
	}

	function button(text, cls) {
		const b = el("button", "btn" + (cls ? " " + cls : ""), text);
		b.type = "button";
		return b;
	}

	// A textarea whose content renders below as markdown with LaTeX, as you type.
	function answerBox(placeholder) {
		const wrap = el("div", "answerbox");
		const ta = el("textarea");
		ta.rows = 4;
		ta.placeholder = placeholder;
		ta.maxLength = 4000;
		const preview = el("div", "preview");
		let timer = 0;
		ta.addEventListener("input", () => {
			clearTimeout(timer);
			timer = setTimeout(() => {
				preview.textContent = "";
				if (ta.value.trim()) R.mount(preview, ta.value);
			}, 150);
		});
		wrap.appendChild(ta);
		wrap.appendChild(preview);
		return { wrap, ta };
	}

	function choiceForm(p, id, card, err) {
		const pl = p.payload;
		const quiz = p.kind === "quiz";
		const multi = quiz ? pl.multi : pl.mode === "multi-select";
		card.appendChild(el("div", "kicker", quiz ? "Quiz" : "Question"));
		card.appendChild(md("", pl.question || ""));
		if (pl.context) card.appendChild(md("", pl.context));
		const chosen = new Set();
		let confirmBtn = null;
		const list = el("div", "choices");
		const btns = [];
		for (const o of pl.options || []) {
			const b = button("");
			b.classList.add("choice");
			b.appendChild(el("span", "n", o.index + "."));
			const body = el("span");
			body.innerHTML = R.renderMarkdown(o.label);
			b.appendChild(body);
			b.addEventListener("click", () => {
				// A quiz answer is graded, so a click only selects; Submit confirms.
				if (!multi && !quiz) return submit([o.index]);
				if (!multi) {
					chosen.clear();
					list.querySelectorAll(".btn.choice.on").forEach((x) => x.classList.remove("on"));
				}
				if (chosen.has(o.index)) chosen.delete(o.index);
				else chosen.add(o.index);
				b.classList.toggle("on", chosen.has(o.index));
				if (confirmBtn) confirmBtn.disabled = chosen.size === 0;
			});
			btns.push(b);
			list.appendChild(b);
		}
		card.appendChild(list);
		const row = el("div", "row");
		let other = null;
		let note = null;
		if (!quiz && pl.mode !== "text") {
			other = el("input");
			other.type = "text";
			other.placeholder = (pl.otherLabel || "Other") + ": type your own answer";
			other.maxLength = 4000;
			card.appendChild(other);
		}
		if (quiz) {
			note = el("input");
			note.type = "text";
			note.placeholder = "Note (optional): what you were thinking";
			note.maxLength = 4000;
			card.appendChild(note);
			const dk = button("I don't know");
			btns.push(dk);
			row.appendChild(dk);
			dk.addEventListener("click", () => postAnswer(id, { dontKnow: true, note: note.value || undefined }, err, btns));
		}
		function submit(indices) {
			const value = { indices };
			if (note && note.value.trim()) value.note = note.value;
			if (other && other.value.trim()) value.other = other.value;
			postAnswer(id, value, err, btns);
		}
		if (multi || other || quiz) {
			const send = button(multi || quiz ? "Submit" : "Send", "primary");
			if (quiz) {
				confirmBtn = send;
				send.disabled = true;
			}
			btns.push(send);
			row.insertBefore(send, row.firstChild);
			send.addEventListener("click", () => {
				if (!multi && other && other.value.trim()) return postAnswer(id, { other: other.value }, err, btns);
				submit([...chosen].sort((a, b) => a - b));
			});
		}
		card.appendChild(row);
	}

	function textForm(p, id, card, err) {
		const pl = p.payload;
		card.appendChild(el("div", "kicker", "Question"));
		card.appendChild(md("", pl.question || ""));
		if (pl.context) card.appendChild(md("", pl.context));
		const box = answerBox("Your answer");
		card.appendChild(box.wrap);
		const send = button("Send", "primary");
		const row = el("div", "row");
		row.appendChild(send);
		card.appendChild(row);
		const go = () => box.ta.value.trim() && postAnswer(id, { text: box.ta.value }, err, [send]);
		send.addEventListener("click", go);
		box.ta.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) go();
		});
		setTimeout(() => box.ta.focus(), 0);
	}

	function showPending(p) {
		removePending(p.id);
		const card = el("div", "card turn");
		card.dataset.pending = p.id;
		const err = el("div", "err");
		if (p.kind === "ask" && p.payload.mode === "text") textForm(p, p.id, card, err);
		else choiceForm(p, p.id, card, err);
		card.appendChild(err);
		card.appendChild(el("div", "hint-line", "Answer here or in the terminal: the first answer counts."));
		pending.set(p.id, card);
		$("turn").appendChild(card);
		$("empty").hidden = true;
		document.title = "● " + (current ? current.topic.title : "learn") + " · your turn";
		window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
	}

	function removePending(id) {
		const card = pending.get(id);
		if (card) card.remove();
		pending.delete(id);
		if (pending.size === 0 && current) document.title = current.topic.title + " · learn";
	}

	function applyBootstrap(b) {
		feedEl.textContent = "";
		cards.clear();
		applyState(b);
		for (const item of b.feed) showItem(item);
		for (const id of [...pending.keys()]) removePending(id);
		for (const p of b.pending || []) showPending(p);
		$("empty").hidden = cards.size > 0;
		window.scrollTo({ top: document.body.scrollHeight });
	}

	async function load() {
		const res = await fetch("/api/bootstrap", { credentials: "same-origin" });
		if (!res.ok) throw new Error("bootstrap " + res.status);
		applyBootstrap(await res.json());
	}

	function connect() {
		const es = new EventSource("/events");
		es.addEventListener("open", () => ($("conn").hidden = true));
		es.addEventListener("error", () => ($("conn").hidden = false));
		es.addEventListener("feed", (e) => showItem(JSON.parse(e.data)));
		es.addEventListener("state", (e) => applyState({ ...JSON.parse(e.data), feed: [] }));
		es.addEventListener("reset", () => load());
		es.addEventListener("pending", (e) => showPending(JSON.parse(e.data)));
		es.addEventListener("settled", (e) => removePending(JSON.parse(e.data).id));
	}

	document.querySelectorAll("#tabs button").forEach((b) =>
		b.addEventListener("click", () => {
			document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("active", x === b));
			document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === b.dataset.tab));
		}),
	);
	$("jump").addEventListener("click", () => {
		window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
		$("jump").hidden = true;
	});
	window.addEventListener("scroll", () => {
		if (nearBottom()) $("jump").hidden = true;
	});

	load().then(connect).catch(() => ($("conn").hidden = false));
})();
