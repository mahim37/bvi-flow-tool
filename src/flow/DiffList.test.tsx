import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ItemDiff } from "../api/types";
import {
  E_NO_TO_END,
  E_Q2_TO_ARCHIVED,
  E_YES_TO_Q2,
  OPTION_MAYBE_BASE,
  OPTION_YES,
  Q1,
  Q2,
  RISK_BASE,
  RISK_DRAFT,
  RISK_PROMPT,
  makeBaseGraph,
  makeGraph,
} from "../test/fixtures";
import { renderWithProviders } from "../test/render";
import { DiffList } from "./DiffList";
import { groupDiffByNode } from "./diffGroups";
import { diffPieces, diffSentence } from "./diffSentence";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** What `diffing` reports when the draft retires `risk_2`: still matched
 * by code, so `changed`, with only the `archived` flag differing. */
const RETIRED_RISK: ItemDiff = {
  kind: "question",
  key: "risk_2",
  change: "changed",
  base_id: RISK_BASE,
  draft_id: RISK_DRAFT,
  question_id: RISK_DRAFT,
  fields: [{ field: "archived", base: false, draft: true }],
};

function item(
  overrides: Partial<ItemDiff> & Pick<ItemDiff, "change" | "key">,
): ItemDiff {
  return {
    kind: "question",
    base_id: null,
    draft_id: null,
    question_id: Q1,
    fields: [],
    ...overrides,
  };
}

function expectNoUuid(sentence: string) {
  expect(sentence).not.toMatch(UUID_RE);
}

describe("diffSentence", () => {
  const graph = makeGraph();
  const q1 = graph.questions.find((question) => question.id === Q1);
  const q2 = graph.questions.find((question) => question.id === Q2);
  if (q1 === undefined || q2 === undefined) {
    throw new Error("fixture is missing Q1 or Q2");
  }

  it("names an added question by its prompt, without a QID", () => {
    const sentence = diffSentence(
      item({ key: "Q1", change: "added", draft_id: Q1 }),
      graph,
    );
    expect(sentence).toBe(`Added question "${q1.prompt}"`);
    expect(sentence).not.toMatch(/id:/);
    expectNoUuid(sentence);
  });

  it("names an added connection, including End of flow", () => {
    const toQ2 = diffSentence(
      item({
        kind: "edge",
        key: "Q1 (yes)",
        change: "added",
        draft_id: E_YES_TO_Q2,
        question_id: Q1,
      }),
      graph,
    );
    expect(toQ2).toBe(
      `Added connection "Yes" from Question "${q1.prompt}" to Question "${q2.prompt}"`,
    );
    expect(toQ2).not.toMatch(/id:/);
    expect(toQ2).not.toMatch(/edge/i);
    expectNoUuid(toQ2);

    const toEnd = diffSentence(
      item({
        kind: "edge",
        key: "Q1 (no)",
        change: "added",
        draft_id: E_NO_TO_END,
        question_id: Q1,
      }),
      graph,
    );
    expect(toEnd).toBe(
      `Added connection "No" from Question "${q1.prompt}" to "End of flow"`,
    );
    expectNoUuid(toEnd);
  });

  it("names a question-level connection without calling it a default edge", () => {
    const sentence = diffSentence(
      item({
        kind: "edge",
        key: "Q2",
        change: "added",
        draft_id: E_Q2_TO_ARCHIVED,
        question_id: Q2,
      }),
      graph,
    );
    const q3 = graph.questions.find((question) => question.code === "Q3");
    if (q3 === undefined) throw new Error("fixture is missing Q3");
    expect(sentence).toBe(
      `Added connection from Question "${q2.prompt}" to Question "${q3.prompt}"`,
    );
    expect(sentence).not.toMatch(/default/i);
    expect(sentence).not.toMatch(/edge/i);
    expectNoUuid(sentence);
  });

  it("names an option with its parent question", () => {
    const sentence = diffSentence(
      item({
        kind: "option",
        key: "Q1.yes",
        change: "added",
        draft_id: OPTION_YES,
        question_id: Q1,
      }),
      graph,
    );
    expect(sentence).toBe(`Added option "Yes" on Question "${q1.prompt}"`);
    expect(sentence).not.toMatch(/id:/);
    expectNoUuid(sentence);
  });

  it("names a section by name", () => {
    const section = graph.sections[0];
    if (section === undefined) throw new Error("fixture has no section");
    const sentence = diffSentence(
      item({
        kind: "section",
        key: section.code,
        change: "added",
        draft_id: section.id,
        question_id: null,
      }),
      graph,
    );
    expect(sentence).toBe(`Added section "${section.name}"`);
    expect(sentence).not.toMatch(/id:/);
    expectNoUuid(sentence);
  });

  it("reads a retired question as removed and names it from the base version", () => {
    // Nothing points at risk_2 any more, so the draft graph does not
    // serve it: without the base graph the row can only say its kind.
    expect(diffSentence(RETIRED_RISK, graph)).toBe("Removed question");

    const sentence = diffSentence(RETIRED_RISK, graph, makeBaseGraph());
    expect(sentence).toBe(`Removed question "${RISK_PROMPT}"`);
    expectNoUuid(sentence);

    // Not on the draft map, so no link to a node that is not there.
    const pieces = diffPieces(RETIRED_RISK, graph, makeBaseGraph());
    expect(pieces).toEqual([
      { type: "text", text: "Removed " },
      {
        type: "ref",
        prefix: "question ",
        label: RISK_PROMPT,
        questionId: null,
        quoted: true,
      },
    ]);
  });

  it("names a removed option from the base version and still links its question", () => {
    const row = item({
      kind: "option",
      key: "Q1.maybe",
      change: "removed",
      base_id: OPTION_MAYBE_BASE,
      draft_id: null,
      question_id: Q1,
    });
    expect(diffSentence(row, graph)).toBe(`Removed option on Question "${q1.prompt}"`);
    expect(diffSentence(row, graph, makeBaseGraph())).toBe(
      `Removed option "Maybe" on Question "${q1.prompt}"`,
    );
    expect(
      diffPieces(row, graph, makeBaseGraph()).map((piece) =>
        piece.type === "ref" ? piece.questionId : null,
      ),
    ).toEqual([null, Q1, null, Q1]);
  });
});

