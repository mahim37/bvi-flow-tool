import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { MapIndexDialog } from "./MapIndexDialog";
import { renderWithProviders } from "../test/render";

describe("MapIndexDialog", () => {
  it("opens the canvas help and colour key from the Index button", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MapIndexDialog />);

    expect(screen.queryByText("What do the colors mean?")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Index" }));

    expect(screen.getByRole("heading", { name: "Index" })).toBeInTheDocument();
    expect(screen.getByText("What do the colors mean?")).toBeInTheDocument();
    expect(screen.getByText(/Click/)).toBeInTheDocument();
    expect(screen.getByText(/a question for details/)).toBeInTheDocument();
    expect(screen.getByText(/Entry point/)).toBeInTheDocument();
  });
});
