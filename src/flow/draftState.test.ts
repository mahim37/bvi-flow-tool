import { describe, expect, it } from "vitest";

import {
  canvasCursorRole,
  draftChromeLabel,
  draftChromeState,
  isUnderReview,
  latestChangeRequest,
  reviewApprovalProgress,
} from "./draftState";

describe("isUnderReview", () => {
  it("is true only for submitted and approved", () => {
    expect(isUnderReview("open")).toBe(false);
    expect(isUnderReview("submitted")).toBe(true);
    expect(isUnderReview("approved")).toBe(true);
    expect(isUnderReview("published")).toBe(false);
    expect(isUnderReview(null)).toBe(false);
  });

  it("is true when a review round is stamped even if status still says open", () => {
    expect(isUnderReview("open", { submittedAt: "2026-09-16T12:00:00Z" })).toBe(true);
    expect(isUnderReview("open", { reviewerEmail: "a@example.com" })).toBe(true);
    expect(isUnderReview("published", { submittedAt: "2026-09-16T12:00:00Z" })).toBe(
      false,
    );
  });
});

describe("draftChromeState", () => {
  it("is Open on an editable draft nobody else holds", () => {
    expect(
      draftChromeState({
        discarded: false,
        isDraft: true,
        status: "open",
        lockedByOther: false,
      }),
    ).toBe("open");
  });

  it("is Locked when someone else holds an open draft", () => {
    expect(
      draftChromeState({
        discarded: false,
        isDraft: true,
        status: "open",
        lockedByOther: true,
      }),
    ).toBe("locked");
  });

  it("is Under review once submitted, even if a lock is still set", () => {
    expect(
      draftChromeState({
        discarded: false,
        isDraft: true,
        status: "submitted",
        lockedByOther: true,
      }),
    ).toBe("under_review");
    expect(
      draftChromeState({
        discarded: false,
        isDraft: true,
        status: "approved",
        lockedByOther: false,
      }),
    ).toBe("under_review");
    expect(
      draftChromeState({
        discarded: false,
        isDraft: true,
        status: "open",
        lockedByOther: false,
        submittedAt: "2026-09-16T12:00:00Z",
      }),
    ).toBe("under_review");
  });

  it("is Discarded when the version is gone", () => {
    expect(
      draftChromeState({
        discarded: true,
        isDraft: true,
        status: "open",
        lockedByOther: false,
      }),
    ).toBe("discarded");
  });

  it("is silent for an editor on an open draft", () => {
    expect(
      draftChromeState({
        discarded: false,
        isDraft: true,
        status: "open",
        lockedByOther: false,
        hideOpen: true,
      }),
    ).toBeNull();
  });

  it("is silent on a published version", () => {
    expect(
      draftChromeState({
        discarded: false,
        isDraft: false,
        status: "published",
        lockedByOther: false,
      }),
    ).toBeNull();
  });
});

describe("draftChromeLabel", () => {
  it("names each state in sentence case", () => {
    expect(draftChromeLabel("open")).toBe("Open");
    expect(draftChromeLabel("locked")).toBe("Locked");
    expect(draftChromeLabel("under_review")).toBe("Under review");
    expect(draftChromeLabel("discarded")).toBe("Discarded");
  });

  it("puts the approval count on Under review", () => {
    expect(draftChromeLabel("under_review", { approved: 0, required: 2 })).toBe(
      "Under review 0/2",
    );
    expect(draftChromeLabel("under_review", { approved: 1, required: 2 })).toBe(
      "Under review 1/2",
    );
  });
});

describe("reviewApprovalProgress", () => {
  it("counts stamped approval timestamps out of two", () => {
    expect(
      reviewApprovalProgress({
        reviewer_1_approved_at: null,
        reviewer_2_approved_at: null,
      }),
    ).toEqual({ approved: 0, required: 2 });
    expect(
      reviewApprovalProgress({
        reviewer_1_approved_at: "2026-09-16T12:00:00Z",
        reviewer_2_approved_at: null,
      }),
    ).toEqual({ approved: 1, required: 2 });
    expect(
      reviewApprovalProgress({
        reviewer_1_approved_at: "2026-09-16T12:00:00Z",
        reviewer_2_approved_at: "2026-09-16T12:05:00Z",
      }),
    ).toEqual({ approved: 2, required: 2 });
  });
});

describe("canvasCursorRole", () => {
  it("is Reviewer only for a named reviewer while the draft is under review", () => {
    expect(
      canvasCursorRole({
        isDraft: true,
        status: "submitted",
        lockEmail: "me@example.com",
        identityEmail: "me@example.com",
        reviewer1Email: "me@example.com",
        reviewer2Email: "other@example.com",
      }),
    ).toBe("Reviewer");
    expect(
      canvasCursorRole({
        isDraft: true,
        status: "open",
        submittedAt: "2026-09-16T12:00:00Z",
        lockEmail: "me@example.com",
        identityEmail: "me@example.com",
        reviewer1Email: "me@example.com",
      }),
    ).toBe("Reviewer");
  });

  it("is Viewer under review when this account is not a named reviewer", () => {
    expect(
      canvasCursorRole({
        isDraft: true,
        status: "submitted",
        lockEmail: "me@example.com",
        identityEmail: "me@example.com",
        reviewer1Email: "boaz.salik@fischerjordan.com",
        reviewer2Email: "other@example.com",
      }),
    ).toBe("Viewer");
    expect(
      canvasCursorRole({
        isDraft: true,
        status: "submitted",
        lockEmail: null,
        identityEmail: "me@example.com",
      }),
    ).toBe("Viewer");
  });

  it("is Editor when this user holds the lock on an open draft", () => {
    expect(
      canvasCursorRole({
        isDraft: true,
        status: "open",
        lockEmail: "me@example.com",
        identityEmail: "me@example.com",
      }),
    ).toBe("Editor");
    expect(
      canvasCursorRole({
        isDraft: true,
        status: "open",
        lockEmail: null,
        identityEmail: "me@example.com",
      }),
    ).toBe("Viewer");
    expect(
      canvasCursorRole({
        isDraft: true,
        status: "open",
        lockEmail: null,
        identityEmail: "me@example.com",
        permissionCodes: ["view_flow_tool", "edit_flow_tool"],
      }),
    ).toBe("Editor");
    expect(
      canvasCursorRole({
        isDraft: true,
        status: "open",
        lockEmail: "other@example.com",
        identityEmail: "me@example.com",
      }),
    ).toBe("Viewer");
  });

  it("is Viewer on a published version", () => {
    expect(
      canvasCursorRole({
        isDraft: false,
        status: "published",
        lockEmail: null,
        identityEmail: "me@example.com",
      }),
    ).toBe("Viewer");
  });
});

describe("latestChangeRequest", () => {
  const open = {
    id: "1",
    draft_version: "v",
    created_by: "a",
    created_by_email: "a@example.com",
    summary: "",
    status: "open" as const,
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
    created: "2026-09-16T10:00:00Z",
    modified: "2026-09-16T10:00:00Z",
    break_draft_version_id: null,
  };

  it("prefers a submitted copy over a stale open graph payload", () => {
    expect(
      latestChangeRequest([
        open,
        {
          ...open,
          status: "submitted",
          submitted_at: "2026-09-16T11:00:00Z",
          modified: "2026-09-16T11:00:00Z",
        },
      ])?.status,
    ).toBe("submitted");
  });
});
