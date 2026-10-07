import * as fs from "node:fs";
import * as path from "node:path";

// A topic is a plain folder of markdown files under topics/<slug>/.

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

export function slugify(title: string): string {
	const slug = title
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48)
		.replace(/-+$/g, "");
	return slug || "topic";
}

export function topicsRoot(cwd: string): string {
	return path.join(cwd, "topics");
}

export function topicDir(cwd: string, slug: string): string {
	if (!SLUG_RE.test(slug)) throw new Error(`invalid topic slug "${slug}"`);
	return path.join(topicsRoot(cwd), slug);
}

// Topics, most recently touched first.
export function listTopics(cwd: string): { slug: string; touched: number }[] {
	const root = topicsRoot(cwd);
	if (!fs.existsSync(root)) return [];
	return fs
		.readdirSync(root, { withFileTypes: true })
		.filter((d) => d.isDirectory() && SLUG_RE.test(d.name))
		.map((d) => ({ slug: d.name, touched: lastTouched(path.join(root, d.name)) }))
		.sort((a, b) => b.touched - a.touched);
}

// Newest modification time of any markdown file in the topic.
export function lastTouched(dir: string): number {
	let newest = 0;
	for (const f of markdownFiles(dir)) newest = Math.max(newest, fs.statSync(f).mtimeMs);
	return newest || (fs.existsSync(dir) ? fs.statSync(dir).mtimeMs : 0);
}

export function markdownFiles(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	const out: string[] = [];
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory() && !e.name.startsWith(".")) out.push(...markdownFiles(p));
		else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
	}
	return out;
}

export function topicTitle(dir: string, slug: string): string {
	try {
		const m = /^#\s+(.+)$/m.exec(fs.readFileSync(path.join(dir, "MISSION.md"), "utf-8"));
		if (m) return m[1].replace(/^Mission:\s*/i, "").trim();
	} catch {
		// no mission yet
	}
	return slug.replace(/-/g, " ");
}
