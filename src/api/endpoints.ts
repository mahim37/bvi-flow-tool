import { request } from "./client";
import type {
  AnswerType,
  ChangeRequest,
  Edge,
  Graph,
  PreviewAnswer,
  PreviewState,
  QuestionOption,
  QuestionRecord,
  ReviewPayload,
  SectionRecord,
  StaffIdentity,
  UUID,
  Version,
  VersionListItem,
} from "./types";

const FLOW_TOOL = "/api/staff/flow-tool";
const STAFF_AUTH = "/api/staff/auth";

/** Every write verb is nested under its version, matching
 * `questionnaires/api/flow_tool/urls.py` -- the version id is what the
 * "is this a draft, and may you edit it" check reads, so it is in the path
 * rather than re-derived. */
const version = (versionId: UUID) => `${FLOW_TOOL}/versions/${versionId}`;

export const login = (email: string, password: string) =>
  request<StaffIdentity>(`${STAFF_AUTH}/login/`, {
    method: "POST",
    body: { email, password },
  });

export const logout = () => request<void>(`${STAFF_AUTH}/logout/`, { method: "POST" });

/**
 * Every version, unpaginated, grouped by questionnaire.
 *
 * `questionnaireId` narrows it to one product, through the server's own
 * `?questionnaire=` filter rather than a client-side `.filter()`: the
 * annotation behind `is_stale` is computed in that queryset, so filtering
 * here is what keeps a picker showing several sandboxes honest about
 * which of them are still behind the live version.
 */
export const listVersions = (questionnaireId?: UUID | null, signal?: AbortSignal) => {
  const query = questionnaireId
    ? `?questionnaire=${encodeURIComponent(questionnaireId)}`
    : "";
  return request<VersionListItem[]>(
    `${FLOW_TOOL}/versions/${query}`,
    signal ? { signal } : {},
  );
};

export const fetchGraph = (versionId: UUID, signal?: AbortSignal) =>
  request<Graph>(`${version(versionId)}/graph/`, signal ? { signal } : {});

export const createDraft = (versionId: UUID, label: string, summary: string) =>
  request<ChangeRequest>(`${version(versionId)}/draft/`, {
    method: "POST",
    body: { label, summary },
  });

export const discardDraft = (versionId: UUID) =>
  request<void>(`${version(versionId)}/`, { method: "DELETE" });

export interface NewEdge {
  from_question: UUID;
  from_option: UUID | null;
  to_question: UUID | null;
}

export const addEdge = (versionId: UUID, edge: NewEdge) =>
  request<Edge>(`${version(versionId)}/edges/`, { method: "POST", body: edge });

/**
 * Retarget one end of an existing arrow.
 *
 * `changes` is deliberately a partial: `FlowToolEdgeUpdateSerializer` has
 * no defaults, so an absent key means "leave this alone" while an explicit
 * `null` is a real edit -- clearing `from_option` promotes the edge to the
 * question-level fallback, clearing `to_question` makes it end the flow.
 * Spreading a full object with undefined values here would erase that
 * distinction before it ever reached the server.
 */
export const updateEdge = (
  versionId: UUID,
  edgeId: UUID,
  changes: Partial<Pick<Edge, "from_option" | "to_question">>,
) =>
  request<Edge>(`${version(versionId)}/edges/${edgeId}/`, {
    method: "PATCH",
    body: changes,
  });

export const removeEdge = (versionId: UUID, edgeId: UUID) =>
  request<void>(`${version(versionId)}/edges/${edgeId}/`, { method: "DELETE" });

/** The whole ordering at once. There is no per-edge priority write: a
 * single-edge change is a swap, and the unique index is checked per row, so
 * a client-orchestrated swap fails halfway. */
export const reorderEdges = (versionId: UUID, questionId: UUID, edgeIds: UUID[]) =>
  request<Edge[]>(`${version(versionId)}/questions/${questionId}/edge-order/`, {
    method: "PUT",
    body: { edge_ids: edgeIds },
  });

export const submitDraft = (versionId: UUID) =>
  request<ChangeRequest>(`${version(versionId)}/submit/`, { method: "POST" });

export const withdrawDraft = (versionId: UUID) =>
  request<ChangeRequest>(`${version(versionId)}/withdraw/`, { method: "POST" });

