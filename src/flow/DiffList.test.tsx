import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ItemDiff } from "../api/types";
import { Q1 } from "../test/fixtures";
import { renderWithProviders } from "../test/render";
import { DiffList } from "./DiffList";

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

describe("DiffList", () => {
  it("renders nothing when this kind has no rows", () => {
    const { container } = renderWithProviders(
      <DiffList kind="question" items={[]} onShowOnMap={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a field change as a unified diff of the old and new values", () => {
    renderWithProviders(
      <DiffList
        kind="question"
        items={[
          item({
            key: "Q1",
            change: "changed",
            fields: [{ field: "prompt", base: "Old prompt", draft: "New prompt" }],
          }),
        ]}
        onShowOnMap={vi.fn()}
      />,
    );

    expect(screen.getByText("Old prompt").closest("del")).not.toBeNull();
    expect(screen.getByText("New prompt").closest("ins")).not.toBeNull();
    expect(screen.queryByText("→")).not.toBeInTheDocument();
    expect(screen.queryByText("Changed")).not.toBeInTheDocument();
  });

  it("lets a reviewer jump to the question the change hangs off", async () => {
    const user = userEvent.setup();
    const onShowOnMap = vi.fn();
    renderWithProviders(
      <DiffList
        kind="question"
        items={[item({ key: "Q1", change: "added" })]}
        onShowOnMap={onShowOnMap}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Added Q1. Open on the map" }));
    expect(onShowOnMap).toHaveBeenCalledWith(Q1);
    expect(screen.queryByText("Added")).not.toBeInTheDocument();
    expect(screen.queryByText("Show on map")).not.toBeInTheDocument();
  });
});
