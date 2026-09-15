import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Graph } from "../api/types";
import { makeGraph } from "../test/fixtures";
import { renderWithProviders } from "../test/render";
import { AddQuestion } from "./AddQuestion";

function graphWithCodes(codes: string[]): Graph {
  const template = makeGraph().questions[0];
  if (template === undefined) throw new Error("fixture has no questions");
  return makeGraph({
    questions: codes.map((code, index) => ({
      ...template,
      id: `aaaaaaaa-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      code,
    })),
    edges: [],
  });
}

async function openAddQuestion(graph: Graph = makeGraph()) {
  const user = userEvent.setup();
  renderWithProviders(<AddQuestion graph={graph} onAdded={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Add a question" }));
  return user;
}

describe("AddQuestion", () => {
  it("opens a page overlay rather than a popover", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AddQuestion graph={makeGraph()} onAdded={vi.fn()} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add a question" }));

    expect(screen.getByRole("dialog", { name: "Add a question" })).toBeInTheDocument();
    expect(screen.getByLabelText("QID")).toBeInTheDocument();
    expect(screen.getByLabelText("Question text")).toBeInTheDocument();
  });

  it("prefills QID with the next Q-prefixed code from this graph and lets it be edited", async () => {
    const user = await openAddQuestion();

    const qid = screen.getByLabelText("QID");
    expect(qid).toBeVisible();
    expect(qid).toHaveValue("Q5");

    await user.clear(qid);
    await user.type(qid, "custom");
    expect(qid).toHaveValue("custom");
  });

  it("focuses Question text on open, not the prefilled QID", async () => {
    await openAddQuestion();

    expect(screen.getByLabelText("Question text")).toHaveFocus();
  });

  it("does not preview a public id or offer the raw-answer checkbox", async () => {
    await openAddQuestion();

    expect(screen.queryByText("id: Q5")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/raw answer/i)).not.toBeInTheDocument();
  });

  it("prefills 1 when the graph has no questions yet", async () => {
    await openAddQuestion(makeGraph({ questions: [], edges: [] }));

    expect(screen.getByLabelText("QID")).toHaveValue("1");
  });

  it("increments a bare numeric max", async () => {
    await openAddQuestion(graphWithCodes(["24", "3"]));

    expect(screen.getByLabelText("QID")).toHaveValue("25");
  });

  it("increments the highest integer among mixed patterns, keeping that match's prefix", async () => {
    await openAddQuestion(graphWithCodes(["Q5", "12", "Q3"]));

    expect(screen.getByLabelText("QID")).toHaveValue("13");
  });

  it("starts at Q1 when non-numeric codes are mostly Q-prefixed", async () => {
    await openAddQuestion(graphWithCodes(["Qa", "Qb", "intro"]));

    expect(screen.getByLabelText("QID")).toHaveValue("Q1");
  });

  it("starts at 1 when non-numeric codes are mostly unprefixed", async () => {
    await openAddQuestion(graphWithCodes(["intro", "risk", "Qa"]));

    expect(screen.getByLabelText("QID")).toHaveValue("1");
  });

  it("ignores slug codes such as risk_1 when a numeric sequence exists", async () => {
    await openAddQuestion(graphWithCodes(["1", "2", "risk_1"]));

    expect(screen.getByLabelText("QID")).toHaveValue("3");
  });
});
