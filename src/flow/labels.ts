import type { AnswerType, Edge, Question, UUID } from "../api/types";

const ANSWER_TYPE_LABELS: Record<AnswerType, string> = {
  single_choice: "Single choice",
  multi_choice: "Multi choice",
  free_text: "Free text",
  scale: "Scale",
};

export function answerTypeLabel(type: AnswerType): string {
  return ANSWER_TYPE_LABELS[type];
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
  return target.archived_at === null ? target.code : `${target.code} (archived)`;
}

export function optionLabel(
  question: Question | undefined,
  optionId: UUID | null,
): string {
  if (optionId === null) return "Any answer";
  const option = question?.options.find((candidate) => candidate.id === optionId);
  return option ? option.label : "Unknown option";
}

export function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
