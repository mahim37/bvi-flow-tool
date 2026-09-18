import type { DiffChange, Graph, ItemDiff, Question, UUID } from "../api/types";
import {
  effectiveChange,
  findEdge,
  findOption,
  findQuestion,
  findSection,
  locate,
} from "./diffItem";

export type DiffPiece =
  | { type: "text"; text: string }
  | {
      type: "ref";
      prefix: string;
      label: string;
      questionId: UUID | null;
      quoted?: boolean;
    };

function edgeOptionLabel(
  graph: Graph,
  fromQuestion: UUID,
  fromOption: UUID | null,
): string | null {
  if (fromOption === null) return null;
  const option =
    findQuestion(graph, fromQuestion)?.options.find(
      (candidate) => candidate.id === fromOption,
    ) ?? findOption(graph, fromOption)?.option;
  return option?.label ?? "Unknown option";
}

function changeVerb(change: DiffChange): string {
  if (change === "added") return "Added";
  if (change === "removed") return "Removed";
  return "Changed";
}

function kindWord(kind: ItemDiff["kind"]): string {
  if (kind === "edge") return "connection";
  if (kind === "option") return "option";
  if (kind === "section") return "section";
  return "question";
}

function ref(
  prefix: string,
  label: string,
  questionId: UUID | null,
  quoted = false,
): DiffPiece {
  return quoted
    ? { type: "ref", prefix, label, questionId, quoted: true }
    : { type: "ref", prefix, label, questionId };
}

function text(value: string): DiffPiece {
  return { type: "text", text: value };
}

function questionRef(label: string, questionId: UUID | null): DiffPiece {
  return ref("Question ", label, questionId, true);
}

/** The draft-side question a row hangs off (`diffing.ItemDiff.question_id`),
 * if the draft graph still draws it. It is the right id for the map, but
 * `graph/` does not serve an archived question nothing points at, so a
 * link is offered only when there is a node to land on. */
function mapNode(graph: Graph, questionId: UUID | null): Question | undefined {
  return questionId === null ? undefined : findQuestion(graph, questionId);
}

/**
 * Structured review row: human labels only, each question a separate ref.
 *
 * Quoted values are the actual prompts / option labels. Edges read as
 * "connection"; a question-level fallback never says "default".
 *
 * `baseGraph` is the version the diff was taken against. Without it a
 * removed item, or a retired question the draft graph no longer serves,
 * can only be described by its kind.
 */
export function diffPieces(
  item: ItemDiff,
  graph: Graph,
  baseGraph?: Graph,
): DiffPiece[] {
  const verb = changeVerb(effectiveChange(item));
  const kind = kindWord(item.kind);
  const kindLead = `${kind} `;
  const bare = text(`${verb} ${kind}`);

  switch (item.kind) {
    case "question": {
      const found = locate(item, graph, baseGraph, findQuestion);
      if (found === undefined) return [bare];
      return [
        text(`${verb} `),
        ref(kindLead, found.value.prompt, found.onMap ? found.value.id : null, true),
      ];
    }
    case "option": {
      const found = locate(item, graph, baseGraph, findOption);
      const draftParent =
        mapNode(graph, item.question_id) ??
        (found?.onMap ? found.value.question : undefined);
      const parent = draftParent ?? found?.value.question;
      const parentId = draftParent?.id ?? null;
      const pieces: DiffPiece[] =
        found === undefined
          ? [bare]
          : [text(`${verb} `), ref(kindLead, found.value.option.label, parentId, true)];
      if (parent !== undefined) {
        pieces.push(text(" on "), questionRef(parent.prompt, parentId));
      }
      return pieces;
    }
    case "edge": {
      const found = locate(item, graph, baseGraph, findEdge);
      const draftFrom =
        mapNode(graph, item.question_id) ??
        (found?.onMap ? findQuestion(graph, found.value.from_question) : undefined);
      const from =
        draftFrom ??
        (found === undefined
          ? undefined
          : findQuestion(found.graph, found.value.from_question));
      const fromId = draftFrom?.id ?? null;
      const pieces: DiffPiece[] = [];
      if (found === undefined) {
        pieces.push(bare);
      } else {
        const optionLabel = edgeOptionLabel(
          found.graph,
          found.value.from_question,
          found.value.from_option,
        );
        if (optionLabel === null) {
          pieces.push(text(`${verb} connection`));
        } else {
          pieces.push(text(`${verb} `), ref(kindLead, optionLabel, fromId, true));
        }
      }
      if (from !== undefined) {
        pieces.push(text(" from "), questionRef(from.prompt, fromId));
      }
      if (found !== undefined) {
        pieces.push(text(" to "));
        const edge = found.value;
        if (edge.to_question === null) {
          pieces.push(text('"End of flow"'));
        } else {
          const destination = findQuestion(found.graph, edge.to_question);
          if (destination === undefined) pieces.push(text("question"));
          else {
            pieces.push(
              questionRef(destination.prompt, found.onMap ? destination.id : null),
            );
          }
        }
      }
      return pieces;
    }
    case "section": {
      const found = locate(item, graph, baseGraph, findSection);
      if (found === undefined) return [bare];
      const section = found.value;
      return [
        text(`${verb} `),
        ref(kindLead, section.name !== "" ? section.name : section.code, null, true),
      ];
    }
  }
}

export function diffSentence(item: ItemDiff, graph: Graph, baseGraph?: Graph): string {
  return diffPieces(item, graph, baseGraph)
    .map((piece) =>
      piece.type === "text"
        ? piece.text
        : `${piece.prefix}${piece.quoted === true ? `"${piece.label}"` : piece.label}`,
    )
    .join("");
}
