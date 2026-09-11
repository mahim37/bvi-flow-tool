import { describe, expect, it } from "vitest";

import { Q2, Q4_UNREACHABLE, makeGraph } from "../test/fixtures";
import { draftIssues } from "./draftIssues";
import { questionRefLabel } from "./labels";

const clean = {
  entry_question_id: makeGraph().diagnostics.entry_question_id,
  decision_point_question_ids: [],
  terminal_question_ids: [],
  unreachable_question_ids: [] as string[],
  uncovered_option_question_ids: [] as string[],
  back_edge_ids: [] as string[],
  dead_edge_ids: [] as string[],
  broken_edge_ids: [] as string[],
};

describe("draftIssues", () => {
  it("is empty when the graph is clean and publish would succeed", () => {
    expect(draftIssues(makeGraph({ diagnostics: clean }), null)).toEqual([]);
  });

  it("lists each faulty question once, merging kinds", () => {
    const graph = makeGraph();
    const q2 = graph.questions.find((question) => question.id === Q2);
    const q4 = graph.questions.find((question) => question.id === Q4_UNREACHABLE);
    if (q2 === undefined || q4 === undefined) {
      throw new Error("fixture is missing Q2 or Q4");
    }

    const items = draftIssues(graph, "Broken routes block publishing.");
    expect(items.map((item) => item.questionId)).toEqual([Q2, Q4_UNREACHABLE]);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    expect(items.some((item) => item.id === "publish-blocker")).toBe(false);

    expect(items[0]).toEqual({
      id: Q2,
      questionId: Q2,
      title: questionRefLabel(q2),
      tags: ["Dead route", "Broken route"],
    });
    expect(items[1]).toEqual({
      id: Q4_UNREACHABLE,
      questionId: Q4_UNREACHABLE,
      title: questionRefLabel(q4),
      tags: ["Unreachable", "Broken route"],
    });
  });

  it("keeps a blocker that diagnostics cannot locate", () => {
    const items = draftIssues(
      makeGraph({ diagnostics: clean }),
      "Break draft is missing.",
    );
    expect(items).toEqual([
      {
        id: "publish-blocker",
        questionId: null,
        title: "Break draft is missing.",
        tags: [],
      },
    ]);
  });

  it("names a missing entry point without inventing a destination", () => {
    const items = draftIssues(
      makeGraph({ diagnostics: { ...clean, entry_question_id: null } }),
      "No entry question.",
    );
    expect(items).toEqual([
      {
        id: "no-entry",
        questionId: null,
        title: "No entry point",
        tags: [],
      },
    ]);
  });
});
