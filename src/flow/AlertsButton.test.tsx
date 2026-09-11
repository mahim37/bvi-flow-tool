import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../test/render";
import { AlertsButton } from "./AlertsButton";

describe("AlertsButton", () => {
  it("always shows the count", () => {
    renderWithProviders(
      <AlertsButton
        kind="Issues"
        items={[{ id: "one", tone: "error", children: "No entry point" }]}
      />,
    );

    expect(screen.getByRole("button", { name: "1 issue" })).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("opens a located issue on select", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderWithProviders(
      <AlertsButton
        kind="Issues"
        items={[
          {
            id: "q2",
            tone: "error",
            children: "Q2",
            onSelect,
            actionLabel: "Open Q2 on the map",
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "1 issue" }));
    await user.click(screen.getByRole("button", { name: "Open Q2 on the map" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
