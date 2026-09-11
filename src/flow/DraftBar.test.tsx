import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { ChangeRequest } from "../api/types";
import { VERSION_ID, makeGraph } from "../test/fixtures";
import { renderWithProviders } from "../test/render";
import { DraftBar } from "./DraftBar";

function openProposal(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    draft_version: VERSION_ID,
    created_by: "88888888-8888-4888-8888-888888888888",
    created_by_email: "postman-demo@example.com",
    summary: "",
    status: "open",
    submitted_at: null,
    published_at: null,
    published_by: null,
    published_by_email: null,
    reviewer_1: null,
    reviewer_1_email: null,
    reviewer_1_approved_at: null,
    reviewer_2: null,
    reviewer_2_email: null,
    reviewer_2_approved_at: null,
    lock: null,
    reviews: [],
    created: "2026-08-01T09:00:00Z",
    modified: "2026-08-01T09:00:00Z",
    break_draft_version_id: null,
    ...overrides,
  };
}

function renderBar(
  graph = makeGraph({
    version: {
      ...makeGraph().version,
      is_draft: true,
      is_active: false,
      is_stale: true,
      number: 2,
      label: "tests",
    },
    change_request: openProposal(),
  }),
) {
  return renderWithProviders(
    <MemoryRouter>
      <DraftBar graph={graph} versions={[]} onOpenVersion={vi.fn()} />
    </MemoryRouter>,
  );
}

describe("DraftBar", () => {
  it("keeps draft warnings behind a red Alerts control next to Check diff", async () => {
    const user = userEvent.setup();
    renderBar();

    expect(screen.getByRole("link", { name: "Check diff" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a question" })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Check the diff" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Behind the latest version/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "2 alerts" }));

    expect(screen.getByText(/Behind the latest version/)).toBeInTheDocument();
    expect(
      screen.getByText("Only postman-demo@example.com can submit this for review."),
    ).toBeInTheDocument();
  });

  it("does not keep product spawn on the draft bar", () => {
    renderWithProviders(
      <MemoryRouter>
        <DraftBar graph={makeGraph()} versions={[]} onOpenVersion={vi.fn()} />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("button", { name: "Create product" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Spawn a product" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add a question" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Propose a change" }),
    ).toBeInTheDocument();
  });

  it("opens create-draft as a page overlay", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <MemoryRouter>
        <DraftBar graph={makeGraph()} versions={[]} onOpenVersion={vi.fn()} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Propose a change" }));

    expect(screen.getByRole("dialog", { name: "Create draft" })).toBeInTheDocument();
    expect(screen.getByLabelText("What's this draft for?")).toBeInTheDocument();
  });
});
