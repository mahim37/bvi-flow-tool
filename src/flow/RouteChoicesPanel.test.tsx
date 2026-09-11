import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RouteChoicesPanel } from "./RouteChoicesPanel";
import { E_Q2_TO_ARCHIVED, Q1, Q2, makeGraph } from "../test/fixtures";
import { renderWithProviders } from "../test/render";

const E_Q1_FALLBACK = "cccccccc-0000-4000-8000-000000000099";
const OPTION_OTHER = "bbbbbbbb-0000-4000-8000-000000000099";

describe("RouteChoicesPanel", () => {
  it("lists every leftover answer that takes a choice question's default route", () => {
    const original = makeGraph();
    const graph = makeGraph({
      questions: original.questions.map((question) =>
        question.id !== Q1
          ? question
          : {
              ...question,
              options: [
                ...question.options,
                {
                  id: OPTION_OTHER,
                  code: "other",
                  label: "Other",
                  display_order: 2,
                },
              ],
            },
      ),
      edges: [
        ...original.edges,
        {
          id: E_Q1_FALLBACK,
          from_question: Q1,
          from_option: null,
          to_question: Q2,
          priority: 10,
        },
      ],
    });
    const edge = graph.edges.find((item) => item.id === E_Q1_FALLBACK);
    if (edge === undefined) throw new Error("missing fallback");

    renderWithProviders(
      <RouteChoicesPanel graph={graph} edge={edge} onClose={vi.fn()} />,
    );

    expect(screen.getByText("Other")).toBeInTheDocument();
    expect(screen.queryByText("Yes")).not.toBeInTheDocument();
    expect(screen.queryByText("No")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Answers/ }).textContent).toContain("1");
    expect(screen.queryByText("Choices on this route")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/These answers take this default route/),
    ).not.toBeInTheDocument();
  });

  it("lists every answer when the default route is the only way out", () => {
    const original = makeGraph();
    const graph = makeGraph({
      edges: [
        ...original.edges.filter((item) => item.from_question !== Q1),
        {
          id: E_Q1_FALLBACK,
          from_question: Q1,
          from_option: null,
          to_question: Q2,
          priority: 0,
        },
      ],
    });
    const edge = graph.edges.find((item) => item.id === E_Q1_FALLBACK);
    if (edge === undefined) throw new Error("missing fallback");

    renderWithProviders(
      <RouteChoicesPanel graph={graph} edge={edge} onClose={vi.fn()} />,
    );

    const labels = screen
      .getAllByRole("listitem")
      .map((item) => item.textContent ?? "");
    expect(labels[0]).toContain("Yes");
    expect(labels[1]).toContain("No");
    expect(labels[0]).not.toMatch(/^\s*1/);
  });

  it("explains a non-choice default route instead of inventing a list", () => {
    const graph = makeGraph();
    const edge = graph.edges.find((item) => item.id === E_Q2_TO_ARCHIVED);
    if (edge === undefined) throw new Error("missing Q2 fallback");

    renderWithProviders(
      <RouteChoicesPanel graph={graph} edge={edge} onClose={vi.fn()} />,
    );

    expect(
      screen.getByText("There is no answer list on this question."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("closes the sheet", async () => {
    const user = userEvent.setup();
    const graph = makeGraph();
    const edge = graph.edges.find((item) => item.id === E_Q2_TO_ARCHIVED);
    if (edge === undefined) throw new Error("missing Q2 fallback");
    const onClose = vi.fn();

    renderWithProviders(
      <RouteChoicesPanel graph={graph} edge={edge} onClose={onClose} />,
    );

    await user.click(screen.getByRole("button", { name: "Close route choices" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
