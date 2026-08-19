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
export type ChangeRequestStatus = "open" | "submitted";

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
  name: string;
  label: string;
  is_active: boolean;
  is_draft: boolean;
  routing_model: RoutingModel;
  parent_version: UUID | null;
  created: Timestamp;
  modified: Timestamp;
}

export interface VersionListItem extends Version {
  question_count: number;
}

export interface Section {
  id: UUID;
  code: string;
  name: string;
  description: string;
  display_order: number;
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

export interface Question {
  id: UUID;
  code: string;
  prompt: string;
  answer_type: AnswerType;
  is_required: boolean;
  display_order: number;
  section: UUID | null;
  archived_at: Timestamp | null;
  options: QuestionOption[];
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

export interface ChangeRequest {
  id: UUID;
  draft_version: UUID;
  created_by: UUID;
  created_by_email: string;
  summary: string;
  status: ChangeRequestStatus;
  submitted_at: Timestamp | null;
  /** Null when unheld *or* when the held lock has gone idle -- the server
   * decides which, through `editing.lock_holder`, so the banner and the
   * next write agree about whether somebody is really in there. */
  lock: Lock | null;
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
