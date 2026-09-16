import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DetailPanel } from "./DetailPanel";
import { INTEGER_ANSWER_EDGE_LABEL, type ChangeKinds } from "./graphElements";
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

// The trigger is a real Button (PopoverTrigger asChild), not a span
// inside <summary>.
function changeDestinationTrigger(row: HTMLElement) {
  return within(row).getByRole("button", { name: "Change destination" });
}

function defaultRouteFolder() {
  return screen.getByRole("group", {
    name: "Default route",
  });
}

function optionRow(label: string) {
  const section = screen.getByRole("region", { name: /^(Answers|Route)/ });
  return within(section).getByText(label, { exact: true }).closest("li") as HTMLElement;
}

function destinationMenu() {
  const menu = document.querySelector("[data-slot=popover-content]");
  if (menu === null) throw new Error("destination menu not open");
  return menu as HTMLElement;
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
    expect(screen.queryByText(/^QID /)).not.toBeInTheDocument();
    expect(
      screen.getByRole("complementary", {
        name: "Detail for Prompt for Q1",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("id: Q1")).not.toBeInTheDocument();
    expect(screen.getByText("Prompt for Q1")).toBeInTheDocument();
    expect(screen.queryByText("No section")).not.toBeInTheDocument();
    expect(screen.queryByText("Introduction")).not.toBeInTheDocument();
    const answers = screen.getByRole("region", { name: /^Answers/ });
    expect(within(answers).getByText("Single choice")).toBeInTheDocument();
  });

  it("names answers and destinations by label, without ids", () => {
    panelFor(Q1);

    const section = screen.getByRole("region", { name: /^Answers/ });
    expect(within(section).getByText("Yes")).toBeInTheDocument();
    expect(within(section).getByText("No")).toBeInTheDocument();
    expect(
      within(optionRow("Yes")).getByRole("heading", { name: "Choice: Yes" }),
    ).toBeInTheDocument();
    expect(
      within(optionRow("No")).getByRole("heading", { name: "Choice: No" }),
    ).toBeInTheDocument();
    expect(within(section).queryByText("id: yes")).not.toBeInTheDocument();
    expect(within(section).queryByText("id: no")).not.toBeInTheDocument();
    expect(within(section).queryByText("id: Q2")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "To: Prompt for Q2",
      }),
    ).toBeInTheDocument();
  });

  it("groups each answer's edge under that answer, regardless of edge order", () => {
    // Options drive the row order now, not edge priority -- so reversing
    // the edges array should change nothing about which row a guard's
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

    const section = screen.getByRole("region", { name: /^Answers/ });
    const guards = within(section)
      .getAllByRole("listitem")
      .map((row) => within(row).getByText(/^(Yes|No)$/).textContent);

    expect(guards).toEqual(["Yes", "No"]);
  });

  it("nests leftover answers inside the default route they actually take", () => {
    // Screenshot case: Yes has no edge of its own so it takes the
    // question-level route to Q2; No still has its own edge. Yes belongs
    // in the default-route folder with that shared destination, not as an
    // empty sibling row.
    const graph = makeGraph();
    graph.edges = [
      ...graph.edges.filter((item) => item.id !== E_YES_TO_Q2),
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
        editable={false}
        retargetingEdgeId={null}
        addingRouteOptionId={null}
        onSelectQuestion={vi.fn()}
        onStartRetarget={vi.fn()}
        onStartAddRoute={vi.fn()}
        onCancelPick={vi.fn()}
      />,
    );

    const defaultFolder = defaultRouteFolder();
    expect(within(defaultFolder).getByText("Yes")).toBeInTheDocument();
    expect(
      within(defaultFolder).queryByRole("heading", { name: /^Choice:/ }),
    ).not.toBeInTheDocument();
    expect(
      within(defaultFolder).getByRole("button", {
        name: "To: Prompt for Q2",
      }),
    ).toBeInTheDocument();
    expect(
      within(defaultFolder).getByRole("list", { name: /^Answers/ }),
    ).toBeInTheDocument();
    expect(within(defaultFolder).queryByText("No")).not.toBeInTheDocument();
    expect(defaultFolder.closest("[data-slot=card]")).toBeNull();

    const noRow = optionRow("No");
    expect(defaultFolder.contains(noRow)).toBe(false);
    expect(
      within(noRow).getByRole("heading", { name: "Choice: No" }),
    ).toBeInTheDocument();
    expect(within(noRow).getByText("End of flow")).toBeInTheDocument();
  });

  it("groups every leftover answer under one default route when none have their own", () => {
    const graph = makeGraph();
    graph.edges = [
      ...graph.edges.filter((item) => item.from_question !== Q1),
      {
        id: "fallback-edge",
        from_question: Q1,
        from_option: null,
        to_question: Q2,
        priority: 0,
      },
    ];
    const question = graph.questions.find((item) => item.id === Q1);
    if (question === undefined) throw new Error("no such question in the fixture");
    renderWithProviders(
      <DetailPanel
        graph={graph}
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

    const defaultFolder = defaultRouteFolder();
    const leftover = within(defaultFolder).getByRole("list", {
      name: /^Answers/,
    });
    expect(within(leftover).getByText("Yes")).toBeInTheDocument();
    expect(within(leftover).getByText("No")).toBeInTheDocument();
    expect(
      within(leftover).queryByRole("heading", { name: /^Choice:/ }),
    ).not.toBeInTheDocument();
    expect(
      within(defaultFolder).getAllByRole("button", {
        name: "To: Prompt for Q2",
      }),
    ).toHaveLength(1);
  });

  it("names an end-of-flow target rather than leaving it blank", () => {
    // `to_question === null` is the flow ending, which is behaviour, not
    // missing data.
    panelFor(Q1);

    expect(screen.getByText("End of flow")).toBeInTheDocument();
  });

  it("explains a dead edge in terms of the answer, not the target", () => {
    panelFor(Q2);

    // The group carries the explanation once, not once more per row --
    // see `Options.tsx`'s `hideDeadNote`.
    expect(
      screen.getByText(/tied to an answer this question doesn't have anymore/i),
    ).toBeInTheDocument();
  });

  it("explains a broken edge as something that would fail, not just look odd", () => {
    panelFor(Q2);

    expect(screen.getByText(/fail instead of continuing/)).toBeInTheDocument();
  });

  it("omits a Nothing to report pill when the question has no diagnostic flags", () => {
    panelFor(Q2);

    expect(screen.queryByText("Nothing to report")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Diagnostics")).not.toBeInTheDocument();
  });

  it("does not list incoming routes", () => {
    panelFor(Q1);

    expect(screen.queryByText("Reached from")).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing routes here/)).not.toBeInTheDocument();
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
    expect(
      screen.queryByRole("button", { name: "Remove route" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit answer" }),
    ).not.toBeInTheDocument();
  });

  it("does not teach how answers, archives, or add-answer work", async () => {
    const user = userEvent.setup();
    panelFor(Q1, true);

    expect(screen.queryByText(/Added last/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Retiring archives/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "How answers route" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "What the default route does" }),
    ).not.toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Edit question" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit$/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "+ Add an answer" }));
    const addDialog = screen.getByRole("dialog", { name: "Add an answer" });
    expect(addDialog).toBeInTheDocument();
    expect(within(addDialog).getByLabelText("Label")).toBeInTheDocument();
    expect(
      within(addDialog).getByRole("radio", { name: "Default path" }),
    ).toBeInTheDocument();
    expect(
      within(addDialog).getByRole("radio", { name: "Specific path" }),
    ).toBeInTheDocument();
    await user.click(within(addDialog).getByRole("radio", { name: "Specific path" }));
    expect(
      within(addDialog).getByRole("button", { name: "Choose destination" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/A new answer with no route yet/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/answers are added before the routes/),
    ).not.toBeInTheDocument();
  });

  it("disables deleting a guarded answer with a tooltip, not a paragraph", () => {
    panelFor(Q1, true);

    const yesRow = optionRow("Yes");
    const remove = within(yesRow).getByRole("button", { name: "Delete answer" });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAttribute(
      "title",
      "A route still uses this answer. Remove that route first.",
    );
    expect(
      screen.queryByText(/A route still uses this answer/),
    ).not.toBeInTheDocument();
  });

  it("offers canvas pick and End the flow here for a missing default route, not a destination list", async () => {
    const user = userEvent.setup();
    const onStartAddRoute = vi.fn();
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
        onStartRetarget={vi.fn()}
        onStartAddRoute={onStartAddRoute}
        onCancelPick={vi.fn()}
      />,
    );

    const folder = defaultRouteFolder();
    expect(within(folder).queryByLabelText("Go to")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add route" })).not.toBeInTheDocument();
    expect(
      within(folder).getByRole("button", { name: "End the flow here" }),
    ).toBeInTheDocument();

    await user.click(
      within(folder).getByRole("button", { name: "+ Add a default route" }),
    );

    expect(onStartAddRoute).toHaveBeenCalledWith(Q1, null, "the default route");
  });

  it("shows Cancel add route on the default route currently mid-add", async () => {
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
        retargetingEdgeId={null}
        addingRouteOptionId={null}
        addingRouteQuestionId={Q1}
        onSelectQuestion={vi.fn()}
        onStartRetarget={vi.fn()}
        onStartAddRoute={vi.fn()}
        onCancelPick={onCancelPick}
      />,
    );

    const folder = defaultRouteFolder();
    expect(
      within(folder).queryByRole("button", { name: "+ Add a default route" }),
    ).not.toBeInTheDocument();
    await user.click(within(folder).getByRole("button", { name: "Cancel add route" }));

    expect(onCancelPick).toHaveBeenCalled();
  });

  it("keep an answer's rename collapsed until Edit is clicked, and delete visible beside it", async () => {
    const user = userEvent.setup();
    panelFor(Q1, true);
    const section = screen.getByRole("region", { name: /^Answers/ });

    expect(within(section).queryByLabelText("Label")).not.toBeInTheDocument();
    expect(
      within(section).getAllByRole("button", { name: "Delete answer" }).length,
    ).toBeGreaterThan(0);

    await user.click(
      within(section).getAllByRole("button", { name: "Edit answer" })[0] as HTMLElement,
    );

    const dialog = screen.getByRole("dialog", { name: "Edit answer" });
    expect(within(dialog).getByLabelText("Label")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("radio", { name: "Default path" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: "Specific path" })).toBeChecked();
    expect(
      within(dialog).getByRole("button", { name: "Choose destination" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("asks before deleting an answer", async () => {
    const user = userEvent.setup();
    const original = makeGraph();
    const graph = makeGraph({
      questions: original.questions.map((item) =>
        item.id !== Q1
          ? item
          : {
              ...item,
              options: [
                ...item.options,
                {
                  id: "bbbbbbbb-0000-4000-8000-000000000099",
                  code: "maybe",
                  label: "Maybe",
                  display_order: 2,
                },
              ],
            },
      ),
    });
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
    const maybeRow = optionRow("Maybe");

    await user.click(within(maybeRow).getByRole("button", { name: "Delete answer" }));

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText('Delete "Maybe"?')).toBeInTheDocument();
  });

  it("offers no destination controls at all on a published version", () => {
    panelFor(Q1, false);
    expect(
      screen.queryByRole("button", { name: "Change destination" }),
    ).not.toBeInTheDocument();
  });

  it("shows a route's Change-destination popup without needing that answer's Edit", async () => {
    const user = userEvent.setup();
    panelFor(Q1, true);

    const yesRow = optionRow("Yes");
    await user.click(changeDestinationTrigger(yesRow));

    expect(
      within(destinationMenu()).getByRole("button", { name: "Change destination" }),
    ).toBeInTheDocument();
    expect(
      within(destinationMenu()).getByRole("button", { name: "End the flow here" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/What should happen after this answer/),
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

    const yesRow = optionRow("Yes");
    await user.click(changeDestinationTrigger(yesRow));
    await user.click(
      within(destinationMenu()).getByRole("button", { name: "Change destination" }),
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

    const yesRow = optionRow("Yes");

    expect(
      within(yesRow).queryByRole("button", { name: "Change destination" }),
    ).not.toBeInTheDocument();
    await user.click(within(yesRow).getByRole("button", { name: "Cancel retarget" }));

    expect(onCancelPick).toHaveBeenCalled();
  });

  it("offers no row-level Own route on an answer that already has a destination", async () => {
    const user = userEvent.setup();
    panelFor(Q1, true);

    const yesRow = optionRow("Yes");
    expect(
      within(yesRow).queryByRole("button", { name: "Add a specific route" }),
    ).not.toBeInTheDocument();
    expect(
      within(yesRow).queryByRole("button", { name: "Own route" }),
    ).not.toBeInTheDocument();

    await user.click(within(yesRow).getByRole("button", { name: "Edit answer" }));
    const dialog = screen.getByRole("dialog", { name: "Edit answer" });
    expect(within(dialog).getByRole("radio", { name: "Specific path" })).toBeChecked();
    expect(
      within(dialog).getByRole("button", { name: "Choose destination" }),
    ).toBeInTheDocument();
  });

  it("asks the map to start adding a route from the edit-answer dialog", async () => {
    const user = userEvent.setup();
    const onStartAddRoute = vi.fn();
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
        addingRouteOptionId={null}
        onSelectQuestion={vi.fn()}
        onStartRetarget={vi.fn()}
        onStartAddRoute={onStartAddRoute}
        onCancelPick={vi.fn()}
      />,
    );

    const yesRow = optionRow("Yes");
    await user.click(within(yesRow).getByRole("button", { name: "Edit answer" }));
    const dialog = screen.getByRole("dialog", { name: "Edit answer" });
    expect(within(dialog).getByRole("radio", { name: "Default path" })).toBeChecked();
    await user.click(within(dialog).getByRole("radio", { name: "Specific path" }));
    await user.click(
      within(dialog).getByRole("button", { name: "Choose destination" }),
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

    const yesRow = optionRow("Yes");

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

    const yesRow = optionRow("Yes");
    const noRow = optionRow("No");
    await user.click(changeDestinationTrigger(yesRow));
    expect(
      within(destinationMenu()).getByRole("button", { name: "End the flow here" }),
    ).toBeEnabled();
    await user.keyboard("{Escape}");
    await user.click(changeDestinationTrigger(noRow));
    expect(
      within(destinationMenu()).getByRole("button", { name: "End the flow here" }),
    ).toBeDisabled();
  });

  it("offers a one-click fall-through only when this question has a default route", async () => {
    // Base fixture: Q1 has no question-level (default route) edge, so
    // "Yes"'s own edge has nothing to fall through to -- no button.
    const user = userEvent.setup();
    panelFor(Q1, true);
    const yesRow = optionRow("Yes");
    await user.click(changeDestinationTrigger(yesRow));
    expect(
      screen.queryByRole("button", { name: /Use the default route/ }),
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

    const yesRow = optionRow("Yes");
    // Available without opening this answer's Edit text toggle, like the
    // rest of "Change destination" -- it acts immediately and isn't
    // hidden away.
    await user.click(changeDestinationTrigger(yesRow));
    expect(
      screen.getByRole("button", { name: "Use the default route instead" }),
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

    const defaultRouteSection = defaultRouteFolder();
    await user.click(changeDestinationTrigger(defaultRouteSection));
    expect(
      screen.queryByRole("button", {
        name: /Use the default route/,
      }),
    ).not.toBeInTheDocument();
  });

  it("names a scale question's default route as an integer answer", () => {
    panelFor(Q2);

    expect(
      within(defaultRouteFolder()).getByText(INTEGER_ANSWER_EDGE_LABEL),
    ).toBeInTheDocument();
  });

  it("offers no per-option add-route affordance on a question whose answers select nothing", async () => {
    // A scale question has no options at all, so there's no per-option
    // row to nest an "Add a specific route" into -- only the section-wide
    // default route, which every route on such a question uses. Q2's own
    // default route is stripped here so that affordance is actually
    // offered -- the base fixture already has one (E_Q2_TO_ARCHIVED),
    // which the "hide when one already exists" rule would otherwise hide
    // it behind.
    const user = userEvent.setup();
    const onStartAddRoute = vi.fn();
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
        onStartAddRoute={onStartAddRoute}
        onCancelPick={vi.fn()}
      />,
    );

    // The per-option button reads "Add a specific route" -- Q2 has no
    // options at all, so there's no row to render one on.
    expect(
      screen.queryByRole("button", { name: "Add a specific route" }),
    ).not.toBeInTheDocument();
    expect(defaultRouteFolder()).toBeInTheDocument();
    expect(
      within(defaultRouteFolder()).getByRole("button", { name: "End the flow here" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "+ Add a route" }));

    expect(onStartAddRoute).toHaveBeenCalledWith(Q2, null, "the default route");
    expect(screen.queryByRole("button", { name: "Add route" })).not.toBeInTheDocument();
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

  it("does not badge an added option or a changed route", () => {
    panelFor(Q1, false, {
      questions: new Map(),
      options: new Map([[OPTION_YES, "added"]]),
      edges: new Map([[E_YES_TO_Q2, "changed"]]),
    });

    const yesRow = optionRow("Yes");
    expect(within(yesRow).queryByText("Added")).not.toBeInTheDocument();
    expect(within(yesRow).queryByText("Changed")).not.toBeInTheDocument();
  });
});
