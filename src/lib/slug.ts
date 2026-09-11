/** Codes read as short handles in the CSVs and on the canvas (e.g.
 * `moved_around`), not full sentences -- well under the server's 64-char
 * column limit, so a long label truncates instead of ever risking that
 * limit outright. */
const DEFAULT_MAX_LENGTH = 40;

/** Lowercase, underscore-separated handle derived from free text -- matches
 * the stable-code convention already seeded content uses. Truncates at a
 * word boundary rather than mid-word where possible. */
export function slugify(text: string, maxLength = DEFAULT_MAX_LENGTH): string {
  const full = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (full.length <= maxLength) return full;
  const cut = full.slice(0, maxLength);
  const boundary = cut.lastIndexOf("_");
  return (boundary > 0 ? cut.slice(0, boundary) : cut).replace(/_+$/, "");
}
