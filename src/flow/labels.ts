import type {
  ActivityEventType,
  AnswerType,
  ChangeRequestStatus,
  DiffChange,
  DiffKind,
  Edge,
  EditHistoryAction,
  PreviewRegion,
  Question,
  QuestionOption,
  ReviewDecision,
  UUID,
  Version,
} from "../api/types";
import { trunc } from "./graphElements";

/** Public codes never look like this; a value that does is a database id
 * that must not be shown. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Question-level (`from_option === null`) routes have no option code of
 * their own. Review copy and the node sheet still need a public id. */
export const DEFAULT_ROUTE_CODE = "default";
export const DEFAULT_ROUTE_LABEL = "Default route";

/** `(id: public-code, label: human text)` -- QID / option code / section
 * code, never a database UUID. Empty or UUID-shaped ids read as unknown
 * rather than leaking. */
export function publicCode(id: string | null | undefined): string {
  const trimmed = id?.trim() ?? "";
  return trimmed !== "" && !UUID_RE.test(trimmed) ? trimmed : "unknown";
}

/** Compact pair for review sentences. Sheets render `NamedRef` instead. */
export function idLabelPair(id: string | null | undefined, label: string): string {
  return `(id: ${publicCode(id)}, label: ${label})`;
}

export function questionIdLabel(question: Pick<Question, "code" | "prompt">): string {
  return idLabelPair(question.code, question.prompt);
}

export function optionIdLabel(option: Pick<QuestionOption, "code" | "label">): string {
  return idLabelPair(option.code, option.label);
}

export function sectionIdLabel(section: { code: string; name: string }): string {
  return idLabelPair(section.code, section.name !== "" ? section.name : section.code);
}

export function defaultRouteIdLabel(): string {
  return idLabelPair(DEFAULT_ROUTE_CODE, DEFAULT_ROUTE_LABEL);
}

/** The two people every proposal is reviewed by -- locked down, not a
 * choice `submit` offers any more. Mirrors bvi-backend's own
 * `flow_tool.editing.REQUIRED_REVIEWER_EMAILS` exactly; there is no
 * endpoint exposing this (removed along with the reviewer picker it used
 * to populate), so this is duplicated rather than fetched -- two email
 * addresses is not worth a round trip, but a change to who these two are
 * has to land in both places. */
export const REQUIRED_REVIEWER_EMAILS = [
  "boaz.salik@fischerjordan.com",
  "info@bizziegold.com",
] as const;

const ANSWER_TYPE_LABELS: Record<AnswerType, string> = {
  single_choice: "Single choice",
  multi_choice: "Multi choice",
  free_text: "Free text",
  scale: "Scale",
};

export function answerTypeLabel(type: AnswerType): string {
  return ANSWER_TYPE_LABELS[type];
}

/** "{code} · {prompt, truncated}" -- compact name for the Preview screen
 * and issue titles. Review diff sentences use the human label only. */
export function questionRefLabel(question: Question): string {
  return `${question.code} · ${trunc(question.prompt, 40)}`;
}

/** What a Changes-only preview region's banner calls it: one QID for a
 * single-question region (same as before this was regions at all), a code
 * range for a run of several -- "2 questions" alone doesn't say *which*
 * two. */
export function regionLabel(region: PreviewRegion, questions: Question[]): string {
  const first = questions.find((item) => item.id === region.question_ids[0]);
  if (region.question_ids.length === 1) {
    return first === undefined ? "this question" : `QID ${questionRefLabel(first)}`;
  }
  const last = questions.find((item) => item.id === region.question_ids.at(-1));
  const firstCode = first?.code ?? "?";
  const lastCode = last?.code ?? "?";
  return `${String(region.question_ids.length)} questions (${firstCode}–${lastCode})`;
}

/** Where an edge goes, in words. `to_question === null` is not missing
 * data -- it is the flow ending -- so it gets a name rather than a dash. */
export function targetLabel(
  edge: Edge,
  questionsById: ReadonlyMap<UUID, Question>,
): string {
  if (edge.to_question === null) return "End of flow";
  const target = questionsById.get(edge.to_question);
  if (target === undefined) return "Unknown question";
  return target.archived_at === null ? target.prompt : `${target.prompt} (archived)`;
}

/** Ported from break-backend's own `previewSubtitle` -- same four strings,
 * one per `AnswerType`. */
export function previewInstruction(answerType: AnswerType): string {
  switch (answerType) {
    case "multi_choice":
      return "Please select all that apply.";
    case "single_choice":
      return "Please select one option.";
    case "scale":
      return "Please enter a number.";
    case "free_text":
      return "Please enter your response.";
  }
}

