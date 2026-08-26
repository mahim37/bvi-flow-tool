import type { ElementDefinition } from "cytoscape";

import type { AnswerType, Edge, Graph, Question, Section, UUID } from "../api/types";

/**
 * Ported from break-backend's question_graph_editor (static/question_graph_editor/app.js)
 * for visual parity: the exact 16-color section palette, answer-type
 * glyphs and truncation break's own canvas uses. Kept here rather than in
 * canvasStyle.ts because these are element-data concerns (which color,
 * which glyph) rather than style-rule concerns (what a color/glyph looks
 * like once assigned).
 */
const PALETTE = [
  "#2f6fd6",
  "#c15c1f",
  "#7c4fd1",
  "#1f9d5c",
  "#c33d35",
  "#12897d",
  "#a3760a",
  "#c94a7c",
  "#1479b0",
  "#5c8a0f",
  "#8a6328",
  "#a530c2",
  "#c72b45",
  "#4353d1",
  "#0f8f5c",
  "#8324d6",
];

const TYPE_GLYPH: Record<AnswerType, string> = {
  single_choice: "◉",
  multi_choice: "☰",
  scale: "#",
  free_text: "✎",
};

/** Exported so `labels.ts`'s `targetLabel` can truncate a target's prompt
 * the same way the canvas itself does, rather than a second, possibly
 * different cutoff. */
