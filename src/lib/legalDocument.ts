// Shared shape for the structured legal documents (Terms, Privacy). Each
// section's body is a list of typed blocks so the page reads as a scannable
// document rather than a wall of text. Block kinds:
//   p    — plain paragraph
//   lead — bold lead-in (label) + remaining text in the same paragraph
//   list — unordered list
//   h3   — sub-section heading inside a numbered section
export type Block =
	| { kind: 'p'; text: string }
	| { kind: 'lead'; label: string; text: string }
	| { kind: 'list'; items: string[] }
	| { kind: 'h3'; text: string };

export type Section = {
	// Anchor IDs are part of the public URL contract — external links (and the
	// /tos legacy redirect) depend on them, so don't rename without updating
	// callers.
	id: string;
	title: string;
	body: Block[];
};
