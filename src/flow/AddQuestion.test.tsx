import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { makeGraph } from "../test/fixtures";
import { renderWithProviders } from "../test/render";
import { AddQuestion } from "./AddQuestion";

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

  it("defaults the QID to one past the highest existing numeric code, editable", async () => {
    const user = userEvent.setup();
    const graph = makeGraph({
      questions: [
        ...makeGraph().questions,
        {
          ...makeGraph().questions[0]!,
          id: "aaaaaaaa-0000-4000-8000-000000000099",
          code: "12",
        },
      ],
    });
    renderWithProviders(<AddQuestion graph={graph} onAdded={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Add a question" }));

    const qid = screen.getByLabelText("QID");
    expect(qid).toHaveValue("13");

    await user.clear(qid);
    await user.type(qid, "custom-code");
    expect(qid).toHaveValue("custom-code");
  });

  it("focuses Question text on open, not the prefilled QID", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AddQuestion graph={makeGraph()} onAdded={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Add a question" }));

    expect(screen.getByLabelText("Question text")).toHaveFocus();
  });

  it("ignores non-numeric codes (e.g. \"Q1\", \"risk_1\") when computing the default", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AddQuestion graph={makeGraph()} onAdded={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Add a question" }));

    expect(screen.getByLabelText("QID")).toHaveValue("1");
  });
});
