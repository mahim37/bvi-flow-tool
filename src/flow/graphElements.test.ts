import { describe, expect, it } from "vitest";

import type { EdgeData, NodeData } from "./graphElements";
import {
  END_NODE_ID,
  buildElements,
  changeKindsFromDiff,
  missingNodeId,
} from "./graphElements";
import {
  E_FOREIGN_TO_Q2,
  E_NO_TO_END,
  E_Q2_DEAD,
  E_Q2_TO_ARCHIVED,
  E_Q4_TO_MISSING,
  E_YES_TO_Q2,
  FOREIGN_QUESTION,
  OPTION_YES,
  Q1,
  Q2,
  Q3_ARCHIVED,
  Q4_UNREACHABLE,
  makeGraph,
} from "../test/fixtures";
import type { ItemDiff, VersionDiff } from "../api/types";

function nodes(graph = makeGraph(), diff?: VersionDiff) {
  return new Map(
    buildElements(graph, diff)
      .filter((element) => element.group === "nodes")
      .map((element) => [
        element.data.id as string,
        element.data as unknown as NodeData,
      ]),
  );
}

function edges(graph = makeGraph(), diff?: VersionDiff) {
  return new Map(
    buildElements(graph, diff)
      .filter((element) => element.group === "edges")
      .map((element) => [
        element.data.id as string,
        element.data as unknown as EdgeData,
      ]),
  );
}

function itemDiff(
  overrides: Partial<ItemDiff> & Pick<ItemDiff, "kind" | "change">,
): ItemDiff {
  return {
    key: "x",
    base_id: null,
    draft_id: null,
    question_id: null,
    fields: [],
    ...overrides,
  };
}

function makeDiff(overrides: Partial<VersionDiff> = {}): VersionDiff {
  return {
    is_empty: false,
    sections: [],
    questions: [],
    options: [],
    edges: [],
    ...overrides,
  };
}

describe("nodes", () => {
  it("labels a node by its code, never by its position", () => {
    // Under graph routing `display_order` is presentational. A label built
    // from it would reintroduce the identity problem explicit edges exist
    // to remove: insert a question and every label shifts. The visible
    // label (break-backend parity: prompt first, then a type glyph and
    // the code) still has to carry that same code regardless of
    // `display_order`, even though the code is no longer the whole label.
    const graph = makeGraph();
    const shuffled = makeGraph({
      questions: graph.questions.map((question) => ({
        ...question,
        display_order: 100 - question.display_order,
      })),
    });

    const shuffledLabels = nodes(shuffled);
    expect(nodes().get(Q1)?.label).toBe(shuffledLabels.get(Q1)?.label);
    expect(nodes().get(Q2)?.label).toBe(shuffledLabels.get(Q2)?.label);
    expect(shuffledLabels.get(Q1)?.label?.endsWith("Q1")).toBe(true);
    expect(shuffledLabels.get(Q2)?.label?.endsWith("Q2")).toBe(true);
  });

  it("marks the entry, the decision point and the terminal from the audit", () => {
    const built = nodes();

    expect(built.get(Q1)?.isEntry).toBe(true);
    expect(built.get(Q1)?.isDecision).toBe(true);
    expect(built.get(Q1)?.isTerminal).toBe(true);
    expect(built.get(Q2)?.isEntry).toBe(false);
  });

  it("reports a question nothing routes to as unreachable", () => {
    expect(nodes().get(Q4_UNREACHABLE)?.isUnreachable).toBe(true);
  });

  it("gives an archived question no routing flags at all", () => {
    // It is drawn only because something still points at it. Claiming it
    // was terminal or unreachable would invent a fact about a question the
    // resolver never serves.
    const archived = nodes().get(Q3_ARCHIVED);

    expect(archived?.kind).toBe("archived");
    expect(archived?.isEntry).toBe(false);
    expect(archived?.isTerminal).toBe(false);
    expect(archived?.isUnreachable).toBe(false);
    expect(archived?.hasFault).toBe(false);
  });

  it("flags the source of a dead or broken edge as faulted", () => {
    expect(nodes().get(Q2)?.hasFault).toBe(true);
  });

  it("adds one shared end node, however many edges end the flow", () => {
    const built = nodes();

    expect(built.get(END_NODE_ID)?.kind).toBe("end");
    expect([...built.keys()].filter((id) => id === END_NODE_ID)).toHaveLength(1);
  });

  it("omits the end node when nothing ends the flow", () => {
    const graph = makeGraph();
    const withoutEnds = makeGraph({
      edges: graph.edges.filter((edge) => edge.to_question !== null),
    });

    expect(nodes(withoutEnds).has(END_NODE_ID)).toBe(false);
  });

  it("invents a placeholder for a target this version does not contain", () => {
    // Without it the arrow would have nowhere to land and would silently
    // disappear -- taking the only visible evidence of the break with it.
    const placeholder = nodes().get(missingNodeId(FOREIGN_QUESTION));

    expect(placeholder?.kind).toBe("missing");
    expect(placeholder?.hasFault).toBe(true);
  });

  it("shares one placeholder for a question missing on both ends", () => {
    // FOREIGN_QUESTION is E_Q4_TO_MISSING's target and E_FOREIGN_TO_Q2's
    // source -- one node either way, not two, and not a duplicate id
    // Cytoscape would refuse to add.
    const built = nodes();

    expect(
      [...built.keys()].filter((id) => id === missingNodeId(FOREIGN_QUESTION)),
    ).toHaveLength(1);
  });
});