/**
 * Give the draft back early.
 *
 * Release only, and that is the whole lock API. Nothing here *takes* the
 * lock: it is taken by the first edit and by nothing else, which is what
 * keeps spec 4.7's lock-on-first-edit from decaying into lock-on-open the
 * moment a client calls an acquire verb on mount. There is no endpoint to
 * call even if this app wanted to.
 */
export const releaseLock = (versionId: UUID) =>
  request<ChangeRequest>(`${version(versionId)}/lock/`, { method: "DELETE" });

/* ------------------------------------------------------------------ */
/* Review and publish (phase 4).                                       */
/* ------------------------------------------------------------------ */

/**
 * The diff, the summary counts and the publish check, in one call.
 *
 * A separate call from `graph/` rather than a key inside it, matching the
 * server: the map is read on every click, and diffing two whole versions
 * to answer a question nobody asked would make the common case pay for
 * the rare one.
 *
 * Gated on view access alone, so an author can read their own diff before
 * submitting. Acting on it is what needs the publish grant.
 */
export const fetchReview = (versionId: UUID, signal?: AbortSignal) =>
  request<ReviewPayload>(`${version(versionId)}/review/`, signal ? { signal } : {});

/** Clear a proposal. The note is optional: a reviewer who read the diff
 * and found nothing to say has said everything the author needs. */
export const approveDraft = (versionId: UUID, note: string) =>
  request<ChangeRequest>(`${version(versionId)}/approve/`, {
    method: "POST",
    body: { note },
  });

/** Send a proposal back. The note is *not* optional -- an approval with
 * nothing to say is complete, a rejection with nothing to say makes the
 * author guess -- and the server refuses a blank one as well. */
export const rejectDraft = (versionId: UUID, note: string) =>
  request<ChangeRequest>(`${version(versionId)}/reject/`, {
    method: "POST",
    body: { note },
  });

/**
 * Make the approved draft the live questionnaire.
 *
 * No body, deliberately: everything it needs was decided by the approval,
 * and a publish that took parameters would be a publish that could change
 * something nobody reviewed.
 */
export const publishDraft = (versionId: UUID) =>
  request<ChangeRequest>(`${version(versionId)}/publish/`, { method: "POST" });

/* ------------------------------------------------------------------ */
/* Preview (phase 6).                                                  */
/* ------------------------------------------------------------------ */

/**
 * Walk a version as a respondent would.
 *
 * Every call replays the answers so far from the entry point, so there is
 * no preview session to expire, lock, or leave pointing at a question an
 * edit has since removed. `POST` despite reading nothing: a walk deep into
 * a long questionnaire does not fit in a query string.
 *
 * Answers 409 when the graph has a cycle or a dangling target. That is the
 * feature, not a failure -- it is the crash a respondent would get, found
 * by somebody who can still fix it.
 */
export const previewWalk = (versionId: UUID, answers: PreviewAnswer[]) =>
  request<PreviewState>(`${version(versionId)}/preview/`, {
    method: "POST",
    body: { answers },
  });

/* ------------------------------------------------------------------ */
/* Content editing (phase 7).                                          */
/*                                                                     */
/* Every update body below is a partial, and omits `display_order` on   */
/* questions and options: that column carries a unique constraint, so a  */
/* single-row write to it is really a swap. The reorder verbs are that   */
/* operation, and they take the whole list. `Section.display_order` has  */
/* no such constraint, so a section may be moved directly.               */
/* ------------------------------------------------------------------ */

export interface NewSection {
  code: string;
  name: string;
  description?: string;
  /** Null means "put it last". */
  display_order?: number | null;
}

export const addSection = (versionId: UUID, section: NewSection) =>
  request<SectionRecord>(`${version(versionId)}/sections/`, {
    method: "POST",
    body: section,
  });

export const updateSection = (
  versionId: UUID,
  sectionId: UUID,
  changes: Partial<Omit<SectionRecord, "id">>,
) =>
  request<SectionRecord>(`${version(versionId)}/sections/${sectionId}/`, {
    method: "PATCH",
    body: changes,
  });

/** Hard delete, and only of an empty heading: the server refuses one that
 * still has questions filed under it rather than orphaning them. */
export const removeSection = (versionId: UUID, sectionId: UUID) =>
  request<void>(`${version(versionId)}/sections/${sectionId}/`, { method: "DELETE" });

export interface NewQuestion {
  code: string;
  prompt: string;
  answer_type: AnswerType;
  is_required?: boolean;
  section?: UUID | null;
  show_raw_answer_to_advisor?: boolean;
}

