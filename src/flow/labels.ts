import type {
  ActivityEventType,
  AnswerType,
  ChangeRequestStatus,
  DiffChange,
  DiffKind,
  Edge,
  Question,
  ReviewDecision,
  UUID,
  Version,
} from "../api/types";
import { trunc } from "./graphElements";

const ANSWER_TYPE_LABELS: Record<AnswerType, string> = {
  single_choice: "Single choice",
  multi_choice: "Multi choice",
  free_text: "Free text",
  scale: "Scale",
};

export function answerTypeLabel(type: AnswerType): string {
  return ANSWER_TYPE_LABELS[type];
}

/** "{code} · {prompt, truncated}" -- the code alone ("Q2") means little
 * without opening that question, so anywhere a question is named away
 * from its own card (a route's destination, an incoming source) gets the
 * prompt alongside it too, same idea as the canvas's own node labels
 * (`graphElements.ts`). */
function questionRefLabel(question: Question): string {
  return `${question.code} · ${trunc(question.prompt, 40)}`;
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
  const name = questionRefLabel(target);
  return target.archived_at === null ? name : `${name} (archived)`;
}

/** The question a "Reached from" row points at. */
export function sourceLabel(question: Question | undefined): string {
  return question === undefined ? "Unknown question" : questionRefLabel(question);
}

export function optionLabel(
  question: Question | undefined,
  optionId: UUID | null,
): string {
  // Matches `Options.tsx`'s "Default route" section -- the question-level
  // route (`from_option === null`) that any answer without one of its own
  // uses. Capitalized so it also reads naturally lowercased inline
  // ("when the default route").
  if (optionId === null) return "The default route";
  const option = question?.options.find((candidate) => candidate.id === optionId);
  return option ? option.label : "Unknown option";
}

/** The instruction shown above a preview question's answers -- ported
 * from break-backend's own preview-walkthrough copy. Takes `isMulti`
 * rather than the full `AnswerType`: a free-text/scale answer selects no
 * option at all, and `PreviewView` explains that separately instead of
 * misusing this for something it doesn't do. */
export function previewInstruction(isMulti: boolean): string {
  return isMulti ? "Please select all that apply." : "Please select one option.";
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
  approved: "Approved, ready to publish",
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
 * giving it a state of its own, and `approved` is frozen -- cleared, but
 * still not live until somebody publishes it.
 */
const STATUS_MEANINGS: Record<ChangeRequestStatus, string> = {
  open: "Editable. Submit it when it is ready for somebody else to read.",
  submitted:
    "Frozen while it is read. A reviewer approves it, or sends it back to open with their reasons.",
  approved:
    "Cleared by a reviewer and still frozen. Publishing is what makes it the live questionnaire.",
  published: "Live. This version is what respondents are now asked.",
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
};

export function activityEventLabel(type: ActivityEventType): string {
  return ACTIVITY_EVENT_LABELS[type];
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
  guard: "Guard",
  target: "Goes to",
  to_question: "Goes to",
  priority: "Priority",
  from_option: "Guard",
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

/** A version, as the picker and every banner name it. `number` is the
 * per-product sequence (phase 10) and leads whenever it exists, with
 * `label` -- the checkpoint name somebody chose -- kept alongside it
 * rather than dropped. Null for every version published before
 * numbering existed, so those fall back to the label, or the
 * questionnaire's own `name` when there is no label either. */
export function versionLabel(version: Version): string {
  // `== null` catches both: a version predating numbering serializes
  // `number` as an explicit JSON `null`, but a backend that has not yet
  // deployed the field at all omits the key, which reads as `undefined`
  // here -- `types.ts` promises `number | null` and cannot promise which
  // of those two absences a live deployment actually sends.
  if (version.number == null) return version.label || version.name;
  return version.label ? `v${version.number} — ${version.label}` : `v${version.number}`;
}
