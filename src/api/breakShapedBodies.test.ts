import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as breakApi from "./breakShapedBodies";

function ok(body: unknown = {}) {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

function lastCall() {
  const mock = vi.mocked(globalThis.fetch);
  const call = mock.mock.calls[0];
  if (call === undefined) throw new Error("fetch was not called");
  const init = (call[1] ?? {}) as RequestInit;
  return {
    url: String(call[0]),
    method: init.method,
    body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok()));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("URLs", () => {
  it("posts to the exact same bvi-backend URL endpoints.ts would use", async () => {
    // The whole point: this app never contacts break-backend directly.
    // Only the body shape differs from endpoints.ts's own calls.
    await breakApi.addEdge("v1", {
      from_question: "1",
      from_option: null,
      to_question: null,
    });

    expect(lastCall().url).toBe("/api/staff/flow-tool/versions/v1/edges/");
  });
});

describe("addEdge", () => {
  it("renames fields to break's own and keeps priority when given", async () => {
    await breakApi.addEdge("v1", {
      from_question: "1",
      from_option: "11",
      to_question: "2",
      priority: 0,
    });

    expect(lastCall().body).toEqual({
      from_question_id: "1",
      from_option_id: "11",
      to_question_id: "2",
      priority: 0,
    });
  });

  it("omits priority entirely when not given, matching endpoints.ts's own contract", async () => {
    await breakApi.addEdge("v1", {
      from_question: "1",
      from_option: null,
      to_question: null,
    });

    const body = lastCall().body as Record<string, unknown>;
    expect(body).not.toHaveProperty("priority");
  });
});

describe("updateEdge", () => {
  it("only renames keys actually present, preserving the leave-alone contract", async () => {
    await breakApi.updateEdge("v1", "e1", { to_question: "2" });

    expect(lastCall().body).toEqual({ to_question_id: "2" });
  });

  it("sends an explicit null through as a real edit, not an omission", async () => {
    await breakApi.updateEdge("v1", "e1", { to_question: null });

    expect(lastCall().body).toEqual({ to_question_id: null });
  });
});

describe("addQuestion", () => {
  it("maps prompt/answer_type/section to break's field names and drops the rest", async () => {
    await breakApi.addQuestion("v1", {
      code: "q1",
      prompt: "Do you agree?",
      answer_type: "single_choice",
      is_required: true,
      section: "5",
      show_raw_answer_to_advisor: true,
    });

    expect(lastCall().body).toEqual({
      question_text: "Do you agree?",
      question_type: "SINGLE_SELECT",
      section_id: "5",
    });
  });

  it("stringifies break's numeric id so it matches what graph/ will hand back", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ id: 43 })));

    const created = await breakApi.addQuestion("v1", {
      code: "q1",
      prompt: "x",
      answer_type: "free_text",
    });

    expect(created).toEqual({ id: "43" });
  });

  it("maps every answer type to break's question_type", async () => {
    const cases: [string, string][] = [
      ["single_choice", "SINGLE_SELECT"],
      ["multi_choice", "MULTI_SELECT"],
      ["free_text", "TEXT"],
      ["scale", "NUMBER"],
    ];
    for (const [bviType, breakType] of cases) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ id: 1 })));
      await breakApi.addQuestion("v1", {
        code: "q",
        prompt: "x",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        answer_type: bviType as any,
      });
      const body = lastCall().body as Record<string, unknown>;
      expect(body["question_type"]).toBe(breakType);
    }
  });
});

describe("updateQuestion", () => {
  it("only sends what's present in changes", async () => {
    await breakApi.updateQuestion("v1", "q1", { prompt: "New text" });

    expect(lastCall().body).toEqual({ question_text: "New text" });
  });

  it("drops code even when present -- break has no such field", async () => {
    await breakApi.updateQuestion("v1", "q1", { code: "renamed", prompt: "text" });

    const body = lastCall().body as Record<string, unknown>;
    expect(body).not.toHaveProperty("code");
    expect(body["question_text"]).toBe("text");
  });

  it("sends an explicit null section through", async () => {
    await breakApi.updateQuestion("v1", "q1", { section: null });

    expect(lastCall().body).toEqual({ section_id: null });
  });
});

describe("addOption", () => {
  it("keeps question in the body and maps label to option_text, dropping code", async () => {
    await breakApi.addOption("v1", { question: "1", code: "yes", label: "Yes" });

    expect(lastCall().body).toEqual({ question: "1", option_text: "Yes" });
  });
});

describe("updateOption", () => {
  it("maps label to option_text", async () => {
    await breakApi.updateOption("v1", "o1", { label: "Renamed" });

    expect(lastCall().body).toEqual({ option_text: "Renamed" });
  });

  it("becomes an empty body for a code-only change, since break has no such field", async () => {
    await breakApi.updateOption("v1", "o1", { code: "renamed" });

    expect(lastCall().body).toEqual({});
  });
});
