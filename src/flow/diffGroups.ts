import type { Graph, ItemDiff, UUID } from "../api/types";
import { findEdge, findQuestion, findSection, locate } from "./diffItem";

export type DiffGroupKind = "question" | "section" | "other";

export interface DiffNodeGroup {
  key: string;
  kind: DiffGroupKind;
  /** Draft question this group hangs off, if any. Map jump target. */
  questionId: UUID | null;
  title: string;
  items: ItemDiff[];
}

/** The node an edge belongs to is the question it leaves, not the one it
 * lands on. `question_id` on the row is that from-question when the
 * server still has it; a live edge in this graph is the fallback if the
 * row's pointer is missing. */
function nodeIdFor(item: ItemDiff, graph: Graph): UUID | null {
  if (item.kind === "section") return null;
  if (item.kind === "edge" && item.draft_id !== null) {
    const edge = findEdge(graph, item.draft_id);
    if (edge !== undefined) return edge.from_question;
  }
  return item.question_id;
}

function groupMeta(
  item: ItemDiff,
  graph: Graph,
): { key: string; kind: DiffGroupKind; questionId: UUID | null } {
  if (item.kind === "section") {
    return { key: `section:${item.key}`, kind: "section", questionId: null };
  }
  const nodeId = nodeIdFor(item, graph);
  if (nodeId !== null) {
    return { key: `question:${nodeId}`, kind: "question", questionId: nodeId };
  }
  if (item.kind === "question") {
    return {
      key: `removed-question:${item.key}`,
      kind: "question",
      questionId: null,
    };
  }
  return { key: "other", kind: "other", questionId: null };
}

function groupTitle(
  group: Omit<DiffNodeGroup, "title">,
  graph: Graph,
  baseGraph: Graph | undefined,
): string {
  if (group.kind === "question") {
    if (group.questionId !== null) {
      const question = findQuestion(graph, group.questionId);
      if (question !== undefined) return question.prompt;
    }
    // Not on the draft graph: a retired question nothing points at any
    // more, or one whose code is gone. Its own row still names the copy
    // on the version the diff was taken against.
    const own = group.items.find((item) => item.kind === "question");
    if (own !== undefined) {
      const found = locate(own, graph, baseGraph, findQuestion);
      if (found !== undefined) return found.value.prompt;
    }
    return own?.key ?? "Removed question";
  }
  if (group.kind === "section") {
    const own = group.items[0];
    const found =
      own === undefined ? undefined : locate(own, graph, baseGraph, findSection);
    if (found !== undefined) {
      return found.value.name !== "" ? found.value.name : found.value.code;
    }
    return own?.key ?? "Section";
  }
  return "Other changes";
}

const KIND_RANK: Record<DiffGroupKind, number> = {
  question: 0,
  section: 1,
  other: 2,
};

/**
 * Bucket every diff row under the node it belongs to. Edges sit on the
 * question they leave. Sections (no node) get a group of their own.
 *
 * `baseGraph` is the version the diff was taken against; it is what
 * titles a group whose question or section the draft graph no longer
 * carries. Without it such a group falls back to the row's code.
 */
export function groupDiffByNode(
  items: readonly ItemDiff[],
  graph: Graph,
  baseGraph?: Graph,
): DiffNodeGroup[] {
  const buckets = new Map<string, Omit<DiffNodeGroup, "title">>();
  const order: string[] = [];

  for (const item of items) {
    const meta = groupMeta(item, graph);
    const existing = buckets.get(meta.key);
    if (existing === undefined) {
      buckets.set(meta.key, { ...meta, items: [item] });
      order.push(meta.key);
    } else {
      existing.items.push(item);
    }
  }

  const questionOrder = new Map(
    graph.questions.map((question, index) => [question.id, index]),
  );

  return order
    .map((key) => {
      const group = buckets.get(key);
      if (group === undefined) throw new Error(`missing diff group ${key}`);
      return { ...group, title: groupTitle(group, graph, baseGraph) };
    })
    .sort((left, right) => {
      const kindDelta = KIND_RANK[left.kind] - KIND_RANK[right.kind];
      if (kindDelta !== 0) return kindDelta;
      if (left.kind === "question") {
        const leftIndex =
          left.questionId === null
            ? Number.POSITIVE_INFINITY
            : (questionOrder.get(left.questionId) ?? Number.POSITIVE_INFINITY);
        const rightIndex =
          right.questionId === null
            ? Number.POSITIVE_INFINITY
            : (questionOrder.get(right.questionId) ?? Number.POSITIVE_INFINITY);
        if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      }
      return left.title.localeCompare(right.title);
    });
}
