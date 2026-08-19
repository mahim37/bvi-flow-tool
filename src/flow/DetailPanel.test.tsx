import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DetailPanel } from "./DetailPanel";
import { Q1, Q2, Q3_ARCHIVED, makeGraph } from "../test/fixtures";
import { renderWithProviders } from "../test/render";

function panelFor(questionId: string, editable = false) {
  const graph = makeGraph();
  const question = graph.questions.find((item) => item.id === questionId);
  if (question === undefined) throw new Error("no such question in the fixture");
  renderWithProviders(
    <DetailPanel
      graph={graph}
      question={question}
      editable={editable}
      onSelectQuestion={vi.fn()}
    />,
  );
}

describe("a live question", () => {
  it("shows the diagnostics the server computed", () => {
    panelFor(Q1);

    expect(screen.getByText("Entry point")).toBeInTheDocument();
    expect(screen.getByText("Decision point")).toBeInTheDocument();
    expect(screen.getByText("Can end the flow")).toBeInTheDocument();
  });

  it("lists outgoing edges in the order they are tried, not as served", () => {
    // Priority order is the routing semantics -- first matching guard
    // wins -- so the list is sorted by it rather than by whatever order
    // the payload happened to arrive in.
    const graph = makeGraph();
    const question = graph.questions.find((item) => item.id === Q1);
    if (question === undefined) throw new Error("no such question in the fixture");
    renderWithProviders(
      <DetailPanel
        graph={{ ...graph, edges: [...graph.edges].reverse() }}
        question={question}
        editable={false}
        onSelectQuestion={vi.fn()}
      />,
    );

    const section = screen.getByRole("region", { name: "Outgoing edges" });
    const guards = within(section)
      .getAllByRole("listitem")
      .map((row) => within(row).getByText(/^(Yes|No|Any answer)$/).textContent);

    expect(guards).toEqual(["Yes", "No"]);
  });

  it("names an end-of-flow target rather than leaving it blank", () => {
    // `to_question === null` is the flow ending, which is behaviour, not
    // missing data.
    panelFor(Q1);

    expect(screen.getByText("End of flow")).toBeInTheDocument();
  });

  it("explains a dead edge in terms of the guard, not the target", () => {
    panelFor(Q2);

    expect(screen.getByText(/does not offer that option/)).toBeInTheDocument();
  });

  it("explains a broken edge as something the resolver raises on", () => {
    panelFor(Q2);

    expect(screen.getByText(/raises rather than routing/)).toBeInTheDocument();
  });
});

describe("an archived question", () => {
  it("says why it is on the map and claims nothing about its routing", () => {
    panelFor(Q3_ARCHIVED);

    expect(
      screen.getByText(/shown only because an edge still points at it/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Entry point")).not.toBeInTheDocument();
    expect(screen.queryByText("Can end the flow")).not.toBeInTheDocument();
  });
});

describe("edit controls", () => {
  it("are absent on a published version", () => {
    panelFor(Q1, false);

    expect(screen.queryByRole("button", { name: "Add edge" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("appear once the version is an open draft", () => {
    panelFor(Q1, true);

    expect(screen.getByRole("button", { name: "Add edge" })).toBeInTheDocument();
  });

  it("offer no per-option guard on a question whose answers select nothing", () => {
    // A scale answer never selects an option, so a per-option edge on it
    // is dead the moment it is saved. The server refuses it too; this just
    // stops the UI from offering it.
    panelFor(Q2, true);
    const guard = screen.getByLabelText("When the answer is");

    expect(within(guard).getAllByRole("option")).toHaveLength(1);
    expect(screen.getByText(/do not select options/)).toBeInTheDocument();
  });
});
