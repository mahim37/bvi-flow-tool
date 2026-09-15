import { describe, expect, it } from "vitest";

import { bothReviewersApproved } from "./types";

describe("bothReviewersApproved", () => {
  it("is false until both timestamps are set", () => {
    expect(
      bothReviewersApproved({
        reviewer_1_approved_at: null,
        reviewer_2_approved_at: null,
      }),
    ).toBe(false);
    expect(
      bothReviewersApproved({
        reviewer_1_approved_at: "2026-08-02T10:00:00Z",
        reviewer_2_approved_at: null,
      }),
    ).toBe(false);
    expect(
      bothReviewersApproved({
        reviewer_1_approved_at: null,
        reviewer_2_approved_at: "2026-08-02T10:00:00Z",
      }),
    ).toBe(false);
  });

  it("is true only when both named reviewers have approved", () => {
    expect(
      bothReviewersApproved({
        reviewer_1_approved_at: "2026-08-02T10:00:00Z",
        reviewer_2_approved_at: "2026-08-02T11:00:00Z",
      }),
    ).toBe(true);
  });
});
