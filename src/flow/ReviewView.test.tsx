import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChangeRequest, Graph, ReviewPayload } from "../api/types";
import { VERSION_ID, makeGraph } from "../test/fixtures";
import { renderWithProviders } from "../test/render";
import { REQUIRED_REVIEWER_EMAILS } from "./labels";
import { ReviewView } from "./ReviewView";

const AUTHOR = "postman-demo@example.com";
const REVIEWER_1 = REQUIRED_REVIEWER_EMAILS[0];
const REVIEWER_2 = REQUIRED_REVIEWER_EMAILS[1];

const harness = vi.hoisted(() => ({
  graph: null as Graph | null,
  payload: null as ReviewPayload | null,
  approveMutate: vi.fn(),
}));

vi.mock("../api/queries", () => ({
  useReview: () => ({
    isPending: false,
    isError: false,
    data: harness.payload,
    error: null,
  }),
  useApproveDraft: () => ({
    mutate: harness.approveMutate,
    isPending: false,
    error: null,
  }),
  useRejectDraft: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

vi.mock("./versionContext", () => ({
  useVersionContext: () => ({
    graph: harness.graph,
    versions: [],
    editable: false,
  }),
}));

function proposal(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    draft_version: VERSION_ID,
    created_by: "88888888-8888-4888-8888-888888888888",
    created_by_email: AUTHOR,
    summary: "",
    status: "submitted",
    submitted_at: "2026-08-02T09:00:00Z",
    published_at: null,
    published_by: null,
    published_by_email: null,
    reviewer_1: "11111111-1111-4111-8111-111111111101",
    reviewer_1_email: REVIEWER_1,
    reviewer_1_approved_at: null,
    reviewer_2: "11111111-1111-4111-8111-111111111102",
    reviewer_2_email: REVIEWER_2,
    reviewer_2_approved_at: null,
    lock: null,
    reviews: [],
    created: "2026-08-01T09:00:00Z",
    modified: "2026-08-01T09:00:00Z",
    break_draft_version_id: null,
    ...overrides,
  };
}

function draftGraph(changeRequest: ChangeRequest): Graph {
  return makeGraph({
    version: {
      ...makeGraph().version,
      is_draft: true,
      is_active: false,
    },
    change_request: changeRequest,
  });
}

function emptyReview(changeRequest: ChangeRequest): ReviewPayload {
  const graph = draftGraph(changeRequest);
  return {
    version: graph.version,
    base_version: makeGraph().version,
    stale_against: null,
    change_request: changeRequest,
    diff: { is_empty: true, sections: [], questions: [], options: [], edges: [] },
    preview_regions: [],
    summary: { added: 0, removed: 0, changed: 0 },
    publish_blocker: null,
  };
}

function signIn(email: string) {
  window.localStorage.setItem(
    "bvi-flow-tool.identity",
    JSON.stringify({
      email,
      name: email,
      role: null,
      permission_codes: ["view_flow_tool", "publish_flow_tool"],
    }),
  );
}

function renderReview(changeRequest: ChangeRequest) {
  harness.graph = draftGraph(changeRequest);
  harness.payload = emptyReview(changeRequest);
  return renderWithProviders(
    <MemoryRouter initialEntries={[`/versions/${VERSION_ID}/review`]}>
      <Routes>
        <Route path="/versions/:versionId/review" element={<ReviewView />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ReviewView two-reviewer publish gate", () => {
  beforeEach(() => {
    harness.approveMutate.mockReset();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("never offers a Publish control, even after the first approval", () => {
    signIn(REVIEWER_2);
    renderReview(
      proposal({
        status: "approved",
        reviewer_1_approved_at: "2026-08-02T10:00:00Z",
      }),
    );

    expect(screen.getByRole("heading", { name: "Decision" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(
      screen.getByText(/second required approval, and it publishes the draft/i),
    ).toBeInTheDocument();
  });

  it("records the first approval without treating it as a publish", async () => {
    const user = userEvent.setup();
    signIn(REVIEWER_1);
    renderReview(proposal());

    expect(
      screen.getByText(/Publishing waits for the other required reviewer/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Approve" }));

    expect(harness.approveMutate).toHaveBeenCalledTimes(1);
    expect(harness.approveMutate.mock.calls[0]?.[0]).toBe("");
  });

  it("does not let the author approve their own proposal", () => {
    signIn(AUTHOR);
    renderReview(proposal());

    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Decision" })).not.toBeInTheDocument();
  });

  it("does not offer Approve to someone who is not a named reviewer", () => {
    signIn("other-publisher@example.com");
    renderReview(proposal());

    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Decision" })).not.toBeInTheDocument();
  });

  it("hides Decision when there is nothing this user can decide", () => {
    signIn(REVIEWER_1);
    renderReview(proposal({ status: "open" }));

    expect(screen.queryByRole("heading", { name: "Decision" })).not.toBeInTheDocument();
    expect(
      screen.queryByText(/has not been submitted yet, so there is nothing to decide/i),
    ).not.toBeInTheDocument();
  });

  it("does not show a published success after only one approval", () => {
    signIn(REVIEWER_1);
    renderReview(
      proposal({
        status: "approved",
        reviewer_1_approved_at: "2026-08-02T10:00:00Z",
      }),
    );

    expect(
      screen.queryByText("This proposal has been published. Nothing is left to do."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/publishes on its own the moment the other/),
    ).toBeInTheDocument();
  });
});

describe("ReviewView with no parent to compare against", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("says there is nothing to compare, not that everything changed", () => {
    const graph = makeGraph({
      version: { ...makeGraph().version, parent_version: null },
      change_request: null,
    });
    harness.graph = graph;
    harness.payload = {
      version: graph.version,
      base_version: null,
      stale_against: null,
      change_request: null,
      diff: { is_empty: true, sections: [], questions: [], options: [], edges: [] },
      preview_regions: [],
      summary: { added: 0, removed: 0, changed: 0 },
      publish_blocker: null,
    };
    renderWithProviders(
      <MemoryRouter initialEntries={[`/versions/${VERSION_ID}/review`]}>
        <Routes>
          <Route path="/versions/:versionId/review" element={<ReviewView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      screen.getByText(/this is the first version, so there is nothing to compare/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no earlier version to diff this one against/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/everything here is new/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/still says exactly what/i)).not.toBeInTheDocument();
  });
});
