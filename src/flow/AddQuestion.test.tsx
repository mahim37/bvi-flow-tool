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
});
