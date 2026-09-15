import { screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Graph } from "../api/types";
import { VERSION_ID, makeGraph } from "../test/fixtures";
import { renderWithProviders } from "../test/render";
import { MapView } from "./MapView";

const harness = vi.hoisted(() => ({
  editable: true,
  graph: null as Graph | null,
  editRefused: false,
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
    editable: harness.editable,
  }),
}));

vi.mock("../auth/useAuth", () => ({
  useAuth: () => ({
    identity: {
      email: "editor@example.com",
      name: "Ed",
      role: null,
      permission_codes: [],
    },
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
  Canvas: ({ topRight }: { topRight?: unknown }) => (
    <div data-testid="canvas">{topRight as never}</div>
  ),
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
    harness.graph = makeGraph({
      version: { ...makeGraph().version, is_draft: true, is_active: false },
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
