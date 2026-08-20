/**
 * Mirrors of `bvi_backend/questionnaires/api/flow_tool/serializers.py`.
 *
 * Hand-written rather than generated from the OpenAPI schema, because the
 * graph endpoint composes its payload in the view (`FlowToolGraphView.get`)
 * rather than through a single serializer, so drf-spectacular does not
 * describe the response accurately. These types are the contract; the
 * fixtures in `src/test/fixtures.ts` are built from real response bodies so
 * a drift between the two shows up as a failing test rather than as an
 * `undefined` on the canvas.
 */

export type UUID = string;
/** ISO-8601, as DRF renders `DateTimeField`. */
export type Timestamp = string;

export type RoutingModel = "sequence" | "graph";
export type AnswerType = "single_choice" | "multi_choice" | "free_text" | "scale";
/**
 * Where a proposal sits. Mirrors `ChangeRequestStatus` in
 * `questionnaires/models.py`, including its deliberate omission: there is
 * no `rejected`. A rejection returns the proposal to `open`, because what
 * it leaves behind is a proposal its author can work on -- the reviewer's
 * reasons are kept on the `ChangeRequestReview` row instead, where a
 * resubmission cannot overwrite them.
 */
export type ChangeRequestStatus = "open" | "submitted" | "approved" | "published";

/** What a reviewer said. Not a status -- see `ChangeRequestStatus`. */
export type ReviewDecision = "approved" | "rejected";

/** The answer types whose answers select options, so the only ones a
 * per-option edge guard can match on. Mirrors `CHOICE_ANSWER_TYPES` in
 * `questionnaires/models.py`; used only to explain a dead edge in the UI,
 * never to decide whether an edit is allowed -- that is the server's. */
export const CHOICE_ANSWER_TYPES: ReadonlySet<AnswerType> = new Set<AnswerType>([
  "single_choice",
  "multi_choice",
]);

export interface Version {
  id: UUID;
  /** The product this version belongs to. Several questionnaires share one
   * deployment, so "the active version" is scoped to this rather than
   * being table-wide. */
  questionnaire: UUID;
  questionnaire_name: string;
  name: string;
  label: string;
  is_active: boolean;
  is_draft: boolean;
  routing_model: RoutingModel;
  parent_version: UUID | null;
  /**
   * True when publishing this draft would now be refused.
   *
   * Computed by the server through `editing.active_sibling` -- the same
   * function the refusal itself reads -- because two implementations of
   * one rule drift. It means somebody published underneath this sandbox:
   * the version it was copied from is no longer the live one, so
   * publishing would silently reinstate everything that landed in
   * between. Always false for anything that is not a draft.
   */
  is_stale: boolean;
  /**
   * When this version went live, and who pressed the button.
   *
   * Both live on the `ChangeRequest` rather than on the version --
   * publishing is something that happened to a proposal -- and the server
   * joins them through the reverse one-to-one so no client has to. Null
   * for a seeded or imported version, which has no proposal and never had
   * one: those appeared rather than being published, and the release list
   * says so instead of inventing a date.
   */
  published_at: Timestamp | null;
  published_by_email: string | null;
  created: Timestamp;
  modified: Timestamp;
}

export interface VersionListItem extends Version {
  question_count: number;
}

/**
 * A heading, as the write verbs echo one back.
 *
 * Split from `Section` because `live_question_count` is an annotation the
 * graph view computes over the whole payload: a section just created or
 * renamed has no such count to hand, and `FlowToolSectionDetailSerializer`
 * does not invent one.
 */
export interface SectionRecord {
  id: UUID;
  code: string;
  name: string;
  description: string;
  display_order: number;
}

export interface Section extends SectionRecord {
  live_question_count: number;
}

export interface QuestionOption {
  id: UUID;
  code: string;
  label: string;
  display_order: number;
}

/**
 * One question's routing behaviour, as the server computed it.
 *
 * Null for an archived question. That is not missing data: the resolver
 * never serves an archived question, so it has no behaviour to describe,
 * and calling it "terminal" would invent a fact. The UI renders such a node
 * as a placeholder and says why.
 */
