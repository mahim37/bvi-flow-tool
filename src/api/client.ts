/**
 * The one place this app talks to Django.
 *
 * Everything here exists because of how `StaffSessionAuthentication` works:
 * the session is a cookie, so requests must be credentialed, and CSRF is
 * enforced on every unsafe method, so they must carry `X-CSRFToken`.
 */

/** Django's default name locally; `production.py` renames it under the
 * `__Secure-` prefix, which is a different cookie as far as the browser is
 * concerned. Both are checked so one build works against either. */
const CSRF_COOKIE_NAMES = ["csrftoken", "__Secure-csrftoken"] as const;
const CSRF_HEADER = "X-CSRFToken";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

export class ApiError extends Error {
  readonly status: number;
  /** The parsed body, when there was one. DRF answers with either
   * `{detail: "..."}` or a field-keyed map of message lists, and the
   * editing services add keys of their own to the former. */
  readonly body: Record<string, unknown> | null;

  constructor(message: string, status: number, body: Record<string, unknown> | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

  /** No session, or one the server rejected. The caller's job is to send
   * the user back to the sign-in screen, never to retry. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /** Authenticated, but not allowed. Distinguished from the above because
   * the remedy is completely different: somebody has to grant the flow-tool
   * permission, and retrying will never help. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  /**
   * A 403 raised by Django's CSRF check rather than by a permission.
   *
   * Worth telling apart: `StaffSessionAuthentication.enforce_csrf` raises
   * `PermissionDenied` for a missing or stale token, which is a fixable
   * client-side problem, while every other 403 is a statement about what
   * this account is allowed to do. Treating the two alike would have the
   * app announce "you do not have edit access" at somebody whose token
   * had simply gone stale.
   */
  get isCsrfFailure(): boolean {
    const detail = this.body?.["detail"];
    return (
      this.status === 403 &&
      typeof detail === "string" &&
      detail.startsWith("CSRF Failed")
    );
  }

  /** The draft is in a state that forbids this: somebody else is editing,
   * it is already submitted, a draft already exists. */
  get isConflict(): boolean {
    return this.status === 409;
  }

  /**
   * Who is holding the draft, when the refusal was a held lock.
   *
   * `editing.DraftLockedError.detail_payload` puts these on the body so a
   * client does not have to re-read the draft to find out who to go and
   * ask.
   */
  get lockHolder(): { email: string; since: string } | null {
    const email = this.body?.["locked_by_email"];
    const since = this.body?.["locked_at"];
    if (typeof email !== "string" || typeof since !== "string") return null;
    return { email, since };
  }

  /**
   * The edges still guarding an option a delete would remove.
   *
   * `editing.OptionGuardedError.detail_payload` puts these on the body so
   * the refusal can name which questions to go and fix, not just how many
   * -- one of those edges may leave a question other than the option's
   * own (the dead-edge case a draft copy preserves).
   */
  get blockingEdges(): readonly BlockingEdge[] | null {
    const raw = this.body?.["blocking_edges"];
    if (!Array.isArray(raw)) return null;
    return raw.flatMap((row) => {
      if (typeof row !== "object" || row === null) return [];
      const { edge_id, from_question_id, from_question_code, from_question_prompt } =
        row as Record<string, unknown>;
      if (
        typeof edge_id !== "string" ||
        typeof from_question_id !== "string" ||
        typeof from_question_code !== "string" ||
        typeof from_question_prompt !== "string"
      ) {
        return [];
      }
      return [
        {
          edgeId: edge_id,
          fromQuestionId: from_question_id,
          fromQuestionCode: from_question_code,
          fromQuestionPrompt: from_question_prompt,
        },
      ];
    });
  }

  /**
   * The questions still filed under a section a delete would remove.
   *
   * `editing.SectionNotEmptyError.detail_payload` puts these on the body
   * for the same reason `blockingEdges` does: naming them is what lets
   * somebody go refile each one, instead of hunting the section list for
   * a count.
   */
  get blockingQuestions(): readonly BlockingQuestionRef[] | null {
    const raw = this.body?.["blocking_questions"];
    if (!Array.isArray(raw)) return null;
    return raw.flatMap((row) => {
      if (typeof row !== "object" || row === null) return [];
      const { id, code, prompt } = row as Record<string, unknown>;
      if (
        typeof id !== "string" ||
        typeof code !== "string" ||
        typeof prompt !== "string"
      ) {
        return [];
      }
      return [{ id, code, prompt }];
    });
  }
}

export interface BlockingEdge {
  edgeId: string;
  fromQuestionId: string;
  fromQuestionCode: string;
  fromQuestionPrompt: string;
}

export interface BlockingQuestionRef {
  id: string;
  code: string;
  prompt: string;
}

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  for (const part of document.cookie.split("; ")) {
    if (part.startsWith(prefix)) return decodeURIComponent(part.slice(prefix.length));
  }
  return null;
}

function csrfToken(): string | null {
  for (const name of CSRF_COOKIE_NAMES) {
    const value = readCookie(name);
    if (value) return value;
  }
  return null;
}

/**
 * Turn a DRF error body into one line a human can act on.
 *
 * Serializer errors arrive field-keyed (`{"to_question": ["..."]}`) while
 * the editing services raise `{"detail": "..."}`; both reach the UI through
 * the same surface, so both are flattened here rather than at each call
 * site.
 */
function messageFrom(body: Record<string, unknown> | null, status: number): string {
  if (body === null) return `Request failed (${status}).`;
  const detail = body["detail"];
  if (typeof detail === "string") return detail;

  const parts: string[] = [];
  for (const [field, value] of Object.entries(body)) {
    const messages = Array.isArray(value) ? value : [value];
    for (const message of messages) {
      if (typeof message === "string") {
        parts.push(field === "non_field_errors" ? message : `${field}: ${message}`);
      }
    }
  }
  return parts.length > 0 ? parts.join(" ") : `Request failed (${status}).`;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};

  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (!SAFE_METHODS.has(method)) {
    const token = csrfToken();
    // Sent only when present. A missing token is not worth failing on
    // here: Django will answer 403 with a reason far more specific than
    // anything this layer could guess at.
    if (token) headers[CSRF_HEADER] = token;
  }

  const init: RequestInit = {
    method,
    headers,
    // Same-origin through the dev proxy, cross-origin in a deployment that
    // has one configured. `include` covers both; `same-origin` would
    // silently drop the session cookie in the second case.
    credentials: "include",
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  if (options.signal) init.signal = options.signal;

  const response = await fetch(path, init);

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  const body =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;

  if (!response.ok) {
    throw new ApiError(messageFrom(body, response.status), response.status, body);
  }
  return parsed as T;
}
