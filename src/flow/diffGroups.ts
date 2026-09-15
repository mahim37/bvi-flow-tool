import type { Graph, ItemDiff, UUID } from "../api/types";

export type DiffGroupKind = "question" | "section" | "other";

export interface DiffNodeGroup {
  key: string;
  kind: DiffGroupKind;
  /** Draft question this group hangs off, if any. Map jump target. */
  questionId: UUID | null;
  title: string;
  items: ItemDiff[];
}

function itemUuid(item: ItemDiff): UUID | null {
  return item.change === "removed" ? item.base_id : (item.draft_id ?? item.base_id);
}

/** The node an edge belongs to is the question it leaves, not the one it
 * lands on. `question_id` on the row is that from-question when the
 * server still has it; a live edge in this graph is the fallback if the
 * row's pointer is missing. */
function nodeIdFor(item: ItemDiff, graph: Graph): UUID | null {
  if (item.kind === "section") return null;
  if (item.kind === "edge") {
    const uuid = itemUuid(item);
    const edge =
      uuid === null
        ? undefined
        : graph.edges.find((candidate) => candidate.id === uuid);
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

function groupTitle(group: Omit<DiffNodeGroup, "title">, graph: Graph): string {
  if (group.kind === "question") {
    if (group.questionId !== null) {
      const question = graph.questions.find((item) => item.id === group.questionId);
      if (question !== undefined) return question.prompt;
    }
    const own = group.items.find((item) => item.kind === "question");
    return own?.key ?? "Removed question";
  }
  if (group.kind === "section") {
    const own = group.items[0];
    const uuid = own === undefined ? null : itemUuid(own);
    const section =
      uuid === null
        ? undefined
        : graph.sections.find((candidate) => candidate.id === uuid);
    if (section !== undefined) {
      return section.name !== "" ? section.name : section.code;
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
 */
export function groupDiffByNode(items: readonly ItemDiff[], graph: Graph): DiffNodeGroup[] {
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
      return { ...group, title: groupTitle(group, graph) };
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
