import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DetailPanel } from "./DetailPanel";
import type { ChangeKinds } from "./graphElements";
import {
  E_Q2_TO_ARCHIVED,
  E_YES_TO_Q2,
  OPTION_YES,
  Q1,
  Q2,
  Q3_ARCHIVED,
  makeGraph,
} from "../test/fixtures";
import { renderWithProviders } from "../test/render";

// The trigger is a `<span class="opt-edit-btn">` inside a native
// `<summary>` (styled to match "Edit text" beside it) -- `<summary>`
// carries no accessible role jsdom's ARIA mapping recognizes, so these
// tests find it by its text instead of `getByRole("button", ...)`.
function changeDestinationTrigger(row: HTMLElement) {
  return within(row).getByText("Change destination", { selector: "span" });
}

function panelFor(questionId: string, editable = false, changeKinds?: ChangeKinds) {
  const graph = makeGraph();
  const question = graph.questions.find((item) => item.id === questionId);
  if (question === undefined) throw new Error("no such question in the fixture");
  renderWithProviders(
    <DetailPanel
      graph={graph}
      question={question}
      editable={editable}
      changeKinds={changeKinds}
      retargetingEdgeId={null}
      addingRouteOptionId={null}
      onSelectQuestion={vi.fn()}
      onStartRetarget={vi.fn()}
      onStartAddRoute={vi.fn()}
      onCancelPick={vi.fn()}
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
        retargetingEdgeId={null}
        addingRouteOptionId={null}
        onSelectQuestion={vi.fn()}
        onStartRetarget={vi.fn()}
        onStartAddRoute={vi.fn()}
        onCancelPick={vi.fn()}
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
      screen.queryByRole("button", { name: "+ Add a default route" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("appear, collapsed, once the version is an open draft", async () => {
    const user = userEvent.setup();
    panelFor(Q1, true);

    // Closed by default -- opening it is what reveals the actual form. Q1
    // takes options, so the default-route section's own button is
    // labeled distinctly from "Add a specific route" (that name is
    // reserved for a specific answer's own card -- see below).
    const toggle = screen.getByRole("button", { name: "+ Add a default route" });
    expect(screen.queryByRole("button", { name: "Add route" })).not.toBeInTheDocument();

    await user.click(toggle);

    expect(screen.getByRole("button", { name: "Add route" })).toBeInTheDocument();
  });

  it("keep an answer's rename/delete controls collapsed until Edit text is clicked", async () => {
    const user = userEvent.setup();
    panelFor(Q1, true);
    const section = screen.getByRole("region", { name: /^Options/ });

    expect(within(section).queryByLabelText("Label")).not.toBeInTheDocument();
    expect(
      within(section).queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();

    await user.click(
      within(section).getAllByRole("button", { name: "Edit text" })[0] as HTMLElement,
    );

    expect(within(section).getByLabelText("Label")).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("offers no destination controls at all on a published version", () => {
    panelFor(Q1, false);
    expect(
      screen.queryByText("Change destination", { selector: "span" }),
    ).not.toBeInTheDocument();
  });

  it("shows a route's Change-destination popup without needing that answer's Edit text", async () => {
    // Unlike Remove (still behind Edit text -- see the test above), this
    // acts immediately and isn't destructive, so it doesn't need the extra
    // click.
    const user = userEvent.setup();
    panelFor(Q1, true);

    const yesRow = screen.getByText("Yes").closest("li") as HTMLElement;
    await user.click(changeDestinationTrigger(yesRow));

    expect(
      within(yesRow).getByRole("button", { name: "Jump to a specific question" }),
    ).toBeInTheDocument();
    expect(
      within(yesRow).getByRole("button", { name: "End the flow here" }),
    ).toBeInTheDocument();
    expect(
      within(yesRow).queryByRole("button", { name: "Remove" }),
    ).not.toBeInTheDocument();
  });

  it("asks the map to start a retarget, naming the route being retargeted", async () => {
    const user = userEvent.setup();
    const onStartRetarget = vi.fn();
    const graph = makeGraph();
    const question = graph.questions.find((item) => item.id === Q1);
    if (question === undefined) throw new Error("no such question in the fixture");
    renderWithProviders(
      <DetailPanel
        graph={graph}
        question={question}
        editable
        retargetingEdgeId={null}
        addingRouteOptionId={null}
        onSelectQuestion={vi.fn()}
        onStartRetarget={onStartRetarget}
        onStartAddRoute={vi.fn()}
        onCancelPick={vi.fn()}
      />,
    );

    const yesRow = screen.getByText("Yes").closest("li") as HTMLElement;
    await user.click(changeDestinationTrigger(yesRow));
    await user.click(
      within(yesRow).getByRole("button", { name: "Jump to a specific question" }),
    );

    expect(onStartRetarget).toHaveBeenCalledWith(E_YES_TO_Q2, 'Where "Yes" leads');
  });

  it("shows Cancel, not Change destination, on the row currently mid-retarget", async () => {
    const user = userEvent.setup();
    const onCancelPick = vi.fn();
    const graph = makeGraph();
    const question = graph.questions.find((item) => item.id === Q1);
    if (question === undefined) throw new Error("no such question in the fixture");
    renderWithProviders(
      <DetailPanel
        graph={graph}
        question={question}
        editable
        retargetingEdgeId={E_YES_TO_Q2}
        addingRouteOptionId={null}
        onSelectQuestion={vi.fn()}
        onStartRetarget={vi.fn()}
        onStartAddRoute={vi.fn()}
        onCancelPick={onCancelPick}
      />,
    );

    const yesRow = screen.getByText("Yes").closest("li") as HTMLElement;

    expect(
      within(yesRow).queryByText("Change destination", { selector: "span" }),
    ).not.toBeInTheDocument();
    await user.click(within(yesRow).getByRole("button", { name: "Cancel retarget" }));

    expect(onCancelPick).toHaveBeenCalled();
  });

  it("offers no 'Add a specific route' on an answer that already has one", () => {
    // "Yes" already routes to Q2 in the fixture -- adding a second route
    // through this affordance isn't offered; retargeting the existing one
    // is the way to change where it goes.
    panelFor(Q1, true);

    const yesRow = screen.getByText("Yes").closest("li") as HTMLElement;
    expect(
      within(yesRow).queryByRole("button", { name: "Add a specific route" }),
    ).not.toBeInTheDocument();
  });

  it("asks the map to start adding a route for an answer that has none yet", async () => {
    const user = userEvent.setup();
    const onStartAddRoute = vi.fn();
    const graph = makeGraph();
    // Strip "Yes"'s existing edge so it has no route yet -- the affordance
    // this test exercises is only offered in that case.
    graph.edges = graph.edges.filter((item) => item.id !== E_YES_TO_Q2);
    const question = graph.questions.find((item) => item.id === Q1);
    if (question === undefined) throw new Error("no such question in the fixture");
    renderWithProviders(
      <DetailPanel
        graph={graph}
        question={question}
        editable
        retargetingEdgeId={null}
        addingRouteOptionId={null}
        onSelectQuestion={vi.fn()}
        onStartRetarget={vi.fn()}
        onStartAddRoute={onStartAddRoute}
        onCancelPick={vi.fn()}
      />,
    );

    const yesRow = screen.getByText("Yes").closest("li") as HTMLElement;
    await user.click(
      within(yesRow).getByRole("button", { name: "Add a specific route" }),
    );

    expect(onStartAddRoute).toHaveBeenCalledWith(Q1, OPTION_YES, expect.any(String));
  });

  it("shows Cancel specific route on the answer currently mid-add", async () => {
    const user = userEvent.setup();
    const onCancelPick = vi.fn();
    const graph = makeGraph();
    graph.edges = graph.edges.filter((item) => item.id !== E_YES_TO_Q2);
    const question = graph.questions.find((item) => item.id === Q1);
    if (question === undefined) throw new Error("no such question in the fixture");
    renderWithProviders(
      <DetailPanel
        graph={graph}
        question={question}
        editable
        retargetingEdgeId={null}
        addingRouteOptionId={OPTION_YES}
        onSelectQuestion={vi.fn()}
        onStartRetarget={vi.fn()}
        onStartAddRoute={vi.fn()}
        onCancelPick={onCancelPick}
      />,
    );

    const yesRow = screen.getByText("Yes").closest("li") as HTMLElement;

    expect(
      within(yesRow).queryByRole("button", { name: "Add a specific route" }),
    ).not.toBeInTheDocument();
    await user.click(
      within(yesRow).getByRole("button", { name: "Cancel specific route" }),
    );

    expect(onCancelPick).toHaveBeenCalled();
  });

  it("disables 'End the flow here' on a route that already ends the flow", async () => {
    const user = userEvent.setup();
    panelFor(Q1, true);

    const yesRow = screen.getByText("Yes").closest("li") as HTMLElement;
    const noRow = screen.getByText("No").closest("li") as HTMLElement;
    await user.click(changeDestinationTrigger(yesRow));
    await user.click(changeDestinationTrigger(noRow));

    expect(
      within(yesRow).getByRole("button", { name: "End the flow here" }),
    ).toBeEnabled();
    expect(
      within(noRow).getByRole("button", { name: "End the flow here" }),
    ).toBeDisabled();
  });

  it("offers a one-click fall-through only when this question has a default route", async () => {
    // Base fixture: Q1 has no question-level (default route) edge, so
    // "Yes"'s own edge has nothing to fall through to -- no button.
    const user = userEvent.setup();
    panelFor(Q1, true);
    const yesRow = screen.getByText("Yes").closest("li") as HTMLElement;
    await user.click(changeDestinationTrigger(yesRow));
    expect(
      within(yesRow).queryByRole("button", { name: /Use the default route/ }),
    ).not.toBeInTheDocument();
  });

  it("offers a one-click fall-through on a per-option edge once this question has a default route", async () => {
    const user = userEvent.setup();
    const graph = makeGraph();
    // Give Q1 a question-level (default route) edge alongside "Yes"'s
    // own -- exactly the shape the button exists for: b points somewhere
    // explicitly, the default route already points somewhere too, so
    // removing b's own edge is one click away instead of Edit-then-Remove.
    graph.edges = [
      ...graph.edges,
      {
        id: "fallback-edge",
        from_question: Q1,
        from_option: null,
        to_question: Q2,
        priority: 2,
      },
    ];
    const question = graph.questions.find((item) => item.id === Q1);
    if (question === undefined) throw new Error("no such question in the fixture");
    renderWithProviders(
      <DetailPanel
        graph={graph}
        question={question}
        editable
        retargetingEdgeId={null}
        addingRouteOptionId={null}
        onSelectQuestion={vi.fn()}
        onStartRetarget={vi.fn()}
        onStartAddRoute={vi.fn()}
        onCancelPick={vi.fn()}
      />,
    );

    const yesRow = screen.getByText("Yes").closest("li") as HTMLElement;
    // Available without opening this answer's Edit text toggle, like the
    // rest of "Change destination" -- it acts immediately and isn't
    // hidden away.
    await user.click(changeDestinationTrigger(yesRow));
    expect(
      within(yesRow).getByRole("button", { name: "Use the default route instead" }),
    ).toBeEnabled();
  });

  it("offers no fall-through button on the default route's own row", async () => {
    const user = userEvent.setup();
    const graph = makeGraph();
    graph.edges = [
      ...graph.edges,
      {
        id: "fallback-edge",
        from_question: Q1,
        from_option: null,
        to_question: Q2,
        priority: 2,
      },
    ];
    const question = graph.questions.find((item) => item.id === Q1);
    if (question === undefined) throw new Error("no such question in the fixture");
    renderWithProviders(
      <DetailPanel
        graph={graph}
        question={question}
        editable
        retargetingEdgeId={null}
        addingRouteOptionId={null}
        onSelectQuestion={vi.fn()}
        onStartRetarget={vi.fn()}
        onStartAddRoute={vi.fn()}
        onCancelPick={vi.fn()}
      />,
    );

    const defaultRouteSection = screen
      .getByText("Default route")
      .closest(".fallback-section") as HTMLElement;
    await user.click(changeDestinationTrigger(defaultRouteSection));
    expect(
      within(defaultRouteSection).queryByRole("button", {
        name: /Use the default route/,
      }),
    ).not.toBeInTheDocument();
  });

  it("offers no per-option add-route affordance on a question whose answers select nothing", async () => {
    // A scale question has no options at all, so there's no per-option
    // card to nest an "Add a specific route" into -- only the section-wide
    // default route, which every route on such a question uses. Q2's own
    // default route is stripped here so that affordance is actually
    // offered -- the base fixture already has one (E_Q2_TO_ARCHIVED),
    // which the "hide when one already exists" rule would otherwise hide
    // it behind.
    const user = userEvent.setup();
    const graph = makeGraph();
    graph.edges = graph.edges.filter((item) => item.id !== E_Q2_TO_ARCHIVED);
    const question = graph.questions.find((item) => item.id === Q2);
    if (question === undefined) throw new Error("no such question in the fixture");
    renderWithProviders(
      <DetailPanel
        graph={graph}
        question={question}
        editable
        retargetingEdgeId={null}
        addingRouteOptionId={null}
        onSelectQuestion={vi.fn()}
        onStartRetarget={vi.fn()}
        onStartAddRoute={vi.fn()}
        onCancelPick={vi.fn()}
      />,
    );

    // The per-option button reads "Add a specific route" -- Q2 has no
    // options at all, so there's no card to render one on.
    expect(
      screen.queryByRole("button", { name: "Add a specific route" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("This route applies no matter what's answered."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "+ Add a route" }));

    expect(screen.getByRole("button", { name: "Add route" })).toBeInTheDocument();
  });
});

describe("change highlighting", () => {
  it("shows a New flag when this draft added the question", () => {
    panelFor(Q1, false, {
      questions: new Map([[Q1, "added"]]),
      options: new Map(),
      edges: new Map(),
    });

    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.queryByText("Changed")).not.toBeInTheDocument();
  });

  it("shows a Changed flag instead of 'Nothing to report' when this draft changed the question", () => {
    panelFor(Q2, false, {
      questions: new Map([[Q2, "changed"]]),
      options: new Map(),
      edges: new Map(),
    });

    expect(screen.getByText("Changed")).toBeInTheDocument();
    expect(screen.queryByText("Nothing to report")).not.toBeInTheDocument();
  });

  it("badges an added option and a changed route", () => {
    panelFor(Q1, false, {
      questions: new Map(),
      options: new Map([[OPTION_YES, "added"]]),
      edges: new Map([[E_YES_TO_Q2, "changed"]]),
    });

    const yesRow = screen.getByText("Yes").closest("li") as HTMLElement;
    expect(within(yesRow).getByText("Added")).toBeInTheDocument();
    expect(within(yesRow).getByText("Changed")).toBeInTheDocument();
  });
});