describe("groupDiffByNode", () => {
  const graph = makeGraph();
  const q1 = graph.questions.find((question) => question.id === Q1);
  const q2 = graph.questions.find((question) => question.id === Q2);
  if (q1 === undefined || q2 === undefined) {
    throw new Error("fixture is missing Q1 or Q2");
  }

  it("puts a question's own row, its answers, and edges that leave it in one group", () => {
    const groups = groupDiffByNode(
      [
        item({ key: "Q1", change: "added", draft_id: Q1 }),
        item({
          kind: "option",
          key: "Q1.yes",
          change: "added",
          draft_id: OPTION_YES,
          question_id: Q1,
        }),
        item({
          kind: "edge",
          key: "Q1 (no)",
          change: "added",
          draft_id: E_NO_TO_END,
          question_id: Q1,
        }),
      ],
      graph,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.questionId).toBe(Q1);
    expect(groups[0]?.title).toBe(q1.prompt);
    expect(groups[0]?.items.map((row) => row.kind)).toEqual([
      "question",
      "option",
      "edge",
    ]);
  });

  it("attaches an edge to the question it leaves, not the destination", () => {
    const groups = groupDiffByNode(
      [
        item({
          kind: "question",
          key: "Q2",
          change: "changed",
          draft_id: Q2,
          question_id: Q2,
        }),
        item({
          kind: "edge",
          key: "Q1 (yes)",
          change: "added",
          draft_id: E_YES_TO_Q2,
          question_id: Q2,
        }),
      ],
      graph,
    );

    expect(groups.map((group) => group.questionId)).toEqual([Q1, Q2]);
    expect(groups[0]?.items).toHaveLength(1);
    expect(groups[0]?.items[0]?.kind).toBe("edge");
    expect(groups[1]?.items[0]?.kind).toBe("question");
  });

  it("titles a retired question the draft graph no longer draws by its base prompt", () => {
    const rows = [
      RETIRED_RISK,
      item({
        kind: "option",
        key: "risk_2.high",
        change: "changed",
        question_id: RISK_DRAFT,
      }),
    ];
    expect(groupDiffByNode(rows, graph).map((group) => group.title)).toEqual([
      "risk_2",
    ]);

    const groups = groupDiffByNode(rows, graph, makeBaseGraph());
    expect(groups).toHaveLength(1);
    expect(groups[0]?.title).toBe(RISK_PROMPT);
    expect(groups[0]?.items).toHaveLength(2);
  });
});

