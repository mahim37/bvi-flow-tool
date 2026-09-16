import type { DiffCounts, Graph, ItemDiff } from "../api/types";

/**
 * Review header pills. `added` / `removed` are questions only. Every other
 * diff row (new edges, option edits, question field edits, sections) is
 * `changed`.
 */
export function questionDiffCounts(items: readonly ItemDiff[]): DiffCounts {
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const item of items) {
    if (item.kind === "question" && item.change === "added") added += 1;
    else if (item.kind === "question" && item.change === "removed") removed += 1;
    else changed += 1;
  }
  return { added, removed, changed };
}

/** Drop questions this draft added and then retired, and every option or
 * edge that hung off them. They never existed on the parent version, so
 * a reviewer should not see them as additions -- or as a messy archive
 * of something that was never published. */
export function visibleDiffItems(
  items: readonly ItemDiff[],
  graph: Graph,
): ItemDiff[] {
  const retiredAdds = new Set<string>();
  for (const item of items) {
    if (item.kind !== "question" || item.change !== "added" || item.draft_id === null) {
      continue;
    }
    const live = graph.questions.find((question) => question.id === item.draft_id);
    if (live === undefined || live.archived_at !== null) {
      retiredAdds.add(item.draft_id);
    }
  }
  if (retiredAdds.size === 0) return [...items];
  return items.filter((item) => {
    if (item.draft_id !== null && retiredAdds.has(item.draft_id)) return false;
    if (item.question_id !== null && retiredAdds.has(item.question_id)) return false;
    return true;
  });
}
