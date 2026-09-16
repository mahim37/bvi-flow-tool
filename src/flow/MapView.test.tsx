import { screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChangeRequest, Graph } from "../api/types";
import { VERSION_ID, makeGraph } from "../test/fixtures";
import { renderWithProviders } from "../test/render";
import { MapView } from "./MapView";

const harness = vi.hoisted(() => ({
  editable: true,
  graph: null as Graph | null,
  editRefused: false,
  cursorRole: null as string | null,
  permissionCodes: [] as string[],
}));

vi.mock("../api/queries", () => ({
  useReview: () => ({ data: undefined, isPending: false, isError: false }),
  useAddEdge: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateEdge: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("./versionContext", () => ({
  useVersionContext: () => ({
    graph: harness.graph,
    versions: [],
    proposal: harness.graph?.change_request ?? null,
    editable: harness.editable,
  }),
}));

vi.mock("../auth/useAuth", () => ({
  useAuth: () => ({
    identity: {
      email: "editor@example.com",
      name: "Ed",
      role: null,
      permission_codes: harness.permissionCodes,
    },
    sessionPending: false,
    editRefused: harness.editRefused,
    reviewRefused: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
    noteApiError: vi.fn(),
    noteEditRefused: vi.fn(),
    noteReviewRefused: vi.fn(),
  }),
}));

vi.mock("./Canvas", () => ({
  Canvas: ({ topRight, cursorRole }: { topRight?: unknown; cursorRole?: string }) => {
    harness.cursorRole = cursorRole ?? null;
    return <div data-testid="canvas">{topRight as never}</div>;
  },
}));

vi.mock("./Sidebar", () => ({
  Sidebar: () => <nav>sidebar</nav>,
}));

vi.mock("./DetailPanel", () => ({
  DetailPanel: () => null,
}));

vi.mock("./RouteChoicesPanel", () => ({
  RouteChoicesPanel: () => null,
}));

function draftRequest(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    draft_version: VERSION_ID,
    created_by: "88888888-8888-4888-8888-888888888888",
    created_by_email: "editor@example.com",
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

function renderMap() {
  return renderWithProviders(
    <MemoryRouter initialEntries={[`/versions/${VERSION_ID}`]}>
      <Routes>
        <Route path="/versions/:versionId" element={<MapView />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("MapView add-question chrome", () => {
  beforeEach(() => {
    harness.editable = true;
    harness.editRefused = false;
    harness.cursorRole = null;
    harness.permissionCodes = [];
    harness.graph = makeGraph({
      version: { ...makeGraph().version, is_draft: true, is_active: false },
      change_request: draftRequest(),
    });
  });

  it("puts Add a question on the canvas when the draft is editable", () => {
    renderMap();

    expect(screen.getByRole("button", { name: "Add a question" })).toBeInTheDocument();
  });

  it("hides Add a question when the version is not editable", () => {
    harness.editable = false;
    renderMap();

    expect(
      screen.queryByRole("button", { name: "Add a question" }),
    ).not.toBeInTheDocument();
  });

  it("hides Add a question when edit was refused", () => {
    harness.editRefused = true;
    renderMap();

    expect(
      screen.queryByRole("button", { name: "Add a question" }),
    ).not.toBeInTheDocument();
  });
});

describe("MapView canvas cursor role", () => {
  beforeEach(() => {
    harness.editable = true;
    harness.editRefused = false;
    harness.cursorRole = null;
    harness.permissionCodes = [];
  });

  it("is Editor when this user holds the lock on an open draft", () => {
    harness.graph = makeGraph({
      version: { ...makeGraph().version, is_draft: true, is_active: false },
      change_request: draftRequest({
        lock: {
          user_id: "77777777-7777-4777-8777-777777777777",
          email: "editor@example.com",
          since: "2026-09-16T07:18:48Z",
          expires_at: "2026-09-16T07:48:48Z",
        },
      }),
    });
    renderMap();
    expect(harness.cursorRole).toBe("Editor");
  });

  it("is Reviewer while this user is a named reviewer on a submitted draft", () => {
    harness.graph = makeGraph({
      version: { ...makeGraph().version, is_draft: true, is_active: false },
      change_request: draftRequest({
        status: "submitted",
        reviewer_1_email: "editor@example.com",
        reviewer_2_email: "boaz.salik@fischerjordan.com",
        lock: {
          user_id: "77777777-7777-4777-8777-777777777777",
          email: "editor@example.com",
          since: "2026-09-16T07:18:48Z",
          expires_at: "2026-09-16T07:48:48Z",
        },
      }),
    });
    renderMap();
    expect(harness.cursorRole).toBe("Reviewer");
  });

  it("is Viewer under review when this user is not a named reviewer", () => {
    harness.graph = makeGraph({
      version: { ...makeGraph().version, is_draft: true, is_active: false },
      change_request: draftRequest({
        status: "submitted",
        reviewer_1_email: "boaz.salik@fischerjordan.com",
        reviewer_2_email: "other@example.com",
      }),
    });
    renderMap();
    expect(harness.cursorRole).toBe("Viewer");
  });

  it("is Reviewer when a review round names this user even if status still says open", () => {
    harness.graph = makeGraph({
      version: { ...makeGraph().version, is_draft: true, is_active: false },
      change_request: draftRequest({
        status: "open",
        submitted_at: "2026-09-16T12:00:00Z",
        reviewer_1_email: "editor@example.com",
      }),
    });
    renderMap();
    expect(harness.cursorRole).toBe("Reviewer");
  });

  it("is Viewer on an open draft nobody holds", () => {
    harness.graph = makeGraph({
      version: { ...makeGraph().version, is_draft: true, is_active: false },
      change_request: draftRequest(),
    });
    renderMap();
    expect(harness.cursorRole).toBe("Viewer");
  });

  it("is Editor on an open draft this user can edit even before the lock is taken", () => {
    harness.graph = makeGraph({
      version: { ...makeGraph().version, is_draft: true, is_active: false },
      change_request: draftRequest(),
    });
    harness.permissionCodes = ["view_flow_tool", "edit_flow_tool"];
    renderMap();
    expect(harness.cursorRole).toBe("Editor");
  });
});
