import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { VERSION_ID } from "../test/fixtures";
import { renderWithProviders } from "../test/render";
import { CreateProductDialog } from "./CreateProductDialog";

describe("CreateProductDialog", () => {
  it("opens a page overlay rather than a popover", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <CreateProductDialog versionId={VERSION_ID} onCreated={vi.fn()} />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create product" }));

    expect(screen.getByRole("dialog", { name: "Create product" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });
});