export function trunc(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Exported so the detail panel's section badge (`DetailPanel.tsx`) can
 * show the same color the canvas draws that section's node borders in --
 * one source of truth for "which color is this section," keyed by id
 * rather than the sidebar legend's separate nth-child palette, which has
 * no per-question lookup to reuse here. */
export function sectionColorMap(sections: readonly Section[]): Map<UUID, string> {
  const ordered = [...sections].sort((a, b) => a.display_order - b.display_order);
  return new Map(
    ordered.map((section, index) => [
      section.id,
      PALETTE[index % PALETTE.length] ?? NO_SECTION_COLOR,
    ]),
  );
}

/** Break's fallback for a question with no section — kept as the same
 * grey rather than reusing a palette color, so "unfiled" never reads as
 * "assigned to a section that happens to look like this." */
export const NO_SECTION_COLOR = "#6b6355";

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

/** Exactly one badge per node (break's `badgeClassFor`) -- a node is never
 * asked to carry two structural facts as two icons, so the corner stays
 * legible. Priority order matches break's: a branch is the more
 * actionable fact than "unreachable," which in turn outranks entry/
 * terminal. */
export type BadgeKind = "entry" | "terminal" | "branch" | "unreachable";

export interface NodeData {
  id: string;
  kind: NodeKind;
  /** The on-canvas label: the prompt (truncated), then the answer-type
   * glyph and the question's `code` on a second line -- never
   * `display_order`, which is presentational under graph routing, so a
   * position-based label would shift every time a question is inserted
   * elsewhere in the flow. Structural state (entry/branch/terminal/
   * unreachable) is carried entirely by `badgeKind`, not by anything in
   * this text -- see break's own `nodeLabel`/`badgeClassFor` split. */
  label: string;
  prompt: string;
  sectionColor: string;
  badgeKind: BadgeKind | null;
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
  /** The guard, in words: an option's label, or "anything else" for the
   * question-level edge. Both are real routing behaviour, so neither is
   * left blank. */
  guard: string;
  priority: number;
  isDead: boolean;
  isBroken: boolean;
  isBack: boolean;
}

export function questionLabel(question: Question): string {
  return `${trunc(question.prompt, 60)}\n${TYPE_GLYPH[question.answer_type]} ${question.code}`;
}

/** Break's `badgeClassFor`, minus the pending-new/-delete/-modified cases
 * this app doesn't (yet) compute on the canvas -- see ReviewView/DiffList
 * for where that data already lives. */
function badgeKindFor(
  isDecision: boolean,
  isUnreachable: boolean,
  isEntry: boolean,
  isTerminal: boolean,
): BadgeKind | null {
  if (isDecision) return "branch";
  if (isUnreachable) return "unreachable";
  if (isEntry) return "entry";
  if (isTerminal) return "terminal";
  return null;
}

export function guardLabel(edge: Edge, question: Question | undefined): string {
  if (edge.from_option === null) return "anything else";
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

  const sectionColor = sectionColorMap(graph.sections);
  const elements: ElementDefinition[] = [];

  for (const question of graph.questions) {
    const archived = question.archived_at !== null;
    const isEntry = !archived && question.id === entryId;
    const isTerminal = !archived && terminals.has(question.id);
    const isDecision = !archived && decisions.has(question.id);
    const isUnreachable = !archived && unreachable.has(question.id);
    const data: NodeData = {
      id: question.id,
      // An archived question is drawn only while something still points at
      // it, and it carries no diagnostics: the resolver never serves one,
      // so every flag below would be an invented fact about a question
      // with no behaviour at all.
      kind: archived ? "archived" : "question",
      label: questionLabel(question),
      prompt: question.prompt,
      sectionColor: question.section
        ? (sectionColor.get(question.section) ?? NO_SECTION_COLOR)
        : NO_SECTION_COLOR,
      badgeKind: archived
        ? null
        : badgeKindFor(isDecision, isUnreachable, isEntry, isTerminal),
      isEntry,
      isTerminal,
      isDecision,
      isUnreachable,
      hasFault: !archived && faultedQuestions.has(question.id),
    };
    elements.push({ data, group: "nodes" });
  }

  // Either end of an edge can name a question this payload doesn't
  // contain -- `to_question` across versions is the documented case, but
  // `from_question` is no more guaranteed to resolve, and Cytoscape
  // refuses outright to add an edge whose source or target isn't an
  // element it already has, crashing the whole canvas rather than just
  // that one edge. Both get the same placeholder treatment, keyed by
  // question id so a question missing on both ends still gets one node,
  // not two.
  const missingQuestionIds = new Set<UUID>();
  for (const edge of graph.edges) {
    if (!questionsById.has(edge.from_question)) {
      missingQuestionIds.add(edge.from_question);
    }
    if (edge.to_question !== null && !questionsById.has(edge.to_question)) {
      missingQuestionIds.add(edge.to_question);
    }
  }
  for (const missingId of missingQuestionIds) {
    const data: NodeData = {
      id: missingNodeId(missingId),
      kind: "missing",
      label: "Unknown question",
      prompt: `This version has no question with id ${missingId}.`,
      sectionColor: NO_SECTION_COLOR,
      badgeKind: null,
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
      sectionColor: NO_SECTION_COLOR,
      badgeKind: null,
      isEntry: false,
      isTerminal: true,
      isDecision: false,
      isUnreachable: false,
      hasFault: false,
    };
    elements.push({ data, group: "nodes" });
  }

  for (const edge of graph.edges) {
    const source = questionsById.has(edge.from_question)
      ? edge.from_question
      : missingNodeId(edge.from_question);
    const target =
      edge.to_question === null
        ? END_NODE_ID
        : questionsById.has(edge.to_question)
          ? edge.to_question
          : missingNodeId(edge.to_question);
    const data: EdgeData = {
      id: edge.id,
      source,
      target,
      // Blank for the question-level fallback rather than the literal
      // "anything else" -- every *specific* option gets a label, so the
      // one edge left unlabelled at a node already reads as "whatever
      // wasn't one of those" without spelling it out. Truncated hard for
      // everything else: this text runs diagonally along the edge itself
      // (`canvasStyle.ts`'s `text-rotation: autorotate`), not wrapped in a
      // box like a node's own label -- a long guard reads as tangled
      // sideways text the moment more than one edge converges on a node.
      // The full guard is never lost, just not here: it's what `Options`
      // already shows in full in the detail panel.
      guard:
        edge.from_option === null
          ? ""
          : trunc(guardLabel(edge, questionsById.get(edge.from_question)), 20),
      priority: edge.priority,
      isDead: deadEdges.has(edge.id),
      isBroken: brokenEdges.has(edge.id),
      isBack: backEdges.has(edge.id),
    };
    elements.push({ data, group: "edges" });
  }

  return elements;
}