export interface QuestionDiagnostics {
  is_entry: boolean;
  is_reachable: boolean;
  is_decision_point: boolean;
  is_terminal: boolean;
  destination_question_ids: UUID[];
  uncovered_option_ids: UUID[];
  dead_edge_ids: UUID[];
  broken_edge_ids: UUID[];
}

/**
 * A question as the content verbs echo one back: no diagnostics.
 *
 * `FlowToolQuestionSerializer` carries no audit of its own -- the graph
 * view attaches one after serializing. So a PATCH, an archive or a reorder
 * answers with this shape, and the diagnostics arrive on the refetch that
 * every write triggers. Typed apart rather than made optional, so nothing
 * can read `diagnostics` off a write response and find `undefined` where
 * "archived, so it has no behaviour" was meant.
 */
export interface QuestionRecord {
  id: UUID;
  code: string;
  prompt: string;
  answer_type: AnswerType;
  is_required: boolean;
  display_order: number;
  section: UUID | null;
  archived_at: Timestamp | null;
  options: QuestionOption[];
}

export interface Question extends QuestionRecord {
  diagnostics: QuestionDiagnostics | null;
}

/**
 * One arrow.
 *
 * `from_option === null` is the question-level edge, which matches any
 * answer; `to_question === null` ends the flow. Those are the same two
 * meanings `routing.matches` reads, and the UI must render both rather than
 * treating a null as absent data.
 */
export interface Edge {
  id: UUID;
  from_question: UUID;
  from_option: UUID | null;
  to_question: UUID | null;
  priority: number;
}

export interface Lock {
  user_id: UUID;
  email: string;
  since: Timestamp;
}

/**
 * One reviewer's verdict on one submission of a proposal.
 *
 * Append-only, hence no `modified`: a rejected proposal is edited and
 * resubmitted, and a verdict column on `ChangeRequest` would be
 * overwritten by the next round -- losing the reasons the author was
 * asked to change something, which is the only part of a rejection worth
 * keeping.
 */
export interface ChangeRequestReview {
  id: UUID;
  reviewer: UUID;
  reviewer_email: string;
  decision: ReviewDecision;
  note: string;
  created: Timestamp;
}

export interface ChangeRequest {
  id: UUID;
  draft_version: UUID;
  created_by: UUID;
  created_by_email: string;
  summary: string;
  status: ChangeRequestStatus;
  submitted_at: Timestamp | null;
  published_at: Timestamp | null;
  /**
   * Who published it -- a third name beside the author and the reviewer,
   * and all three can differ.
   *
   * A column rather than a row of its own, unlike `reviews`: reviewing
   * repeats -- reject, edit, resubmit, review again -- and publishing does
   * not, because `published` is terminal.
   */
  published_by: UUID | null;
  published_by_email: string | null;
  /** Null when unheld *or* when the held lock has gone idle -- the server
   * decides which, through `editing.lock_holder`, so the banner and the
   * next write agree about whether somebody is really in there. */
  lock: Lock | null;
  /** Every round, newest first. A proposal rejected twice for the same
   * reason and submitted a third time is the case this exists for, and it
   * is unreadable from a single most-recent verdict. */
  reviews: ChangeRequestReview[];
  created: Timestamp;
  modified: Timestamp;
}

export interface GraphDiagnostics {
  entry_question_id: UUID | null;
  decision_point_question_ids: UUID[];
  terminal_question_ids: UUID[];
  unreachable_question_ids: UUID[];
  uncovered_option_question_ids: UUID[];
  back_edge_ids: UUID[];
  dead_edge_ids: UUID[];
  broken_edge_ids: UUID[];
}

export interface Graph {
  version: Version;
  /** Null for anything that is not a draft, so this doubles as "is this
   * version editable at all". */
  change_request: ChangeRequest | null;
  sections: Section[];
  questions: Question[];
  edges: Edge[];
  diagnostics: GraphDiagnostics;
}

/**
 * The three per-user grants this tool is gated on.
 *
 * Deliberately independent of any role: `seed_roles` subtracts the set
 * from every role grant, so an account can be a full administrator
 * everywhere else and still hold none of these. They are read from
 * `GET staff/auth/session/`, which computes them through `granted_codes`
 * -- the same function every server-side check reads.
 */
