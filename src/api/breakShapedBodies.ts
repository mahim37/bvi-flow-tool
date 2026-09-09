/**
 * Break-shaped *request bodies* for `endpoints.ts`'s content-CRUD write
 * verbs -- **not** a client for break-backend, and this app never becomes
 * one. Every function here calls `request()` against the exact same
 * bvi-backend URL (`version()`, reused from `endpoints.ts`) that the
 * ordinary bvi-shaped call would use -- same origin, same session cookie,
 * same CSRF handling, nothing added. bvi-backend is the only thing this
 * app ever talks to.
 *
 * The one thing that differs is what's inside that request. A BREAK-hosted
 * draft (`ChangeRequest.break_draft_version_id !== null`, see that field's
 * own comment in `types.ts`) has bvi-backend itself forward the write on,
 * server-side, to break-backend's own API -- unvalidated by this app's own
 * request serializers on the way, since break's own serializers are the
 * one source of truth for what a write against that draft looks like (see
 * `break_client.py`'s docstring, bvi-backend). That server-side forward is
 * what needs break's own field names in the body this app sends, even
 * though the URL this app posts to is bvi-backend's, unchanged.
 *
 * Responses need no translation back: every mutation hook in `queries.ts`
 * refetches `graph/` on success rather than reading its own response body
 * (this app's own stated rule, see CLAUDE.md's "Two rules this codebase
 * keeps" -- "every write refetches the map rather than patching
 * optimistically"), and `graph/` is already translated into this app's own
 * shape server-side (`break_graph.py`, bvi-backend).
 */

import { request } from "./client";
import { version } from "./endpoints";
import type { NewEdge, NewOption, NewQuestion, QuestionChanges } from "./endpoints";
import type { AnswerType, Edge, QuestionOption, UUID } from "./types";

// bvi's AnswerType -> break's Question.question_type. The reverse of
// break_graph.py's own mapping (bvi-backend) -- SCALE maps back to NUMBER
// there, so it has to map there again here for a round trip to hold,
// even though nothing on this side ever reads a BREAK question's answer
// type back out to compare it.
const ANSWER_TYPE_TO_BREAK_QUESTION_TYPE: Record<AnswerType, string> = {
  single_choice: "SINGLE_SELECT",
  multi_choice: "MULTI_SELECT",
  free_text: "TEXT",
  scale: "NUMBER",
};

// Every function below but `addQuestion` resolves `void`, honestly: none
// of their responses are read anywhere in this app (grepped `onSuccess`
// call sites to confirm before typing it this way) -- every one of these
// writes is followed by a `graph/` refetch instead, per this module's own
// docstring. Typed `void` rather than the bvi shape their `endpoints.ts`
// counterparts return, so nothing downstream can be tempted to read a
// field this branch never actually populates.

export const addEdge = async (versionId: UUID, edge: NewEdge): Promise<void> => {
  await request<unknown>(`${version(versionId)}/edges/`, {
    method: "POST",
    body: {
      from_question_id: edge.from_question,
      from_option_id: edge.from_option ?? null,
      to_question_id: edge.to_question ?? null,
      ...(edge.priority !== undefined ? { priority: edge.priority } : {}),
    },
  });
};

export const updateEdge = async (
  versionId: UUID,
  edgeId: UUID,
  changes: Partial<Pick<Edge, "from_option" | "to_question">>,
): Promise<void> => {
  const body: Record<string, unknown> = {};
  // Only what's actually present in `changes` -- break's own
  // UpdateEdgeRequestSerializer has the identical "absent means leave
  // alone, explicit null is a real edit" contract this app's own does.
  if ("from_option" in changes) body["from_option_id"] = changes.from_option;
  if ("to_question" in changes) body["to_question_id"] = changes.to_question;
  await request<unknown>(`${version(versionId)}/edges/${edgeId}/`, {
    method: "PATCH",
    body,
  });
};

/**
 * The one write response this app actually reads (`AddQuestion.tsx`'s
 * `onAdded(created.id)`, to select the new question immediately) rather
 * than only refetching past -- see this module's own docstring. Break's
 * raw response has its `id` as a JSON number (a plain DRF `IntegerField`,
 * not run through `break_graph.py`'s stringifying at all, since that only
 * translates `graph/`), so it has to be coerced to match what the very
 * next `graph/` refetch will hand back for the same question -- a bare
 * `String(...)` cast would otherwise select a `43` today and fail to
 * match the `"43"` graph/ hands back once it reloads.
 */
export const addQuestion = async (
  versionId: UUID,
  question: NewQuestion,
): Promise<{ id: UUID }> => {
  const created = await request<{ id: number }>(`${version(versionId)}/questions/`, {
    method: "POST",
    body: {
      question_text: question.prompt,
      question_type: ANSWER_TYPE_TO_BREAK_QUESTION_TYPE[question.answer_type],
      section_id: question.section ?? null,
      // code, is_required, show_raw_answer_to_advisor: no break equivalent.
      // Dropped rather than sent and ignored, so a payload inspected on
      // the wire doesn't suggest a field break might someday honour.
    },
  });
  return { id: String(created.id) };
};

export const updateQuestion = async (
  versionId: UUID,
  questionId: UUID,
  changes: QuestionChanges,
): Promise<void> => {
  const body: Record<string, unknown> = {};
  if ("prompt" in changes) body["question_text"] = changes.prompt;
  if ("answer_type" in changes && changes.answer_type !== undefined) {
    body["question_type"] = ANSWER_TYPE_TO_BREAK_QUESTION_TYPE[changes.answer_type];
  }
  if ("section" in changes) body["section_id"] = changes.section;
  // code, is_required, show_raw_answer_to_advisor: dropped, see addQuestion.
  await request<unknown>(`${version(versionId)}/questions/${questionId}/`, {
    method: "PATCH",
    body,
  });
};

export const addOption = async (versionId: UUID, option: NewOption): Promise<void> => {
  // `question` still rides in the body, matching this app's own
  // AddOptionRequestSerializer shape -- FlowToolOptionCreateView's BREAK
  // branch (bvi-backend) reads it from there to build break's own
  // .../questions/<id>/options/ URL, since break's own request shape has
  // no room for it (option_text only).
  await request<unknown>(`${version(versionId)}/options/`, {
    method: "POST",
    body: {
      question: option.question,
      option_text: option.label,
      // code: no break equivalent, dropped.
    },
  });
};

export const updateOption = async (
  versionId: UUID,
  optionId: UUID,
  changes: Partial<Pick<QuestionOption, "code" | "label">>,
): Promise<void> => {
  const body: Record<string, unknown> = {};
  if ("label" in changes) body["option_text"] = changes.label;
  // code: no break equivalent -- a code-only edit becomes an empty body,
  // which break's own UpdateOptionRequestSerializer (every field optional)
  // accepts as a no-op write rather than a refusal.
  await request<unknown>(`${version(versionId)}/options/${optionId}/`, {
    method: "PATCH",
    body,
  });
};
