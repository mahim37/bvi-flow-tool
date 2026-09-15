import { describe, expect, it } from "vitest";

import { Q1, Q2, makeGraph } from "../test/fixtures";
import { regionLabel, statusLabel, statusMeaning } from "./labels";

describe("regionLabel", () => {
  const questions = makeGraph().questions;

  it("names a single-question region by its QID", () => {
    expect(regionLabel({ question_ids: [Q1], before_id: null }, questions)).toBe(
      "QID Q1 · Prompt for Q1",
    );
  });

  it("names a multi-question region by its code range", () => {
    expect(
      regionLabel({ question_ids: [Q1, Q2], before_id: null }, questions),
    ).toBe("2 questions (Q1–Q2)");
  });

  it("falls back gracefully if a member no longer resolves against the graph", () => {
    expect(
      regionLabel({ question_ids: ["missing-id", Q2], before_id: null }, questions),
    ).toBe("2 questions (?–Q2)");
  });
});

describe("proposal status copy", () => {
  it("does not treat one of two approvals as ready to publish", () => {
    expect(statusLabel("approved")).toBe("Waiting on second reviewer");
    expect(statusMeaning("approved")).toMatch(/two required reviewers/i);
    expect(statusMeaning("approved")).not.toMatch(/ready to publish/i);
  });

  it("does not teach how to submit an open draft", () => {
    expect(statusMeaning("open")).toBe("");
  });
});