export const VIEW_FLOW_TOOL = "view_flow_tool";
export const EDIT_FLOW_TOOL = "edit_flow_tool";
export const PUBLISH_FLOW_TOOL = "publish_flow_tool";

/**
 * Who is signed in, and what the server will let them do.
 *
 * `permission_codes` is a **rendering hint and never a gate**: every view
 * on the server still checks, and this app reads the list only to decide
 * whether to draw a control. Serving it from `granted_codes` is what stops
 * the hint and the answer from drifting -- but a grant revoked mid-session
 * is still discovered by a refusal, which is why the write paths refetch
 * this on a 403.
 */
export interface StaffIdentity {
  email: string;
  name: string;
  role: string | null;
  permission_codes: string[];
}

/* ------------------------------------------------------------------ */
/* Review (phase 4): what a proposal proposes, against what it copied. */
/* ------------------------------------------------------------------ */

/** Mirrors `diffing.ADDED` / `REMOVED` / `CHANGED`. */
export type DiffChange = "added" | "removed" | "changed";
/** Mirrors `diffing.SECTION` / `QUESTION` / `OPTION` / `EDGE`. */
export type DiffKind = "section" | "question" | "option" | "edge";

/**
 * One field that differs, with both sides already rendered by the server.
 *
 * A section's code rather than its id, a target question's code rather
 * than its id -- so this screen can show the pair without holding both
 * whole versions to look anything up.
 */
export interface FieldChange {
  field: string;
  base: string | number | boolean | null;
  draft: string | number | boolean | null;
}

/**
 * One section, question, option or edge that this proposal touches.
 *
 * Matched between the two versions **by code, never by id**: a draft is a
 * whole copy, so an id comparison would report the entire questionnaire as
 * removed and re-added. `question_id` is the draft-side question the
 * change hangs off, so a row can highlight its node on the map without
 * parsing `key`.
 */
export interface ItemDiff {
  kind: DiffKind;
  key: string;
  change: DiffChange;
  base_id: UUID | null;
  draft_id: UUID | null;
  question_id: UUID | null;
  fields: FieldChange[];
}

export interface VersionDiff {
  /** True when the draft still says exactly what its source said. Worth
   * stating plainly: an empty list of changes otherwise reads as "the diff
   * failed to load". */
  is_empty: boolean;
  sections: ItemDiff[];
  questions: ItemDiff[];
  options: ItemDiff[];
  edges: ItemDiff[];
}

export interface DiffCounts {
  added: number;
  removed: number;
  changed: number;
}

export interface ReviewPayload {
  version: Version;
  /** The version this draft was copied from. Null on a draft with no
   * parent, which is the first version of a new questionnaire. */
  base_version: Version | null;
  /**
   * What is live now, served only when it is *not* what this draft was
   * copied from.
   *
   * `version.is_stale` says whether publishing would be refused; this says
   * against what, which is the version `compare/` has to be opened with.
   * A reviewer who clears a stale proposal and finds out at publish has
   * spent the one trip through a second person the workflow is built
   * around, so it rides along with the diff for the same reason
   * `publish_blocker` does.
   */
  stale_against: Version | null;
  change_request: ChangeRequest | null;
  diff: VersionDiff;
  summary: DiffCounts;
  /**
   * Why this could not be activated right now, or null if it could.
   *
   * The same check `publish` runs, asked in advance through
   * `routing.validate_edges`, so a reviewer finds out while reading the
   * diff rather than after approving something that then refuses to go
   * live.
   */
  publish_blocker: string | null;
}

/* ------------------------------------------------------------------ */
/* Preview (phase 6): walk a version as a respondent would.            */
/* ------------------------------------------------------------------ */

/**
 * One question already answered in a preview walk.
 *
 * An empty `option_ids` is a real answer, not a missing one: it is what a
 * free-text or scale question contributes, and the resolver treats it as
 * an answer that matches only the question-level edge. A question left out
 * of the list entirely is the unanswered one the walk stops at.
 */
export interface PreviewAnswer {
  question_id: UUID;
  option_ids: UUID[];
}

