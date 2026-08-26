import { request } from "./client";
import type {
  ActivityEvent,
  ActivityEventType,
  AnswerType,
  ChangeRequest,
  ChangeRequestStatus,
  ComparePayload,
  Edge,
  Graph,
  Paginated,
  PreviewAnswer,
  PreviewPath,
  PreviewState,
  Proposal,
  QuestionOption,
  QuestionRecord,
  ReviewPayload,
  Reviewer,
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
 * Who is signed in, and what they may do.
 *
 * The call that replaced this app's two workarounds: identity is asked for
 * rather than remembered in `localStorage`, and edit access is read off
 * `permission_codes` rather than discovered by having a write refused --
 * which was visible in the UI as a viewer being offered buttons that then
 * errored.
 *
 * A refusal here is a meaningful answer rather than a failure: it is how
 * this app learns there is no usable session. Note that it is a **403, not
 * a 401** -- DRF downgrades `NotAuthenticated` when no authenticator
 * implements `authenticate_header`, and `StaffSessionAuthentication` does
 * not -- so the bootstrap treats both as "not signed in".
 */
export const fetchSession = (signal?: AbortSignal) =>
  request<StaffIdentity>(`${STAFF_AUTH}/session/`, signal ? { signal } : {});

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
  /** Omitted, almost always -- the server appends a new edge last by
   * default, which is always right for a question-level edge. The one
   * caller that sets this (`MapView`'s add-route pick) does so only to
   * land a per-option edge above an already-existing question-level one,
   * using a priority number lower than any this question already has --
   * still fully re-validated server-side, same as every other write. */
  priority?: number;
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

/** Everyone eligible to be named a reviewer: holds `publish_flow_tool`.
 * Gated on view access alone, so the picker can be populated before a
 * proposal is submitted -- `editing.submit` is the real gate, this list
 * just exists so a client does not have to guess who would pass it. */
export const listReviewers = (signal?: AbortSignal) =>
  request<Reviewer[]>(`${FLOW_TOOL}/reviewers/`, signal ? { signal } : {});

/** Two distinct people, neither the author, both holding the publish
 * grant -- `editing.submit` refuses anything else. See `listReviewers`. */
export const submitDraft = (versionId: UUID, reviewer1Id: UUID, reviewer2Id: UUID) =>
  request<ChangeRequest>(`${version(versionId)}/submit/`, {
    method: "POST",
    body: { reviewer_1: reviewer1Id, reviewer_2: reviewer2Id },
  });

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

/**
 * One valid route from the entry point to `questionId`.
 *
 * `GET`, unlike `previewWalk` above: nothing is posted, this only asks
 * how a respondent would even reach this question. 404s if the question
 * isn't reachable from the entry point at all -- there is no route to
 * hand back.
 */
export const previewPathTo = (
  versionId: UUID,
  questionId: UUID,
  signal?: AbortSignal,
) =>
  request<PreviewPath>(
    `${version(versionId)}/preview/path-to/${questionId}/`,
    signal ? { signal } : {},
  );

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
/* Compare (phase 9).                                                  */
/* ------------------------------------------------------------------ */

/**
 * Two versions, side by side.
 *
 * Reads as "what does `versionId` say that `baseId` does not", which is
 * the same sentence the review screen asks about a draft and its parent --
 * and it is the same server function with the base named instead of
 * derived. The base is a query parameter rather than a second path
 * segment because the pair is unordered as a resource: there is no object
 * at `versions/a/compare/b/` that `versions/b/compare/a/` is not also
 * addressing.
 *
 * Answers 409 if either side is a sequence-routed version, for the same
 * reason `graph/` does: there are no edges to compare.
 */
export const fetchCompare = (versionId: UUID, baseId: UUID, signal?: AbortSignal) =>
  request<ComparePayload>(
    `${version(versionId)}/compare/?base=${encodeURIComponent(baseId)}`,
    signal ? { signal } : {},
  );

/* ------------------------------------------------------------------ */
/* History and snapshots (phase 5).                                    */
/*                                                                     */
/* Both lists sit at the top level rather than under a version, which   */
/* is the whole point of the trail's plain-UUID columns: a proposal     */
/* outlives its draft and the trail outlives the version it describes,  */
/* so addressing either through a version would make the interesting    */
/* rows -- the discarded ones -- unreachable.                           */
/* ------------------------------------------------------------------ */

function query(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const rendered = search.toString();
  return rendered === "" ? "" : `?${rendered}`;
}

export interface ProposalFilters {
  questionnaire?: UUID | null;
  status?: ChangeRequestStatus | null;
  page?: number;
}

/** Every proposal ever opened, newest first, including the published
 * ones: a `ChangeRequest` outlives the editing it was opened for, and the
 * row is the history of that change with every review round attached. */
export const listProposals = (filters: ProposalFilters = {}, signal?: AbortSignal) =>
  request<Paginated<Proposal>>(
    `${FLOW_TOOL}/proposals/${query({
      questionnaire: filters.questionnaire,
      status: filters.status,
      page: filters.page,
    })}`,
    signal ? { signal } : {},
  );

export interface HistoryFilters {
  questionnaire?: UUID | null;
  /** Narrows to one version, including one that has since been discarded
   * -- the column is a plain UUID, so this is a legitimate query about a
   * deleted thing rather than a 404. */
  version?: UUID | null;
  change_request?: UUID | null;
  event_type?: ActivityEventType | null;
  /** An email address, matched exactly, as the server does. */
  actor?: string | null;
  page?: number;
  page_size?: number;
}

/**
 * The trail: what happened, by whom, and when.
 *
 * The same `audit.QuestionnaireActivityEvent` rows the compliance log
 * serves, read through the flow tool's own permission rather than
 * `view_audit_log`. Two surfaces over one table, deliberately -- a
 * history screen that computed its own answer from `ChangeRequest`
 * timestamps would eventually disagree with the audit export, and a
 * compliance review is the worst place to find that out.
 */
export const listHistory = (filters: HistoryFilters = {}, signal?: AbortSignal) =>
  request<Paginated<ActivityEvent>>(
    `${FLOW_TOOL}/history/${query({
      questionnaire: filters.questionnaire,
      version: filters.version,
      change_request: filters.change_request,
      event_type: filters.event_type,
      actor: filters.actor,
      page: filters.page,
      page_size: filters.page_size,
    })}`,
    signal ? { signal } : {},
  );

/**
 * Put an earlier version back in front of respondents.
 *
 * A separate verb from `publish/` rather than a second method on it,
 * because the two take different things: `publish/` names a draft and
 * needs an approval, this names a published version and needs none. What
 * it activates has already been through a review, because it was live
 * before -- and requiring a fresh one to *undo* a change would make the
 * tool slowest exactly when speed matters, which is the minute after a bad
 * publish.
 *
 * Refuses a draft (that is what `publish/` is for, and it is where the
 * review gate lives) and the version already live, both with 409. It takes
 * effect immediately: nothing downstream asks again.
 */
export const activateVersion = (versionId: UUID) =>
  request<Version>(`${version(versionId)}/activate/`, { method: "POST" });