describe("DiffList", () => {
  function articleMatching(pattern: RegExp) {
    return screen
      .getAllByRole("article")
      .find((element) => pattern.test(element.textContent ?? ""));
  }

  async function expandNode(title: string) {
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: new RegExp(`^${title}`) });
    if (trigger.getAttribute("aria-expanded") !== "true") {
      await user.click(trigger);
    }
    return user;
  }

  it("renders nothing when this kind has no rows", () => {
    const { container } = renderWithProviders(
      <DiffList items={[]} graph={makeGraph()} onShowOnMap={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("groups a node's question and leaving edges under one expandable section", async () => {
    const graph = makeGraph();
    const q1 = graph.questions.find((question) => question.id === Q1);
    if (q1 === undefined) throw new Error("fixture is missing Q1");
    renderWithProviders(
      <DiffList
        items={[
          item({ key: "Q1", change: "added", draft_id: Q1 }),
          item({
            kind: "edge",
            key: "Q1 (no)",
            change: "added",
            draft_id: E_NO_TO_END,
          }),
        ]}
        graph={graph}
        onShowOnMap={vi.fn()}
      />,
    );

    expect(screen.queryByText("Questions")).not.toBeInTheDocument();
    expect(screen.queryByText("Edges")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: new RegExp(`^${q1.prompt}`) }),
    ).toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: new RegExp(`^${q1.prompt}`) });
    expect(trigger.querySelector("svg")).not.toBeNull();
    expect(trigger.className).toMatch(/flex-row/);
    expect(screen.queryByText(/Added question/)).not.toBeInTheDocument();

    await expandNode(q1.prompt);
    expect(articleMatching(/Added question/)).toBeDefined();
    expect(screen.getByText(/End of flow/)).toBeInTheDocument();
    expect(screen.queryByText(/id:/)).not.toBeInTheDocument();
  });

  it("keeps the verbose sentence and does not render a field hunk", async () => {
    const graph = makeGraph();
    const q1 = graph.questions.find((question) => question.id === Q1);
    if (q1 === undefined) throw new Error("fixture is missing Q1");
    renderWithProviders(
      <DiffList
        items={[
          item({
            key: "Q1",
            change: "changed",
            draft_id: Q1,
            fields: [{ field: "prompt", base: "Old prompt", draft: "New prompt" }],
          }),
        ]}
        graph={graph}
        onShowOnMap={vi.fn()}
      />,
    );

    await expandNode(q1.prompt);
    expect(articleMatching(/Changed question/)).toBeDefined();
    expect(screen.queryByText("Prompt")).not.toBeInTheDocument();
    expect(screen.queryByText("Old prompt")).not.toBeInTheDocument();
    expect(screen.queryByText("New prompt")).not.toBeInTheDocument();
    expect(screen.queryByText("Goes to")).not.toBeInTheDocument();
  });

  it("shows a retired question as a named removal with no map link", async () => {
    const onShowOnMap = vi.fn();
    renderWithProviders(
      <DiffList
        items={[RETIRED_RISK]}
        graph={makeGraph()}
        baseGraph={makeBaseGraph()}
        onShowOnMap={onShowOnMap}
      />,
    );

    expect(screen.queryByText("risk_2")).not.toBeInTheDocument();
    await expandNode(RISK_PROMPT);
    expect(articleMatching(/Removed question/)).toBeDefined();
    expect(articleMatching(/Changed question/)).toBeUndefined();
    expect(screen.getByText("−")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Open on the map/ }),
    ).not.toBeInTheDocument();
  });

  it("lets a reviewer jump to the question the change hangs off", async () => {
    const onShowOnMap = vi.fn();
    const graph = makeGraph();
    const q1 = graph.questions.find((question) => question.id === Q1);
    if (q1 === undefined) throw new Error("fixture is missing Q1");
    renderWithProviders(
      <DiffList
        items={[item({ key: "Q1", change: "added", draft_id: Q1 })]}
        graph={graph}
        onShowOnMap={onShowOnMap}
      />,
    );

    const user = await expandNode(q1.prompt);
    await user.click(
      screen.getByRole("button", {
        name: `question "${q1.prompt}". Open on the map`,
      }),
    );
    expect(onShowOnMap).toHaveBeenCalledWith(Q1);
    expect(screen.queryByText("Show on map")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Added/ })).not.toBeInTheDocument();
    const link = screen.getByRole("button", {
      name: `question "${q1.prompt}". Open on the map`,
    });
    expect(link.className).toMatch(/cursor-pointer/);
    expect(link.className).toMatch(/hover:opacity-90/);
    expect(link.className).toMatch(/transition-opacity/);
    expect(link.querySelector(".underline")).not.toBeNull();
  });

  it("opens an edge's route and its from-question as separate map links", async () => {
    const onShowOnMap = vi.fn();
    const graph = makeGraph();
    const q1 = graph.questions.find((question) => question.id === Q1);
    const q2 = graph.questions.find((question) => question.id === Q2);
    if (q1 === undefined || q2 === undefined) {
      throw new Error("fixture is missing Q1 or Q2");
    }
    renderWithProviders(
      <DiffList
        items={[
          item({
            kind: "edge",
            key: "Q1 (yes)",
            change: "added",
            draft_id: E_YES_TO_Q2,
            question_id: Q1,
          }),
        ]}
        graph={graph}
        onShowOnMap={onShowOnMap}
      />,
    );

    const user = await expandNode(q1.prompt);
    expect(screen.queryByText(/\(/)).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: `connection "Yes". Open on the map` }),
    );
    expect(onShowOnMap).toHaveBeenCalledWith(Q1);

    await user.click(
      screen.getByRole("button", {
        name: `Question "${q1.prompt}". Open on the map`,
      }),
    );
    expect(onShowOnMap).toHaveBeenNthCalledWith(2, Q1);

    await user.click(
      screen.getByRole("button", {
        name: `Question "${q2.prompt}". Open on the map`,
      }),
    );
    expect(onShowOnMap).toHaveBeenNthCalledWith(3, Q2);
  });
});