export interface PreviewState {
  /** Null once the walk is over. Carries its own options, so nothing here
   * has to be joined against the map. */
  next_question: QuestionRecord | null;
  is_complete: boolean;
  answered_count: number;
  /** The reachability denominator -- questions reachable from the entry
   * point, not every question in the version. */
  total_count: number;
}

/* ------------------------------------------------------------------ */
/* Compare (phase 9): any two versions, side by side.                  */
/* ------------------------------------------------------------------ */

/**
 * The answer to "what does this version say that that one does not".
 *
 * The same shape the review screen already renders, because it is the same
 * function on the server: `diffing.compare` with the base named explicitly
 * instead of derived from `parent_version`. It carries no
 * `publish_blocker` and no change request -- comparing is a question about
 * two versions, not about a proposal, and either side may be a published
 * version with no proposal at all.
 *
 * The two versions need not share a questionnaire: matching is by code
 * throughout, so comparing one product against another is a meaningful
 * question, and it is the one somebody standing a second product up asks.
 */
export interface ComparePayload {
  version: Version;
  base_version: Version;
  diff: VersionDiff;
  summary: DiffCounts;
}

/* ------------------------------------------------------------------ */
/* History and snapshots (phase 5).                                    */
/* ------------------------------------------------------------------ */

/**
 * One page of a list the server paginates.
 *
 * `proposals/` and `history/` are paginated where `versions/` is not, and
 * for the opposite reason: versions are created by publishing and number
 * in the tens, while an activity row is written by every single edit.
 */
export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/**
 * Every kind of line the trail can hold. Mirrors
 * `audit.QuestionnaireActivityEventType`.
 *
 * Two groups, and the split is the point. The first eight are a proposal's
 * lifecycle, and two of them -- `published` and `rolled_back` -- are the
 * only entries in the whole table that change what a respondent is asked.
 * The remaining fifteen are the edits inside a proposal: they exist
 * because a proposal has one author and more than one person can edit it,
 * since the lock hands over once idle and a rejected proposal reopens for
 * anybody holding the edit code.
 */
export type ActivityEventType =
  | "draft_opened"
  | "draft_discarded"
  | "submitted"
  | "withdrawn"
  | "approved"
  | "rejected"
  | "published"
  | "rolled_back"
  | "section_added"
  | "section_changed"
  | "section_removed"
  | "question_added"
  | "question_changed"
  | "question_archived"
  | "questions_reordered"
  | "option_added"
  | "option_changed"
  | "option_removed"
  | "options_reordered"
  | "edge_added"
  | "edge_changed"
  | "edge_removed"
  | "edges_reordered";

/**
 * One line of the trail: who did what, to which version, when.
 *
 * `version_id` and `change_request_id` are plain UUIDs with no object
 * behind them, deliberately: both point into the draft world, which is
 * hard-deleted, so a foreign key would either block discarding a draft or
 * delete the history of the proposal somebody threw away -- which is the
 * proposal whose history is most worth having. `version_name` is
 * snapshotted beside the id so a discarded version still has a name here.
 *
 * `detail` is one rendered line in the same codes the diff screen uses
 * ("q1 (yes) -> q9 (was q1 (yes) -> q2)"), so the trail and a review
 * name the same arrow the same way. Empty for an event whose type already
 * says everything.
 */
export interface ActivityEvent {
  id: UUID;
  questionnaire: UUID;
  version_id: UUID;
  version_name: string;
  change_request_id: UUID | null;
  actor_user: UUID;
  actor_email: string;
  event_type: ActivityEventType;
  detail: string;
  changes: Record<string, unknown>;
  occurred_at: Timestamp;
}

/**
 * A proposal in the list of every proposal ever opened.
 *
 * Carries its draft version inline, unlike the payload the write verbs
 * echo back: this list is read on its own, with no map beside it, so a row
 * naming its version by id alone would need a call per row to be readable.
 *
 * Discarded proposals are absent, because they were deleted. What survives
 * one is the `draft_discarded` line in the trail, which is exactly why
 * that trail holds no foreign keys into this table.
 */
export interface Proposal extends ChangeRequest {
  version: Version;
}
