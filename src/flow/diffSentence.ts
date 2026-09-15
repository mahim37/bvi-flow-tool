import type { Graph, ItemDiff, Question, QuestionOption, UUID } from "../api/types";
import { DEFAULT_ROUTE_LABEL } from "./labels";

export type DiffPiece =
  | { type: "text"; text: string }
  | { type: "ref"; prefix: string; label: string; questionId: UUID | null };

function questionById(graph: Graph, id: UUID | null): Question | undefined {
  if (id === null) return undefined;
  return graph.questions.find((question) => question.id === id);
}

function findOption(
  graph: Graph,
  id: UUID | null,
): { option: QuestionOption; question: Question } | undefined {
  if (id === null) return undefined;
  for (const question of graph.questions) {
    const option = question.options.find((candidate) => candidate.id === id);
    if (option !== undefined) return { option, question };
  }
  return undefined;
}

function itemUuid(item: ItemDiff): UUID | null {
  return item.change === "removed" ? item.base_id : (item.draft_id ?? item.base_id);
}

function promptOf(graph: Graph, uuid: UUID | null): string | null {
  const question = questionById(graph, uuid);
  return question === undefined ? null : question.prompt;
}

function edgeLabel(
  graph: Graph,
  fromQuestion: UUID,
  fromOption: UUID | null,
): string {
  if (fromOption === null) return DEFAULT_ROUTE_LABEL;
  const option =
    questionById(graph, fromQuestion)?.options.find(
      (candidate) => candidate.id === fromOption,
    ) ?? findOption(graph, fromOption)?.option;
  return option?.label ?? "Unknown option";
}

function changeVerb(change: ItemDiff["change"]): string {
  if (change === "added") return "Added";
  if (change === "removed") return "Removed";
  return "Changed";
}

function kindWord(kind: ItemDiff["kind"]): string {
  if (kind === "edge") return "edge";
  if (kind === "option") return "option";
  if (kind === "section") return "section";
  return "question";
}

function ref(prefix: string, label: string, questionId: UUID | null): DiffPiece {
  return { type: "ref", prefix, label, questionId };
}

function text(value: string): DiffPiece {
  return { type: "text", text: value };
}

/** Structured review row: human labels only, each question a separate ref. */
export function diffPieces(item: ItemDiff, graph: Graph): DiffPiece[] {
  const verb = changeVerb(item.change);
  const uuid = itemUuid(item);
  const lead = `${verb} ${kindWord(item.kind)} `;

  switch (item.kind) {
    case "question": {
      const questionId = uuid ?? item.question_id;
      const prompt = promptOf(graph, questionId);
      if (prompt === null) return [text(`${verb} ${kindWord(item.kind)}`)];
      return [ref(lead, prompt, questionId)];
    }
    case "option": {
      const found = findOption(graph, uuid);
      const parentId = found?.question.id ?? item.question_id;
      const parentPrompt = promptOf(graph, parentId);
      const optionLabel = found?.option.label;
      const pieces: DiffPiece[] = [];
      if (optionLabel !== undefined) {
        pieces.push(ref(lead, optionLabel, parentId));
      } else {
        pieces.push(text(`${verb} ${kindWord(item.kind)}`));
      }
      if (parentPrompt !== null && parentId !== null) {
        pieces.push(text(" on "), ref("", parentPrompt, parentId));
      }
      return pieces;
    }
    case "edge": {
      const edge = graph.edges.find((candidate) => candidate.id === uuid);
      const fromId = edge?.from_question ?? item.question_id;
      const fromPrompt = promptOf(graph, fromId);
      const pieces: DiffPiece[] = [];
      if (edge !== undefined) {
        pieces.push(ref(lead, edgeLabel(graph, edge.from_question, edge.from_option), fromId));
      } else {
        pieces.push(text(`${verb} ${kindWord(item.kind)}`));
      }
      if (fromPrompt !== null && fromId !== null) {
        pieces.push(text(" from "), ref("", fromPrompt, fromId));
      }
      if (edge !== undefined) {
        pieces.push(text(" to "));
        if (edge.to_question === null) {
          pieces.push(text("End of flow"));
        } else {
          const destPrompt = promptOf(graph, edge.to_question);
          if (destPrompt === null) pieces.push(text("question"));
          else pieces.push(ref("", destPrompt, edge.to_question));
        }
      }
      return pieces;
    }
    case "section": {
      const section =
        uuid === null
          ? undefined
          : graph.sections.find((candidate) => candidate.id === uuid);
      const name =
        section === undefined
          ? null
          : section.name !== ""
            ? section.name
            : section.code;
      if (name === null) return [text(`${verb} ${kindWord(item.kind)}`)];
      return [ref(lead, name, null)];
    }
  }
}

export function diffSentence(item: ItemDiff, graph: Graph): string {
  return diffPieces(item, graph)
    .map((piece) =>
      piece.type === "text" ? piece.text : `${piece.prefix}${piece.label}`,
    )
    .join("");
}
