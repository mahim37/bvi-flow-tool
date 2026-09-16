import type { DiffChange, Graph, ItemDiff, Question, UUID } from "../api/types";
import {
  effectiveChange,
  findEdge,
  findOption,
  findQuestion,
  findSection,
  locate,
} from "./diffItem";
import { DEFAULT_ROUTE_LABEL } from "./labels";

export type DiffPiece =
  | { type: "text"; text: string }
  | { type: "ref"; prefix: string; label: string; questionId: UUID | null };

function edgeLabel(graph: Graph, fromQuestion: UUID, fromOption: UUID | null): string {
  if (fromOption === null) return DEFAULT_ROUTE_LABEL;
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
  const lead = `${verb} ${kindWord(item.kind)} `;
  const bare = text(`${verb} ${kindWord(item.kind)}`);

  switch (item.kind) {
    case "question": {
      const found = locate(item, graph, baseGraph, findQuestion);
      if (found === undefined) return [bare];
      return [ref(lead, found.value.prompt, found.onMap ? found.value.id : null)];
    }
    case "option": {
      const found = locate(item, graph, baseGraph, findOption);
      // The parent is named from the draft graph whenever it is there --
      // that is the node the map would open -- and from wherever the
      // option itself turned up otherwise.
      const draftParent =
        mapNode(graph, item.question_id) ??
        (found?.onMap ? found.value.question : undefined);
      const parent = draftParent ?? found?.value.question;
      const parentId = draftParent?.id ?? null;
      const pieces: DiffPiece[] = [
        found === undefined ? bare : ref(lead, found.value.option.label, parentId),
      ];
      if (parent !== undefined) {
        pieces.push(text(" on "), ref("", parent.prompt, parentId));
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
        const edge = found.value;
        pieces.push(
          ref(
            lead,
            edgeLabel(found.graph, edge.from_question, edge.from_option),
            fromId,
          ),
        );
      }
      if (from !== undefined) {
        pieces.push(text(" from "), ref("", from.prompt, fromId));
      }
      if (found !== undefined) {
        pieces.push(text(" to "));
        const edge = found.value;
        if (edge.to_question === null) {
          pieces.push(text("End of flow"));
        } else {
          const destination = findQuestion(found.graph, edge.to_question);
          if (destination === undefined) pieces.push(text("question"));
          else {
            pieces.push(
              ref("", destination.prompt, found.onMap ? destination.id : null),
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
      return [ref(lead, section.name !== "" ? section.name : section.code, null)];
    }
  }
}

export function diffSentence(item: ItemDiff, graph: Graph, baseGraph?: Graph): string {
  return diffPieces(item, graph, baseGraph)
    .map((piece) =>
      piece.type === "text" ? piece.text : `${piece.prefix}${piece.label}`,
    )
    .join("");
}
