import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "./endpoints";

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

describe("paths", () => {
  it("nests every write under its version", async () => {
    // The version id is what the "is this a draft, and may you edit it"
    // check reads. Addressing an edge directly would drop it from the URL.
    await api.addEdge("v1", {
      from_question: "q1",
      from_option: null,
      to_question: null,
    });

    expect(lastCall().url).toBe("/api/staff/flow-tool/versions/v1/edges/");
  });

  it("puts the whole ordering to the question's edge-order path", async () => {
    await api.reorderEdges("v1", "q1", ["e2", "e1"]);

    const call = lastCall();
    expect(call.url).toBe("/api/staff/flow-tool/versions/v1/questions/q1/edge-order/");
    expect(call.method).toBe("PUT");
    expect(call.body).toEqual({ edge_ids: ["e2", "e1"] });
  });

  it("releases the lock by deleting it, and has no way to take it", () => {
    // Deliberate: the lock is taken by the first edit and by nothing else,
    // so there is no acquire verb for a client to call on mount.
    expect(Object.keys(api)).not.toContain("acquireLock");
    expect(Object.keys(api)).toContain("releaseLock");
  });
});

describe("edge updates", () => {
  it("sends only the end being moved", async () => {
    // `FlowToolEdgeUpdateSerializer` has no defaults, so an absent key
    // means "leave this alone". Sending both with one undefined would
    // erase that distinction before the server ever saw it.
    await api.updateEdge("v1", "e1", { to_question: "q2" });

    expect(lastCall().body).toEqual({ to_question: "q2" });
  });

  it("sends an explicit null, which is a real edit rather than an omission", async () => {
    // Clearing `to_question` makes the edge end the flow; clearing
    // `from_option` promotes it to the question-level fallback.
    await api.updateEdge("v1", "e1", { to_question: null });

    expect(lastCall().body).toEqual({ to_question: null });
  });
});
