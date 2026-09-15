import { describe, expect, it } from "vitest";

import { Q1, Q2, makeGraph } from "../test/fixtures";
import { regionLabel } from "./labels";

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
