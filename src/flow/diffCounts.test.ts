import { describe, expect, it } from "vitest";

import type { ItemDiff } from "../api/types";
import { Q1, Q3_ARCHIVED, makeGraph } from "../test/fixtures";
import { questionDiffCounts, visibleDiffItems } from "./diffCounts";

function item(
  overrides: Partial<ItemDiff> & Pick<ItemDiff, "kind" | "change" | "key">,
): ItemDiff {
  return {
    base_id: null,
    draft_id: null,
    question_id: Q1,
    fields: [],
    ...overrides,
  };
}

describe("questionDiffCounts", () => {
  it("counts added and removed questions only, and puts every other row in changed", () => {
    expect(
      questionDiffCounts([
        item({ kind: "question", change: "added", key: "new" }),
        item({ kind: "question", change: "added", key: "also-new" }),
        item({ kind: "question", change: "removed", key: "gone" }),
        item({ kind: "question", change: "changed", key: "edited" }),
        item({ kind: "option", change: "added", key: "yes" }),
        item({ kind: "edge", change: "added", key: "route" }),
        item({ kind: "section", change: "changed", key: "intro" }),
      ]),
    ).toEqual({ added: 2, removed: 1, changed: 4 });
  });

  it("is zeros when there are no rows", () => {
    expect(questionDiffCounts([])).toEqual({ added: 0, removed: 0, changed: 0 });
  });
});

describe("visibleDiffItems", () => {
  const ghost = "aaaaaaaa-0000-4000-8000-000000000099";

  it("drops a draft-only question that was added then retired, and rows that hung off it", () => {
    const items: ItemDiff[] = [
      item({
        kind: "question",
        change: "added",
        key: "Q9",
        draft_id: ghost,
        question_id: ghost,
      }),
      item({ kind: "option", change: "added", key: "yes", question_id: ghost }),
      item({ kind: "edge", change: "added", key: "route", question_id: ghost }),
      item({ kind: "question", change: "added", key: "Q1", draft_id: Q1 }),
    ];
    expect(visibleDiffItems(items, makeGraph()).map((row) => row.key)).toEqual(["Q1"]);
  });

  it("drops an added question that is still on the graph only as archived", () => {
    const items: ItemDiff[] = [
      item({
        kind: "question",
        change: "added",
        key: "Q3",
        draft_id: Q3_ARCHIVED,
        question_id: Q3_ARCHIVED,
      }),
      item({ kind: "question", change: "changed", key: "Q1", draft_id: Q1 }),
    ];
    expect(visibleDiffItems(items, makeGraph()).map((row) => row.key)).toEqual(["Q1"]);
  });
});
