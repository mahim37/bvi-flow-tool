import { describe, expect, it } from "vitest";

import type { EdgeData, NodeData } from "./graphElements";
import { END_NODE_ID, buildElements, missingNodeId } from "./graphElements";
import {
  E_FOREIGN_TO_Q2,
  E_NO_TO_END,
  E_Q2_DEAD,
  E_Q2_TO_ARCHIVED,
  E_Q4_TO_MISSING,
  FOREIGN_QUESTION,
  OPTION_YES,
  Q1,
  Q2,
  Q3_ARCHIVED,
  Q4_UNREACHABLE,
  makeGraph,
} from "../test/fixtures";

function nodes(graph = makeGraph()) {
  return new Map(
    buildElements(graph)
      .filter((element) => element.group === "nodes")
      .map((element) => [
        element.data.id as string,
        element.data as unknown as NodeData,
      ]),
  );
}

function edges(graph = makeGraph()) {
  return new Map(
    buildElements(graph)
      .filter((element) => element.group === "edges")
      .map((element) => [
        element.data.id as string,
        element.data as unknown as EdgeData,
      ]),
  );
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
