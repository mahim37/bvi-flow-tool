import type { ElementDefinition } from "cytoscape";

import type { Edge, Graph, Question, UUID } from "../api/types";

/**
 * One shared terminal node, not one per question that can stop.
 *
 * `to_question === null` means the flow ends, and every such edge means
 * the same thing, so they converge. Giving each source its own end node
 * would draw a wide row of identical stubs and make "these four answers
 * all finish the questionnaire" look like four unrelated outcomes.
 */
export const END_NODE_ID = "__end__";

/** Prefix for a target the payload does not contain. Reached when an edge
 * points across versions: the resolver raises on it, `diagnostics` reports
 * it as broken, and the map has to draw *something* at the far end or the
 * arrow silently disappears -- taking the evidence with it. */
const MISSING_PREFIX = "__missing__:";

export const missingNodeId = (questionId: UUID) => `${MISSING_PREFIX}${questionId}`;
export const isSyntheticNode = (id: string) =>
  id === END_NODE_ID || id.startsWith(MISSING_PREFIX);

export type NodeKind = "question" | "archived" | "end" | "missing";

export interface NodeData {
  id: string;
  kind: NodeKind;
  /** What the node is called. Always the question's `code`, never its
   * position: `display_order` is presentational under graph routing, so
   * labelling a node "Q12" from its index would put the identity problem
   * the edge model exists to remove straight back into the UI -- insert a
   * question and every label anyone wrote down shifts. */
  label: string;
  prompt: string;
  isEntry: boolean;
  isTerminal: boolean;
  isDecision: boolean;
  isUnreachable: boolean;
  hasFault: boolean;
}

export interface EdgeData {
  id: string;
  source: string;
  target: string;
  /** The guard, in words: an option's label, or "any answer" for the
   * question-level edge. Both are real routing behaviour, so neither is
   * left blank. */
  guard: string;
  priority: number;
  isDead: boolean;
  isBroken: boolean;
  isBack: boolean;
}

export function questionLabel(question: Question): string {
  return question.code;
}

export function guardLabel(edge: Edge, question: Question | undefined): string {
  if (edge.from_option === null) return "any answer";
  const option = question?.options.find(
    (candidate) => candidate.id === edge.from_option,
  );
  // An option the question does not own is exactly what `dead_edge_ids`
  // reports, so the label says so rather than falling back to something
  // that reads like a working guard.
  return option ? option.label : "unknown option";
}

export function buildElements(graph: Graph): ElementDefinition[] {
  const questionsById = new Map(graph.questions.map((item) => [item.id, item]));
  const entryId = graph.diagnostics.entry_question_id;
  const decisions = new Set(graph.diagnostics.decision_point_question_ids);
  const terminals = new Set(graph.diagnostics.terminal_question_ids);
  const unreachable = new Set(graph.diagnostics.unreachable_question_ids);
  const uncovered = new Set(graph.diagnostics.uncovered_option_question_ids);
  const deadEdges = new Set(graph.diagnostics.dead_edge_ids);
  const brokenEdges = new Set(graph.diagnostics.broken_edge_ids);
  const backEdges = new Set(graph.diagnostics.back_edge_ids);

  const faultedQuestions = new Set(uncovered);
  for (const edge of graph.edges) {
    if (deadEdges.has(edge.id) || brokenEdges.has(edge.id)) {
      faultedQuestions.add(edge.from_question);
    }
  }

  const elements: ElementDefinition[] = [];

  for (const question of graph.questions) {
    const archived = question.archived_at !== null;
    const data: NodeData = {
      id: question.id,
      // An archived question is drawn only while something still points at
      // it, and it carries no diagnostics: the resolver never serves one,
      // so every flag below would be an invented fact about a question
      // with no behaviour at all.
      kind: archived ? "archived" : "question",
      label: questionLabel(question),
      prompt: question.prompt,
      isEntry: !archived && question.id === entryId,
      isTerminal: !archived && terminals.has(question.id),
      isDecision: !archived && decisions.has(question.id),
      isUnreachable: !archived && unreachable.has(question.id),
      hasFault: !archived && faultedQuestions.has(question.id),
    };
    elements.push({ data, group: "nodes" });
  }

  const missingTargets = new Set<UUID>();
  for (const edge of graph.edges) {
    if (edge.to_question !== null && !questionsById.has(edge.to_question)) {
      missingTargets.add(edge.to_question);
    }
  }
  for (const targetId of missingTargets) {
    const data: NodeData = {
      id: missingNodeId(targetId),
      kind: "missing",
      label: "Unknown question",
      prompt: `This version has no question with id ${targetId}.`,
      isEntry: false,
      isTerminal: false,
      isDecision: false,
      isUnreachable: false,
      hasFault: true,
    };
    elements.push({ data, group: "nodes" });
  }

  const endsFlow = graph.edges.some((edge) => edge.to_question === null);
  if (endsFlow) {
    const data: NodeData = {
      id: END_NODE_ID,
      kind: "end",
      label: "End of flow",
      prompt: "No further question is served.",
      isEntry: false,
      isTerminal: true,
      isDecision: false,
      isUnreachable: false,
      hasFault: false,
    };
    elements.push({ data, group: "nodes" });
  }

  for (const edge of graph.edges) {
    const target =
      edge.to_question === null
        ? END_NODE_ID
        : questionsById.has(edge.to_question)
          ? edge.to_question
          : missingNodeId(edge.to_question);
    const data: EdgeData = {
      id: edge.id,
      source: edge.from_question,
      target,
      guard: guardLabel(edge, questionsById.get(edge.from_question)),
      priority: edge.priority,
      isDead: deadEdges.has(edge.id),
      isBroken: brokenEdges.has(edge.id),
      isBack: backEdges.has(edge.id),
    };
    elements.push({ data, group: "edges" });
  }

  return elements;
}
