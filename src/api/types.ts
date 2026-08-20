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
  /** Which version of which other product this whole questionnaire was
   * spawned from -- the product's own lineage, not this version's. The
   * same for every version sharing a questionnaire; served here rather
   * than through a second call so the picker can draw the family tree. */
  questionnaire_spawned_from_version: UUID | null;
  name: string;
  label: string;
  /** Null for every version published before numbering existed (phase
   * 10), so nothing here may assume it exists -- show the label or the
   * name instead of inventing a number for it. */
  number: number | null;
  is_active: boolean;
  is_draft: boolean;
  routing_model: RoutingModel;
  parent_version: UUID | null;
  /** Same fact as `ChangeRequest.published_at`, served here too so a
   * version list does not have to join out to the proposal that produced
   * it just to answer "when did this go live". Null for a version with no
   * proposal (seeded/imported) or one whose proposal never published. */
  published_at: Timestamp | null;
  published_by_email: string | null;
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

export interface StaffIdentity {
  email: string;
  name: string;
  role: string | null;
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
