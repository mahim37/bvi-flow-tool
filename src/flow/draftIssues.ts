import type { Graph, UUID } from "../api/types";
import { questionRefLabel } from "./labels";

export type DraftIssueKind = "unreachable" | "uncovered" | "dead" | "broken" | "loop";

export type DraftIssue = {
  id: string;
  questionId: UUID | null;
  title: string;
  tags: string[];
};

const KIND_ORDER: DraftIssueKind[] = [
  "unreachable",
  "uncovered",
  "dead",
  "broken",
  "loop",
];

const KIND_TAG: Record<DraftIssueKind, string> = {
  unreachable: "Unreachable",
  uncovered: "Uncovered answers",
  dead: "Dead route",
  broken: "Broken route",
  loop: "Loop",
};

function sourceQuestionIds(graph: Graph, edgeIds: UUID[]): UUID[] {
  const sourceOf = new Map(graph.edges.map((edge) => [edge.id, edge.from_question]));
  const found: UUID[] = [];
  for (const edgeId of edgeIds) {
    const source = sourceOf.get(edgeId);
    if (source !== undefined && !found.includes(source)) found.push(source);
  }
  return found;
}

function addKind(
  byQuestion: Map<UUID, Set<DraftIssueKind>>,
  kind: DraftIssueKind,
  questionIds: UUID[],
) {
  for (const id of questionIds) {
    let kinds = byQuestion.get(id);
    if (kinds === undefined) {
      kinds = new Set();
      byQuestion.set(id, kinds);
    }
    kinds.add(kind);
  }
}

/**
 * Graph faults a reviewer can act on, one row per question.
 *
 * Several diagnostics can hang off the same node (unreachable *and* a
 * broken outgoing route). Those are one place to open, so they collapse
 * to one item. `publish_blocker` restates the same facts as a sentence,
 * so it is only kept when diagnostics cannot point at a question.
 */
export function draftIssues(graph: Graph, publishBlocker: string | null): DraftIssue[] {
  const audit = graph.diagnostics;
  const byQuestion = new Map<UUID, Set<DraftIssueKind>>();
  addKind(byQuestion, "unreachable", audit.unreachable_question_ids);
  addKind(byQuestion, "uncovered", audit.uncovered_option_question_ids);
  addKind(byQuestion, "dead", sourceQuestionIds(graph, audit.dead_edge_ids));
  addKind(byQuestion, "broken", sourceQuestionIds(graph, audit.broken_edge_ids));
  addKind(byQuestion, "loop", sourceQuestionIds(graph, audit.back_edge_ids));

  const items: DraftIssue[] = [];
  if (audit.entry_question_id === null) {
    items.push({
      id: "no-entry",
      questionId: null,
      title: "No entry point",
      tags: [],
    });
  }

  for (const question of graph.questions) {
    const kinds = byQuestion.get(question.id);
    if (kinds === undefined || question.archived_at !== null) continue;
    items.push({
      id: question.id,
      questionId: question.id,
      title: questionRefLabel(question),
      tags: KIND_ORDER.filter((kind) => kinds.has(kind)).map((kind) => KIND_TAG[kind]),
    });
  }

  if (items.length === 0 && publishBlocker !== null && publishBlocker !== "") {
    items.push({
      id: "publish-blocker",
      questionId: null,
      title: publishBlocker,
      tags: [],
    });
  }

  return items;
}