describe("edges", () => {
  it("routes an end-of-flow edge to the shared end node", () => {
    expect(edges().get(E_NO_TO_END)?.target).toBe(END_NODE_ID);
  });

  it("routes a cross-version edge to the placeholder", () => {
    expect(edges().get(E_Q4_TO_MISSING)?.target).toBe(missingNodeId(FOREIGN_QUESTION));
  });

  it("sources a cross-version edge from the placeholder", () => {
    // Same fallback, near end of the arrow this time -- a source this
    // payload doesn't contain used to have no placeholder at all, which
    // Cytoscape treats as fatal (it refuses to add an edge whose source
    // isn't already an element) rather than just an edge failing to draw.
    expect(edges().get(E_FOREIGN_TO_Q2)?.source).toBe(missingNodeId(FOREIGN_QUESTION));
  });

  it("names an option's own guard but leaves the question-level one blank", () => {
    // Every *specific* option gets a label; the one left unlabelled at a
    // node already reads as "whatever wasn't one of those" without
    // spelling out "anything else" on the canvas itself.
    const built = edges();

    expect(built.get(E_Q2_TO_ARCHIVED)?.guard).toBe("");
    expect(built.get(E_NO_TO_END)?.guard).toBe("No");
  });

  it("says so when the guard is an option the question does not offer", () => {
    // Q2 does not own OPTION_YES, which is exactly why the server calls
    // this edge dead. Falling back to the option's label would make it
    // read like a working guard.
    const dead = edges().get(E_Q2_DEAD);

    expect(dead?.guard).toBe("unknown option");
    expect(dead?.isDead).toBe(true);
    expect(makeGraph().edges.find((edge) => edge.id === E_Q2_DEAD)?.from_option).toBe(
      OPTION_YES,
    );
  });

  it("carries the broken flag through from the audit", () => {
    expect(edges().get(E_Q2_TO_ARCHIVED)?.isBroken).toBe(true);
    expect(edges().get(E_NO_TO_END)?.isBroken).toBe(false);
  });
});

