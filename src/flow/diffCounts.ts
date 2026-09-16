import type { DiffCounts, Graph, ItemDiff } from "../api/types";
import { groupDiffByNode } from "./diffGroups";

/**
 * Review header pills, one per question (or section) group. Extra option
 * and edge rows under the same question do not bump the count.
 */
export function questionDiffCounts(
  items: readonly ItemDiff[],
  graph: Graph,
): DiffCounts {
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const group of groupDiffByNode(items, graph)) {
    if (group.kind !== "question") {
      changed += 1;
      continue;
    }
    if (group.items.some((item) => item.kind === "question" && item.change === "added")) {
      added += 1;
    } else if (
      group.items.some((item) => item.kind === "question" && item.change === "removed")
    ) {
      removed += 1;
    } else {
      changed += 1;
    }
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
