import { describe, expect, it } from "vitest";

import type { ItemDiff } from "../api/types";
import {
  Q1,
  Q2,
  Q3_ARCHIVED,
  Q4_UNREACHABLE,
  RISK_BASE,
  RISK_DRAFT,
  makeGraph,
} from "../test/fixtures";
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
  it("counts one question even when several of its edges and answers also changed", () => {
    expect(
      questionDiffCounts(
        [
          item({
            kind: "question",
            change: "added",
            key: "Q1",
            draft_id: Q1,
            question_id: Q1,
          }),
          item({ kind: "option", change: "added", key: "yes", question_id: Q1 }),
          item({ kind: "edge", change: "added", key: "route", question_id: Q1 }),
          item({
            kind: "question",
            change: "removed",
            key: "Q2",
            base_id: Q2,
            question_id: Q2,
          }),
          item({
            kind: "question",
            change: "changed",
            key: "Q4",
            draft_id: Q4_UNREACHABLE,
            question_id: Q4_UNREACHABLE,
          }),
          item({ kind: "section", change: "changed", key: "intro", question_id: null }),
        ],
        makeGraph(),
      ),
    ).toEqual({ added: 1, removed: 1, changed: 2 });
  });

  it("counts a retired inherited question as removed, not changed", () => {
    // `diffing._sides` reports an archival as a changed `archived` field,
    // since the code still matches on both sides. Rows on that question
    // ride along under it rather than counting on their own.
    expect(
      questionDiffCounts(
        [
          item({
            kind: "question",
            change: "changed",
            key: "risk_2",
            base_id: RISK_BASE,
            draft_id: RISK_DRAFT,
            question_id: RISK_DRAFT,
            fields: [{ field: "archived", base: false, draft: true }],
          }),
          item({
            kind: "option",
            change: "changed",
            key: "risk_2.high",
            question_id: RISK_DRAFT,
          }),
        ],
        makeGraph(),
      ),
    ).toEqual({ added: 0, removed: 1, changed: 0 });
  });

  it("is zeros when there are no rows", () => {
    expect(questionDiffCounts([], makeGraph())).toEqual({
      added: 0,
      removed: 0,
      changed: 0,
    });
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
