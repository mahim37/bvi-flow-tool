import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChangeRequest, Graph, ItemDiff, ReviewPayload } from "../api/types";
import {
  E_YES_TO_Q2,
  OPTION_YES,
  Q1,
  Q2,
  Q4_UNREACHABLE,
  RISK_BASE,
  RISK_DRAFT,
  RISK_PROMPT,
  VERSION_ID,
  makeBaseGraph,
  makeGraph,
} from "../test/fixtures";
import { renderWithProviders } from "../test/render";
import { REQUIRED_REVIEWER_EMAILS } from "./labels";
import { ReviewView } from "./ReviewView";

const AUTHOR = "postman-demo@example.com";
const REVIEWER_1 = REQUIRED_REVIEWER_EMAILS[0];
const REVIEWER_2 = REQUIRED_REVIEWER_EMAILS[1];

const harness = vi.hoisted(() => ({
  graph: null as Graph | null,
  baseGraph: null as Graph | null,
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
  useGraph: () => ({
    isLoading: false,
    data: harness.baseGraph ?? undefined,
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
    proposal: harness.graph?.change_request ?? null,
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

function renderReview(
  changeRequest: ChangeRequest,
  reviewOverrides?: Partial<ReviewPayload>,
) {
  harness.graph = draftGraph(changeRequest);
  harness.baseGraph = makeBaseGraph();
  harness.payload = { ...emptyReview(changeRequest), ...reviewOverrides };
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

  it("tells a required reviewer they cannot review a proposal they authored", () => {
    signIn(REVIEWER_1);
    renderReview(
      proposal({
        created_by_email: REVIEWER_1,
        status: "submitted",
      }),
    );

    expect(screen.queryByRole("heading", { name: "Decision" })).not.toBeInTheDocument();
    expect(
      screen.getByText("You cannot review your own proposal."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/name someone else to stand in/i),
    ).not.toBeInTheDocument();
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

function diffRow(
  overrides: Partial<ItemDiff> & Pick<ItemDiff, "kind" | "change" | "key">,
): ItemDiff {
  return {
    base_id: null,
    draft_id: null,
    question_id: Q1,
    fields: [],
    ...overrides,
  };
}

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
    harness.baseGraph = null;
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
      screen.getByText(/no earlier version to diff this one against/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/everything here is new/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/still says exactly what/i)).not.toBeInTheDocument();
  });
});

describe("ReviewView change-count pills", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("counts one question even when several of its answers and edges also changed", () => {
    signIn(REVIEWER_1);
    renderReview(proposal(), {
      summary: { added: 99, removed: 99, changed: 99 },
      diff: {
        is_empty: false,
        questions: [
          diffRow({ kind: "question", change: "added", key: "new", draft_id: Q1 }),
          diffRow({
            kind: "question",
            change: "removed",
            key: "gone",
            base_id: Q2,
            question_id: Q2,
          }),
          diffRow({
            kind: "question",
            change: "changed",
            key: "edited",
            draft_id: Q4_UNREACHABLE,
            question_id: Q4_UNREACHABLE,
          }),
        ],
        options: [
          diffRow({
            kind: "option",
            change: "added",
            key: "yes",
            draft_id: OPTION_YES,
          }),
        ],
        edges: [
          diffRow({
            kind: "edge",
            change: "added",
            key: "route",
            draft_id: E_YES_TO_Q2,
          }),
        ],
        sections: [],
      },
    });

    const counts = screen.getByRole("list", { name: "Change counts" });
    expect(counts).toHaveTextContent("+1 question");
    expect(counts).toHaveTextContent("−1 removed");
    expect(counts).toHaveTextContent("1 changed");
    expect(counts).not.toHaveTextContent("added");
    expect(counts).not.toHaveTextContent("~");
    expect(counts).not.toHaveTextContent("99");
  });

  it("counts a retired question as removed and names it from the base version", async () => {
    const user = userEvent.setup();
    signIn(REVIEWER_1);
    // `diffing` reports an archival as `changed` with the `archived` flag
    // flipped -- the code still matches -- and the draft's `graph/` no
    // longer serves a retired question nothing points at.
    renderReview(proposal(), {
      diff: {
        is_empty: false,
        sections: [],
        options: [],
        edges: [],
        questions: [
          diffRow({
            kind: "question",
            change: "changed",
            key: "risk_2",
            base_id: RISK_BASE,
            draft_id: RISK_DRAFT,
            question_id: RISK_DRAFT,
            fields: [{ field: "archived", base: false, draft: true }],
          }),
        ],
      },
    });

    const counts = screen.getByRole("list", { name: "Change counts" });
    expect(counts).toHaveTextContent("+0 questions");
    expect(counts).toHaveTextContent("−1 removed");
    expect(counts).toHaveTextContent("0 changed");

    expect(screen.queryByText("risk_2")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: new RegExp(`^${RISK_PROMPT}`) }),
    );
    expect(
      screen
        .getAllByRole("article")
        .some((element) => /Removed question/.test(element.textContent ?? "")),
    ).toBe(true);
    expect(
      screen
        .getAllByRole("article")
        .some((element) => /Changed question/.test(element.textContent ?? "")),
    ).toBe(false);
  });
});
