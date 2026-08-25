import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, request } from "./client";

function respond(status: number, body?: unknown, ok = status < 400) {
  return {
    ok,
    status,
    text: () => Promise.resolve(body === undefined ? "" : JSON.stringify(body)),
  } as Response;
}

function lastInit(): RequestInit {
  const mock = vi.mocked(globalThis.fetch);
  const call = mock.mock.calls[0];
  if (call === undefined) throw new Error("fetch was not called");
  return (call[1] ?? {}) as RequestInit;
}

function headers(): Record<string, string> {
  return (lastInit().headers ?? {}) as Record<string, string>;
}

function clearCookies() {
  for (const name of ["csrftoken", "__Secure-csrftoken"]) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

beforeEach(() => {
  clearCookies();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearCookies();
});

describe("credentials and CSRF", () => {
  it("sends the session cookie on every request", () => {
    // Without this the staff session simply is not attached, and the API
    // answers 401 no matter how correct everything else is.
    vi.mocked(globalThis.fetch).mockResolvedValue(respond(200, []));

    return request("/api/staff/flow-tool/versions/").then(() => {
      expect(lastInit().credentials).toBe("include");
    });
  });

  it("omits the CSRF header on a safe method", async () => {
    document.cookie = "csrftoken=abc123; path=/";
    vi.mocked(globalThis.fetch).mockResolvedValue(respond(200, []));

    await request("/api/staff/flow-tool/versions/");

    expect(headers()["X-CSRFToken"]).toBeUndefined();
  });

  it("echoes the CSRF cookie on an unsafe method", async () => {
    document.cookie = "csrftoken=abc123; path=/";
    vi.mocked(globalThis.fetch).mockResolvedValue(respond(201, { id: "x" }));

    await request("/api/staff/flow-tool/versions/x/edges/", {
      method: "POST",
      body: {},
    });

    expect(headers()["X-CSRFToken"]).toBe("abc123");
  });

  it("finds the cookie under the production __Secure- name too", async () => {
    // `production.py` renames it, and a differently-prefixed cookie is a
    // different cookie as far as the browser is concerned -- so one build
    // has to look for both or every write fails in deployment only.
    //
    // Written straight onto `document.cookie` rather than assigned,
    // because the `__Secure-` prefix is only accepted over https and the
    // test document is served from http -- jsdom is right to drop it, and
    // that has nothing to do with what is being tested here.
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
    Object.defineProperty(document, "cookie", {
      get: () => "__Secure-csrftoken=prod-token",
      configurable: true,
    });
    vi.mocked(globalThis.fetch).mockResolvedValue(respond(204));

    try {
      await request("/api/staff/flow-tool/versions/x/lock/", { method: "DELETE" });
      expect(headers()["X-CSRFToken"]).toBe("prod-token");
    } finally {
      if (descriptor) Object.defineProperty(document, "cookie", descriptor);
    }
  });
});

describe("responses", () => {
  it("returns undefined for 204, rather than trying to parse a body", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(respond(204));

    await expect(request("/api/x/", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("parses a JSON body", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(respond(200, [{ id: "one" }]));

    await expect(request("/api/x/")).resolves.toEqual([{ id: "one" }]);
  });
});

describe("errors", () => {
  it("uses the detail message the editing services raise", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      respond(409, { detail: "This version already has a draft." }, false),
    );

    await expect(
      request("/api/x/", { method: "POST", body: {} }),
    ).rejects.toMatchObject({
      status: 409,
      message: "This version already has a draft.",
    });
  });

  it("flattens a field-keyed serializer error into one line", async () => {
    // DRF answers a serializer failure field-keyed and the editing
    // services answer with `detail`; both reach the same UI, so both are
    // flattened here instead of at each call site.
    vi.mocked(globalThis.fetch).mockResolvedValue(
      respond(400, { to_question: ["Invalid pk."] }, false),
    );

    await expect(request("/api/x/", { method: "POST", body: {} })).rejects.toThrow(
      "to_question: Invalid pk.",
    );
  });

  it("carries the lock holder out of a 409", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      respond(
        409,
        {
          detail: "Somebody else is editing this draft.",
          locked_by_id: "user-1",
          locked_by_email: "sam@example.com",
          locked_at: "2026-08-18T10:00:00Z",
        },
        false,
      ),
    );

    const caught = await request("/api/x/", { method: "POST", body: {} }).catch(
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).lockHolder).toEqual({
      email: "sam@example.com",
      since: "2026-08-18T10:00:00Z",
    });
  });

  it("carries the blocking edges out of a refused option delete", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      respond(
        400,
        {
          detail: "1 edge(s) are guarded by q1.yes.",
          blocking_edges: [
            {
              edge_id: "edge-1",
              from_question_id: "q-1",
              from_question_code: "q1",
              from_question_prompt: "Are you employed?",
            },
          ],
        },
        false,
      ),
    );

    const caught = await request("/api/x/", { method: "DELETE" }).catch(
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).blockingEdges).toEqual([
      {
        edgeId: "edge-1",
        fromQuestionId: "q-1",
        fromQuestionCode: "q1",
        fromQuestionPrompt: "Are you employed?",
      },
    ]);
    expect((caught as ApiError).blockingQuestions).toBeNull();
  });

  it("carries the blocking questions out of a refused section delete", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      respond(
        400,
        {
          detail: "1 question(s) are still filed under sec_health.",
          blocking_questions: [{ id: "q-1", code: "q1", prompt: "Are you employed?" }],
        },
        false,
      ),
    );

    const caught = await request("/api/x/", { method: "DELETE" }).catch(
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).blockingQuestions).toEqual([
      { id: "q-1", code: "q1", prompt: "Are you employed?" },
    ]);
    expect((caught as ApiError).blockingEdges).toBeNull();
  });

  it("ignores a malformed blocking-edge row rather than throwing", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      respond(
        400,
        { detail: "refused", blocking_edges: [{ edge_id: "edge-1" }] },
        false,
      ),
    );

    const caught = await request("/api/x/", { method: "DELETE" }).catch(
      (error: unknown) => error,
    );

    expect((caught as ApiError).blockingEdges).toEqual([]);
  });

  it("tells a failed CSRF check apart from a permission refusal", async () => {
    // Both are 403. Only one of them is a statement about the account, and
    // announcing "you do not have edit access" at a stale token would be
    // telling somebody they lack a permission they hold.
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      respond(403, { detail: "CSRF Failed: CSRF token missing." }, false),
    );
    const csrf = (await request("/api/x/", { method: "POST", body: {} }).catch(
      (error: unknown) => error,
    )) as ApiError;

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      respond(
        403,
        { detail: "You do not have permission to perform this action." },
        false,
      ),
    );
    const denied = (await request("/api/x/", { method: "POST", body: {} }).catch(
      (error: unknown) => error,
    )) as ApiError;

    expect(csrf.isCsrfFailure).toBe(true);
    expect(denied.isCsrfFailure).toBe(false);
    expect(denied.isForbidden).toBe(true);
  });

  it("tells a dead session apart from a permission refusal, both 403", async () => {
    // `StaffSessionAuthentication` sets no `WWW-Authenticate` header, so
    // DRF downgrades every auth failure -- no cookie, an expired session,
    // a revoked one -- from 401 to 403, same status as "signed in but
    // lacks the grant". Telling them apart by message is what sends a
    // dead session back to sign-in instead of "ask an admin for access".
    for (const detail of [
      "Authentication credentials were not provided.",
      "Session not found.",
      "Session has been revoked.",
      "User is not active.",
      "Session has expired.",
    ]) {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(respond(403, { detail }, false));
      const caught = (await request("/api/x/").catch((error: unknown) => error)) as ApiError;
      expect(caught.isUnauthenticated).toBe(true);
    }

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      respond(
        403,
        { detail: "You do not have permission to perform this action." },
        false,
      ),
    );
    const denied = (await request("/api/x/").catch((error: unknown) => error)) as ApiError;
    expect(denied.isUnauthenticated).toBe(false);
    expect(denied.isForbidden).toBe(true);
  });

  it("still produces a message when the body is not JSON", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      status: 502,
      text: () => Promise.resolve("<html>bad gateway</html>"),
    } as Response);

    await expect(request("/api/x/")).rejects.toThrow("Request failed (502).");
  });
});
