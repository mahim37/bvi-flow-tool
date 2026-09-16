import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChangeRequest } from "../api/types";
import { VERSION_ID, makeGraph } from "../test/fixtures";
import { renderWithProviders } from "../test/render";
import { DraftBar } from "./DraftBar";

const AUTHOR = "postman-demo@example.com";
const OTHER_EDITOR = "boaz.salik@fischerjordan.com";

function signIn(
  email: string,
  permissionCodes: string[] = ["view_flow_tool", "edit_flow_tool", "publish_flow_tool"],
) {
  window.localStorage.setItem(
    "bvi-flow-tool.identity",
    JSON.stringify({
      email,
      name: email,
      role: null,
      permission_codes: permissionCodes,
    }),
  );
}

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
  afterEach(() => {
    window.localStorage.clear();
  });

  it("offers Discard to any publish-grant holder, not just the two required reviewers", () => {
    // `editing._require_author_or_publisher` (the server check behind
    // Discard) accepts anyone holding `publish_flow_tool` -- a wider set
    // than the two people `REQUIRED_REVIEWER_EMAILS` fixes for `submit`'s
    // own review pair. This account is neither the author nor one of
    // those two, and must still see the button.
    signIn("some-other-publisher@example.com", ["view_flow_tool", "publish_flow_tool"]);
    renderBar();

    expect(screen.getByRole("button", { name: "Discard draft" })).toBeInTheDocument();
  });

  it("does not offer Discard to a viewer with neither authorship nor the publish grant", () => {
    signIn("some-viewer@example.com", ["view_flow_tool"]);
    renderBar();

    expect(
      screen.queryByRole("button", { name: "Discard draft" }),
    ).not.toBeInTheDocument();
  });

  it("keeps draft warnings behind a red Alerts control", async () => {
    const user = userEvent.setup();
    renderBar();

    expect(screen.queryByRole("link", { name: "Check diff" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add a question" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review" })).toBeInTheDocument();
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

  it("names an open draft beside the status and keeps who proposed it", () => {
    renderBar();

    expect(screen.queryByText(/Editable\. Submit/)).not.toBeInTheDocument();
    expect(screen.getByText("draft")).toBeInTheDocument();
    expect(
      screen.getByText(/Proposed by postman-demo@example.com/),
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

describe("DraftBar author actions", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  function draftGraph(changeRequest: ChangeRequest) {
    return makeGraph({
      version: {
        ...makeGraph().version,
        is_draft: true,
        is_active: false,
        is_stale: false,
      },
      change_request: changeRequest,
    });
  }

  it("offers Submit for review on an open draft the author holds", () => {
    signIn(AUTHOR);
    renderBar(draftGraph(openProposal({ created_by_email: AUTHOR })));

    expect(
      screen.getByRole("button", { name: "Submit for review" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard draft" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Withdraw review" }),
    ).not.toBeInTheDocument();
  });

  it("offers Withdraw review instead of Submit once the draft is under review", () => {
    signIn(AUTHOR);
    renderBar(
      draftGraph(openProposal({ created_by_email: AUTHOR, status: "submitted" })),
    );

    expect(screen.getByRole("button", { name: "Withdraw review" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Submit for review" }),
    ).not.toBeInTheDocument();
  });

  it("treats a named review round as under review even if status still says open", () => {
    signIn(AUTHOR);
    renderBar(
      draftGraph(
        openProposal({
          created_by_email: AUTHOR,
          status: "open",
          submitted_at: "2026-09-16T12:00:00Z",
          reviewer_1_email: "boaz.salik@fischerjordan.com",
        }),
      ),
    );

    expect(screen.getByRole("button", { name: "Withdraw review" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Submit for review" }),
    ).not.toBeInTheDocument();
  });

  it("uses the live proposal when graph.change_request is still open", () => {
    signIn(AUTHOR);
    renderWithProviders(
      <MemoryRouter>
        <DraftBar
          graph={draftGraph(openProposal({ created_by_email: AUTHOR, status: "open" }))}
          proposal={openProposal({ created_by_email: AUTHOR, status: "submitted" })}
          versions={[]}
          onOpenVersion={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Withdraw review" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Submit for review" }),
    ).not.toBeInTheDocument();
  });

  it("hides submit, discard and the lock lecture when someone else holds the draft", () => {
    signIn(AUTHOR);
    renderBar(
      draftGraph(
        openProposal({
          created_by_email: AUTHOR,
          lock: {
            user_id: "77777777-7777-4777-8777-777777777777",
            email: OTHER_EDITOR,
            since: "2026-09-16T07:18:48.654757+00:00",
            expires_at: "2026-09-16T08:18:48.654757+00:00",
          },
        }),
      ),
    );

    expect(
      screen.queryByRole("button", { name: "Submit for review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Discard draft" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/is editing this draft/)).not.toBeInTheDocument();
    expect(screen.queryByText(/2026-09-16T07:18:48/)).not.toBeInTheDocument();
  });

  const SOME_UNDO_ACTION = {
    revision_id: "revision-uuid",
    event_type: "edge_added" as const,
    detail: "Edge added: q1 (yes) -> q2",
  };

  it("shows Undo and Redo per the server's own can_undo/can_redo flags", () => {
    signIn(AUTHOR);
    renderBar({
      ...draftGraph(openProposal({ created_by_email: AUTHOR })),
      edit_history: {
        can_undo: true,
        can_redo: false,
        undo: SOME_UNDO_ACTION,
        redo: null,
      },
    });

    const undo = screen.getByRole("button", { name: "Undo" });
    const redo = screen.getByRole("button", { name: "Redo" });
    expect(undo).toBeEnabled();
    expect(redo).toBeDisabled();
    // `detail` is already display-ready text from the server -- shown
    // as-is in the native tooltip rather than reworded here.
    expect(undo).toHaveAttribute("title", "Undo: Edge added: q1 (yes) -> q2");
    expect(redo).toHaveAttribute("title", "Nothing to redo.");
  });

  it("shows both controls disabled on a fresh draft with no tracked edits", () => {
    signIn(AUTHOR);
    renderBar({
      ...draftGraph(openProposal({ created_by_email: AUTHOR })),
      edit_history: { can_undo: false, can_redo: false, undo: null, redo: null },
    });

    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
  });

  it("hides undo/redo once the draft is frozen under review", () => {
    signIn(AUTHOR);
    renderBar({
      ...draftGraph(openProposal({ created_by_email: AUTHOR, status: "submitted" })),
      edit_history: {
        can_undo: true,
        can_redo: false,
        undo: SOME_UNDO_ACTION,
        redo: null,
      },
    });

    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Redo" })).not.toBeInTheDocument();
  });

  it("hides undo/redo while someone else holds the lock", () => {
    signIn(AUTHOR);
    renderBar({
      ...draftGraph(
        openProposal({
          created_by_email: AUTHOR,
          lock: {
            user_id: "77777777-7777-4777-8777-777777777777",
            email: OTHER_EDITOR,
            since: "2026-09-16T07:18:48.654757+00:00",
            expires_at: "2026-09-16T08:18:48.654757+00:00",
          },
        }),
      ),
      edit_history: {
        can_undo: true,
        can_redo: false,
        undo: SOME_UNDO_ACTION,
        redo: null,
      },
    });

    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Redo" })).not.toBeInTheDocument();
  });

  it("does not offer undo/redo on a published version", () => {
    renderWithProviders(
      <MemoryRouter>
        <DraftBar
          graph={makeGraph({
            edit_history: {
              can_undo: true,
              can_redo: false,
              undo: SOME_UNDO_ACTION,
              redo: null,
            },
          })}
          versions={[]}
          onOpenVersion={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Redo" })).not.toBeInTheDocument();
  });

  it("offers Unlock with a confirm overlay when this user holds the lock", async () => {
    const user = userEvent.setup();
    signIn(AUTHOR);
    renderBar(
      draftGraph(
        openProposal({
          created_by_email: AUTHOR,
          lock: {
            user_id: "77777777-7777-4777-8777-777777777777",
            email: AUTHOR,
            since: "2026-09-16T07:18:48.654757+00:00",
            expires_at: "2026-09-16T08:18:48.654757+00:00",
          },
        }),
      ),
    );

    expect(
      screen.queryByRole("button", { name: "Release it" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    expect(
      screen.getByText(
        "Allow others to edit this draft? Making a change locks draft automatically.",
      ),
    ).toBeInTheDocument();
  });
});
