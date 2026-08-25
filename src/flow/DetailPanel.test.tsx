import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("groups each answer's edge under that answer, regardless of edge order", () => {
    // Options drive the card order now, not edge priority -- so reversing
    // the edges array should change nothing about which card a guard's
    // destination shows up under.
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

    const section = screen.getByRole("region", { name: /^Options/ });
    const guards = within(section)
      .getAllByRole("listitem")
      .map((row) => within(row).getByText(/^(Yes|No)$/).textContent);

    expect(guards).toEqual(["Yes", "No"]);
  });

  it("names an end-of-flow target rather than leaving it blank", () => {
    // `to_question === null` is the flow ending, which is behaviour, not
    // missing data.
    panelFor(Q1);

    expect(screen.getByText("End of flow")).toBeInTheDocument();
  });

  it("explains a dead edge in terms of the answer, not the target", () => {
    panelFor(Q2);

    expect(
      screen.getByText(/not one of this question's options anymore/),
    ).toBeInTheDocument();
  });

  it("explains a broken edge as something that would fail, not just look odd", () => {
    panelFor(Q2);

    expect(screen.getByText(/fail instead of continuing/)).toBeInTheDocument();
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

    expect(
      screen.queryByRole("button", { name: "+ Add a route" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("appear, collapsed, once the version is an open draft", async () => {
    const user = userEvent.setup();
    panelFor(Q1, true);

    // Closed by default -- opening it is what reveals the actual form.
    const toggle = screen.getByRole("button", { name: "+ Add a route" });
    expect(screen.queryByRole("button", { name: "Add route" })).not.toBeInTheDocument();

    await user.click(toggle);

    expect(screen.getByRole("button", { name: "Add route" })).toBeInTheDocument();
  });

  it("keep an answer's rename/reorder/delete controls collapsed until Edit is clicked", async () => {
    const user = userEvent.setup();
    panelFor(Q1, true);
    const section = screen.getByRole("region", { name: /^Options/ });

    expect(within(section).queryByLabelText("Label")).not.toBeInTheDocument();
    expect(
      within(section).queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();

    await user.click(within(section).getAllByRole("button", { name: "Edit" })[0] as HTMLElement);

    expect(within(section).getByLabelText("Label")).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("offer no per-option guard on a question whose answers select nothing", async () => {
    // A scale answer never selects an option, so a per-option edge on it
    // is dead the moment it is saved. The server refuses it too; this just
    // stops the UI from offering it.
    const user = userEvent.setup();
    panelFor(Q2, true);

    await user.click(screen.getByRole("button", { name: "+ Add a route" }));
    const guard = screen.getByLabelText("When the answer is");

    expect(within(guard).getAllByRole("option")).toHaveLength(1);
    expect(
      screen.getByText(/this question has no separate answer options/),
    ).toBeInTheDocument();
  });
});