/**
 * Add a question. Nothing will ask it until an edge points at it.
 *
 * That is the model working, not an omission: under graph routing there is
 * no positional fall-through, so a new question is inert until something
 * is deliberately pointed at it -- the property that stopped an insertion
 * from silently re-routing every "continue". The next read of the map
 * reports it as unreachable, and that report is the truth.
 *
 * There is no `display_order`: it appends, because an insertion is a
 * renumbering, which is `reorderQuestions`.
 */
export const addQuestion = (versionId: UUID, question: NewQuestion) =>
  request<QuestionRecord>(`${version(versionId)}/questions/`, {
    method: "POST",
    body: question,
  });

export interface QuestionChanges {
  code?: string;
  prompt?: string;
  answer_type?: AnswerType;
  is_required?: boolean;
  section?: UUID | null;
  show_raw_answer_to_advisor?: boolean;
}

export const updateQuestion = (
  versionId: UUID,
  questionId: UUID,
  changes: QuestionChanges,
) =>
  request<QuestionRecord>(`${version(versionId)}/questions/${questionId}/`, {
    method: "PATCH",
    body: changes,
  });

/**
 * Retire a question. `DELETE` archives rather than deleting.
 *
 * Answers 200 with the archived question rather than 204: it still exists,
 * is still drawn while something points at it, and `archived_at` is the
 * fact the client needs in order to draw it that way. There is no verb to
 * bring one back -- an archival made by mistake is undone by discarding
 * the draft, which costs nothing.
 */
export const archiveQuestion = (versionId: UUID, questionId: UUID) =>
  request<QuestionRecord>(`${version(versionId)}/questions/${questionId}/`, {
    method: "DELETE",
  });

/**
 * Renumber the draft's live questions, whole-list.
 *
 * Version-scoped rather than nested under a question, because the unique
 * constraint it works around is per version. Every live question, exactly
 * once: archived ones are neither sent nor touched, and the server would
 * refuse a partial list anyway.
 *
 * Worth knowing before pressing it: the lowest-ordered live question is
 * the entry point, so reordering can change where a session starts.
 */
export const reorderQuestions = (versionId: UUID, questionIds: UUID[]) =>
  request<QuestionRecord[]>(`${version(versionId)}/question-order/`, {
    method: "PUT",
    body: { question_ids: questionIds },
  });

export interface NewOption {
  question: UUID;
  code: string;
  label: string;
}

/** The question rides in the body rather than the path, matching how an
 * edge names its `from_question`. Refused on a question whose answers
 * select nothing, where the row could only ever become a dead edge. */
export const addOption = (versionId: UUID, option: NewOption) =>
  request<QuestionOption>(`${version(versionId)}/options/`, {
    method: "POST",
    body: option,
  });

export const updateOption = (
  versionId: UUID,
  optionId: UUID,
  changes: Partial<Pick<QuestionOption, "code" | "label">>,
) =>
  request<QuestionOption>(`${version(versionId)}/options/${optionId}/`, {
    method: "PATCH",
    body: changes,
  });

/** Hard delete, and refused rather than cascading while an edge is
 * guarded by it: deleting the guard would silently un-route whatever that
 * answer led to, and the edge may leave another question entirely. */
export const removeOption = (versionId: UUID, optionId: UUID) =>
  request<void>(`${version(versionId)}/options/${optionId}/`, { method: "DELETE" });

export const reorderOptions = (versionId: UUID, questionId: UUID, optionIds: UUID[]) =>
  request<QuestionOption[]>(
    `${version(versionId)}/questions/${questionId}/option-order/`,
    {
      method: "PUT",
      body: { option_ids: optionIds },
    },
  );

/* ------------------------------------------------------------------ */
/* Product spawning (phase 10).                                        */
/* ------------------------------------------------------------------ */

/**
 * Copy a published version into a brand-new product, live immediately.
 *
 * Returns the child's version 1 -- already live, its `questionnaire`
 * naming the new product. No review round: what goes live is content
 * that already passed review on its way into the source. Every refusal
 * is a 409 -- a draft or SEQUENCE source, a `code` another questionnaire
 * already uses, or a broken edge the copy inherited from the source's
 * own graph -- `editing.spawn_product`'s checks, not duplicated here.
 */
export const spawnProduct = (versionId: UUID, name: string, code: string) =>
  request<Version>(`${version(versionId)}/spawn/`, {
    method: "POST",
    body: { name, code },
  });