describe("change highlighting", () => {
  it("leaves changeKind null everywhere with no diff passed", () => {
    expect(nodes().get(Q1)?.changeKind).toBe(null);
    expect(edges().get(E_YES_TO_Q2)?.changeKind).toBe(null);
  });

  it("marks a brand-new question added, not changed, and badges it to match", () => {
    const diff = makeDiff({
      questions: [itemDiff({ kind: "question", change: "added", question_id: Q1 })],
    });
    const built = nodes(makeGraph(), diff).get(Q1);

    expect(built?.changeKind).toBe("added");
    expect(built?.badgeKind).toBe("added");
  });

  it("marks an existing question changed when its own fields changed", () => {
    const diff = makeDiff({
      questions: [itemDiff({ kind: "question", change: "changed", question_id: Q1 })],
    });

    expect(nodes(makeGraph(), diff).get(Q1)?.changeKind).toBe("changed");
  });

  it("marks an existing question changed when one of its options changed, even though the question itself didn't", () => {
    const diff = makeDiff({
      options: [
        itemDiff({ kind: "option", change: "added", question_id: Q1, key: "new-opt" }),
      ],
    });

    expect(nodes(makeGraph(), diff).get(Q1)?.changeKind).toBe("changed");
  });

  it("leaves an archived question's changeKind null even when the diff names it", () => {
    // Archiving is exactly what put it in the diff -- it already has its
    // own "this is gone" treatment (`kind: "archived"`), so it doesn't
    // also need "changed".
    const diff = makeDiff({
      questions: [
        itemDiff({ kind: "question", change: "changed", question_id: Q3_ARCHIVED }),
      ],
    });

    expect(nodes(makeGraph(), diff).get(Q3_ARCHIVED)?.changeKind).toBe(null);
  });

  it("marks an added edge green and a changed edge gold", () => {
    const added = makeDiff({
      edges: [
        itemDiff({
          kind: "edge",
          change: "added",
          draft_id: E_YES_TO_Q2,
          question_id: Q1,
        }),
      ],
    });
    const changed = makeDiff({
      edges: [
        itemDiff({
          kind: "edge",
          change: "changed",
          draft_id: E_YES_TO_Q2,
          question_id: Q1,
        }),
      ],
    });

    expect(edges(makeGraph(), added).get(E_YES_TO_Q2)?.changeKind).toBe("added");
    expect(edges(makeGraph(), changed).get(E_YES_TO_Q2)?.changeKind).toBe("changed");
  });

  it("marks an added option green and a changed option gold", () => {
    const added = makeDiff({
      options: [
        itemDiff({ kind: "option", change: "added", draft_id: OPTION_YES, key: "yes" }),
      ],
    });
    const changed = makeDiff({
      options: [
        itemDiff({
          kind: "option",
          change: "changed",
          draft_id: OPTION_YES,
          key: "yes",
        }),
      ],
    });

    expect(changeKindsFromDiff(added).options.get(OPTION_YES)).toBe("added");
    expect(changeKindsFromDiff(changed).options.get(OPTION_YES)).toBe("changed");
  });
});

describe("section anchor", () => {
  // Q1 (display_order 1) and Q2 (display_order 2) share a section here --
  // neither has one in the base fixture.
  function graphWithSharedSection() {
    const graph = makeGraph();
    const sectionId = graph.sections[0]?.id;
    if (sectionId === undefined) throw new Error("fixture has no section");
    return makeGraph({
      questions: graph.questions.map((question) =>
        question.id === Q1 || question.id === Q2
          ? { ...question, section: sectionId }
          : question,
      ),
    });
  }

  it("gives a question with no section no anchor", () => {
    expect(nodes().get(Q1)?.sectionAnchorId).toBe(null);
  });

  it("gives the section's own first (lowest display_order) question no anchor", () => {
    expect(nodes(graphWithSharedSection()).get(Q1)?.sectionAnchorId).toBe(null);
  });

  it("anchors a later question in the same section to the first one", () => {
    expect(nodes(graphWithSharedSection()).get(Q2)?.sectionAnchorId).toBe(Q1);
  });

  it("excludes an archived question from being an anchor, or needing one", () => {
    const graph = makeGraph();
    const sectionId = graph.sections[0]?.id;
    if (sectionId === undefined) throw new Error("fixture has no section");
    // Q1 (lowest display_order) is archived here, so Q2 -- not Q1 -- should
    // become the section's live anchor, and Q1 itself gets none.
    const withArchivedFirst = makeGraph({
      questions: graph.questions.map((question) => {
        if (question.id === Q1) {
          return {
            ...question,
            section: sectionId,
            archived_at: "2026-01-01T00:00:00Z",
          };
        }
        if (question.id === Q2) return { ...question, section: sectionId };
        return question;
      }),
    });
    const built = nodes(withArchivedFirst);

    expect(built.get(Q1)?.sectionAnchorId).toBe(null);
    expect(built.get(Q2)?.sectionAnchorId).toBe(null);
  });
});
