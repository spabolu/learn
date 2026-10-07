/* Rendering pipeline: markdown -> math -> sanitised HTML, then diagrams.
 *
 * Written as a factory so Node tests can inject the same libraries the browser
 * loads. Everything that reaches innerHTML passes through DOMPurify, because
 * lesson text can contain content derived from outside resources.
 */
(function (root, factory) {
	if (typeof module === "object" && module.exports) module.exports = factory();
	else root.LearnRender = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
	function escapeHtml(s) {
		return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
	}

	function create(deps) {
		const { Marked, katex, DOMPurify, mermaid } = deps;

		const math = (tex, display) =>
			katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html", trust: false, strict: "ignore" });

		const md = new Marked({ gfm: true, breaks: false });
		md.use({
			extensions: [
				{
					name: "blockMath",
					level: "block",
					// Block math only starts at the beginning of a line; a $$ in the middle
					// of a sentence must not tear the paragraph apart.
					start(src) {
						const m = /^\$\$/m.exec(src);
						return m ? m.index : undefined;
					},
					tokenizer(src) {
						const m = /^\$\$\n?([\s\S]+?)\n?\$\$[ \t]*(?:\n|$)/.exec(src);
						if (m) return { type: "blockMath", raw: m[0], text: m[1].trim() };
					},
					renderer: (t) => `<div class="math-block">${math(t.text, true)}</div>\n`,
				},
				{
					name: "inlineDisplayMath",
					level: "inline",
					start(src) {
						const i = src.indexOf("$$");
						return i < 0 ? undefined : i;
					},
					tokenizer(src) {
						const m = /^\$\$([^$\n]+?)\$\$/.exec(src);
						if (m) return { type: "inlineDisplayMath", raw: m[0], text: m[1].trim() };
					},
					renderer: (t) => `<span class="math-inline-display">${math(t.text, true)}</span>`,
				},
				{
					name: "inlineMath",
					level: "inline",
					start(src) {
						const i = src.indexOf("$");
						return i < 0 ? undefined : i;
					},
					tokenizer(src) {
						const m = /^\$(?![\s$])((?:\\.|[^$\\\n])+?)(?<![\s\\])\$(?!\d)/.exec(src);
						if (m) return { type: "inlineMath", raw: m[0], text: m[1] };
					},
					renderer: (t) => math(t.text, false),
				},
			],
		});

		// Models sometimes wrap a formula in backticks, which Markdown treats as
		// literal code. A code span that is entirely one $...$ (or $$...$$) formula
		// is almost certainly meant as math, so draw it as math. Anything else
		// stays code.
		const unescape = (t) =>
			t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
		md.use({
			renderer: {
				codespan(token) {
					const raw = unescape(String(token.text));
					const m = /^\$\$([^$]+)\$\$$/.exec(raw) || /^\$(?![\s$])([^$]+?)(?<![\s\\])\$$/.exec(raw);
					if (m) return math(m[1].trim(), raw.startsWith("$$"));
					return false;
				},
			},
		});

		if (DOMPurify.addHook) {
			DOMPurify.addHook("afterSanitizeAttributes", (node) => {
				if (node.tagName === "A") {
					node.setAttribute("target", "_blank");
					node.setAttribute("rel", "noopener noreferrer");
				}
			});
		}

		function sanitize(html) {
			return DOMPurify.sanitize(html, {
				USE_PROFILES: { html: true, svg: true },
				FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "iframe", "object", "embed", "link", "meta", "base"],
				FORBID_ATTR: ["srcset", "formaction", "ping"],
				ADD_ATTR: ["target"],
			});
		}

		function renderMarkdown(text) {
			return sanitize(md.parse(String(text ?? "")));
		}

		let counter = 0;
		let themeName = "neutral";

		function initMermaid(dark) {
			themeName = dark ? "dark" : "neutral";
			if (mermaid) mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: themeName });
		}

		// Replace each rendered ```mermaid block with its diagram. A diagram that
		// fails to draw is replaced by a visible notice plus its source, never hidden.
		async function drawDiagrams(el) {
			if (!mermaid) return;
			const blocks = el.querySelectorAll("pre > code.language-mermaid");
			for (const code of blocks) {
				const pre = code.parentElement;
				const src = code.textContent || "";
				const holder = el.ownerDocument.createElement("div");
				holder.className = "diagram";
				try {
					const { svg } = await mermaid.render("d" + ++counter, src);
					holder.innerHTML = svg;
				} catch (e) {
					holder.className = "diagram diagram-error";
					holder.innerHTML = '<p class="diagram-note">This diagram could not be drawn.</p><pre></pre>';
					holder.querySelector("pre").textContent = src;
				}
				pre.replaceWith(holder);
			}
		}

		async function mount(el, text) {
			el.innerHTML = renderMarkdown(text);
			await drawDiagrams(el);
		}

		return { renderMarkdown, sanitize, mount, drawDiagrams, initMermaid, escapeHtml };
	}

	return { create, escapeHtml };
});