export function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const STATUS_LABELS: Record<ChangeRequestStatus, string> = {
  open: "Open",
  submitted: "Submitted for review",
  approved: "Waiting on second reviewer",
  published: "Published",
};

export function statusLabel(status: ChangeRequestStatus): string {
  return STATUS_LABELS[status];
}

/**
 * What each state means for the person reading it, in one line.
 *
 * Written out because the status names alone hide the two facts that
 * matter most: a rejection puts the proposal back to `open` rather than
 * giving it a state of its own, and `approved` means one of two required
 * reviewers has cleared it. Publishing waits for the second approval.
 */
const STATUS_MEANINGS: Record<ChangeRequestStatus, string> = {
  open: "",
  submitted:
    "Frozen while it is read. A reviewer approves it, or sends it back to open with their reasons.",
  approved:
    "One of the two required reviewers has approved. Still frozen until the other does, which publishes it.",
  published: "Latest. This version is what respondents are now asked.",
};

export function statusMeaning(status: ChangeRequestStatus): string {
  return STATUS_MEANINGS[status];
}

export function decisionLabel(decision: ReviewDecision): string {
  return decision === "approved" ? "Approved" : "Sent back";
}

const ACTIVITY_EVENT_LABELS: Record<ActivityEventType, string> = {
  draft_opened: "Draft opened",
  draft_discarded: "Draft discarded",
  submitted: "Submitted for review",
  withdrawn: "Withdrawn",
  approved: "Approved",
  rejected: "Sent back",
  published: "Published",
  rolled_back: "Rolled back",
  section_added: "Section added",
  section_changed: "Section changed",
  section_removed: "Section removed",
  question_added: "Question added",
  question_changed: "Question changed",
  question_archived: "Question archived",
  questions_reordered: "Questions reordered",
  option_added: "Option added",
  option_changed: "Option changed",
  option_removed: "Option removed",
  options_reordered: "Options reordered",
  edge_added: "Edge added",
  edge_changed: "Edge changed",
  edge_removed: "Edge removed",
  edges_reordered: "Edges reordered",
  undone: "Edit undone",
  redone: "Edit redone",
};

export function activityEventLabel(type: ActivityEventType): string {
  return ACTIVITY_EVENT_LABELS[type];
}

/** Native-tooltip text for the Undo/Redo buttons, folding in the
 * server's own display-ready `detail` -- "Undo: Edge added: q1 (yes) ->
 * q2". Falls back to a plain sentence when there is nothing to do, which
 * is also when the button itself is disabled. */
export function editHistoryTooltip(
  verb: "Undo" | "Redo",
  action: EditHistoryAction | null,
): string {
  return action === null
    ? `Nothing to ${verb.toLowerCase()}.`
    : `${verb}: ${action.detail}`;
}

const DIFF_KIND_LABELS: Record<DiffKind, string> = {
  section: "Sections",
  question: "Questions",
  option: "Options",
  edge: "Edges",
};

export function diffKindLabel(kind: DiffKind): string {
  return DIFF_KIND_LABELS[kind];
}

const DIFF_CHANGE_LABELS: Record<DiffChange, string> = {
  added: "Added",
  removed: "Removed",
  changed: "Changed",
};

export function diffChangeLabel(change: DiffChange): string {
  return DIFF_CHANGE_LABELS[change];
}

/**
 * A diffed field name, as a person would say it.
 *
 * Falls back to the raw key rather than to a blank: `diffing` renders
 * whatever fields the two sides differ on, and a name this map has not
 * caught up with is still more use than nothing.
 */
const FIELD_LABELS: Record<string, string> = {
  code: "Code",
  name: "Name",
  description: "Description",
  display_order: "Order",
  prompt: "Prompt",
  answer_type: "Answer type",
  is_required: "Required",
  section: "Section",
  archived: "Archived",
  archived_at: "Archived",
  label: "Label",
  guard: "Answer",
  target: "Goes to",
  to: "Goes to",
  to_question: "Goes to",
  subtext: "Subtext",
  show_raw_answer_to_advisor: "Show raw answer to advisor",
  priority: "Priority",
  from_option: "Answer",
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/** A diffed value, rendered. `null` is "not set" rather than a blank cell,
 * and a boolean reads as a word: a bare `false` next to `true` is the one
 * pair a reviewer is most likely to skim past. */
export function diffValue(value: string | number | boolean | null): string {
  if (value === null) return "not set";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (value === "") return "empty";
  return String(value);
}

/** A version, as the picker and every banner name it. `number` is
 * backend-only (phase 10's per-product sequence, never served to a
 * client) -- this is the label, or the questionnaire's own `name` when
 * there is no label either. */
export function versionLabel(version: Version): string {
  return version.label || version.name;
}
