import type { ElementDefinition } from "cytoscape";

import type {
  AnswerType,
  Edge,
  Graph,
  Question,
  Section,
  UUID,
  VersionDiff,
} from "../api/types";

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

/** What an open draft's own diff says about a node/edge/option -- "added"
 * for a brand new question, option or edge, "changed" for an existing
 * one with a changed field of its own, or (a question only) a changed/
 * added/removed option or edge underneath it. `null` off a live/
 * published version, which has nothing pending to show, and for
 * anything the diff doesn't mention. Same two values `DiffChange` itself
 * uses for "added"/"changed" (`labels.ts`'s `diffChangeLabel`), minus
 * "removed" -- nothing removed is drawn to badge in the first place. */
export type ChangeKind = "added" | "changed";

/** Exactly one badge per node (break's `badgeClassFor`) -- a node is never
 * asked to carry two structural facts as two icons, so the corner stays
 * legible. Priority order matches break's: a pending add/edit outranks
 * every structural fact (it is the more urgent, actionable one -- not
 * live yet), and within those, a branch outranks "unreachable," which in
 * turn outranks entry/terminal. */
export type BadgeKind =
  "added" | "changed" | "entry" | "terminal" | "branch" | "unreachable";

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
  changeKind: ChangeKind | null;
  /** The node id of this section's first (lowest `display_order`) live
   * question -- `null` for that question itself (nothing to anchor to),
   * for a question with no section, and for every synthetic node. A
   * brand new question has no edges yet, so dagre lays it out as a
   * disconnected node whenever the canvas re-runs layout (`Canvas.tsx`),
   * which can land it far from the rest of its section -- this is what
   * that reposition-after-layout step places it beside instead. */
  sectionAnchorId: string | null;
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
  changeKind: ChangeKind | null;
}

export function questionLabel(question: Question): string {
  return `${trunc(question.prompt, 60)}\n${TYPE_GLYPH[question.answer_type]} ${question.code}`;
}

/** Break's `badgeClassFor`, `changeKind` standing in for its pending-new/
 * -delete/-modified cases (this app's "deleted" is the existing
 * `archived` node kind instead, which never reaches this function --
 * see `buildElements`). */
function badgeKindFor(
  changeKind: ChangeKind | null,
  isDecision: boolean,
  isUnreachable: boolean,
  isEntry: boolean,
  isTerminal: boolean,
): BadgeKind | null {
  if (changeKind !== null) return changeKind;
  if (isDecision) return "branch";
  if (isUnreachable) return "unreachable";
  if (isEntry) return "entry";
  if (isTerminal) return "terminal";
  return null;
}

export interface ChangeKinds {
  questions: ReadonlyMap<UUID, ChangeKind>;
  options: ReadonlyMap<UUID, ChangeKind>;
  edges: ReadonlyMap<UUID, ChangeKind>;
}

/** Which questions/options/edges an open draft's diff touches, and how --
 * purely a presentational bucketing of the diff the server already
 * computed (`ReviewView`/`DiffList`'s own data), keyed by whatever id
 * each row already carries. Not a second diff engine: nothing here
 * recomputes what changed, only where an already-computed row points --
 * on the canvas (`buildElements`) and in the detail panel
 * (`DetailPanel`/`Options`), which both call this rather than each
 * keeping their own copy. */
export function changeKindsFromDiff(diff: VersionDiff | undefined): ChangeKinds {
  const questions = new Map<UUID, ChangeKind>();
  const options = new Map<UUID, ChangeKind>();
  const edges = new Map<UUID, ChangeKind>();
  if (diff === undefined) return { questions, options, edges };

  for (const item of diff.questions) {
    if (item.change === "added" && item.question_id !== null) {
      questions.set(item.question_id, "added");
    }
  }
  // Anything else naming a question -- its own changed fields, or one of
  // its options/edges added, changed or removed -- makes it "changed",
  // unless it's the brand-new question those rows belong to in the first
  // place.
  for (const item of [...diff.questions, ...diff.options, ...diff.edges]) {
    if (item.question_id === null) continue;
    if (questions.get(item.question_id) === "added") continue;
    questions.set(item.question_id, "changed");
  }

  for (const item of diff.options) {
    if (item.draft_id === null) continue;
    if (item.change === "added") options.set(item.draft_id, "added");
    else if (item.change === "changed") options.set(item.draft_id, "changed");
  }

  for (const item of diff.edges) {
    if (item.draft_id === null) continue;
    if (item.change === "added") edges.set(item.draft_id, "added");
    else if (item.change === "changed") edges.set(item.draft_id, "changed");
  }

  return { questions, options, edges };
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

export function buildElements(graph: Graph, diff?: VersionDiff): ElementDefinition[] {
  const questionsById = new Map(graph.questions.map((item) => [item.id, item]));
  const entryId = graph.diagnostics.entry_question_id;
  const decisions = new Set(graph.diagnostics.decision_point_question_ids);
  const terminals = new Set(graph.diagnostics.terminal_question_ids);
  const unreachable = new Set(graph.diagnostics.unreachable_question_ids);
  const uncovered = new Set(graph.diagnostics.uncovered_option_question_ids);
  const deadEdges = new Set(graph.diagnostics.dead_edge_ids);
  const brokenEdges = new Set(graph.diagnostics.broken_edge_ids);
  const backEdges = new Set(graph.diagnostics.back_edge_ids);
  const changeKinds = changeKindsFromDiff(diff);

  const faultedQuestions = new Set(uncovered);
  for (const edge of graph.edges) {
    if (deadEdges.has(edge.id) || brokenEdges.has(edge.id)) {
      faultedQuestions.add(edge.from_question);
    }
  }

  const sectionColor = sectionColorMap(graph.sections);

  // Each section's own first (lowest `display_order`) live question --
  // see `NodeData.sectionAnchorId`'s doc comment for why the canvas wants
  // this.
  const sectionAnchor = new Map<UUID, UUID>();
  for (const question of graph.questions) {
    if (question.archived_at !== null || question.section === null) continue;
    const currentAnchorId = sectionAnchor.get(question.section);
    const currentAnchor =
      currentAnchorId !== undefined ? questionsById.get(currentAnchorId) : undefined;
    if (
      currentAnchor === undefined ||
      question.display_order < currentAnchor.display_order
    ) {
      sectionAnchor.set(question.section, question.id);
    }
  }

  const elements: ElementDefinition[] = [];

  for (const question of graph.questions) {
    const archived = question.archived_at !== null;
    const isEntry = !archived && question.id === entryId;
    const isTerminal = !archived && terminals.has(question.id);
    const isDecision = !archived && decisions.has(question.id);
    const isUnreachable = !archived && unreachable.has(question.id);
    // An archived question already has its own "this is gone" treatment
    // (`kind: "archived"` below) -- it doesn't also need "changed" from
    // the very diff row that archived it.
    const changeKind = archived
      ? null
      : (changeKinds.questions.get(question.id) ?? null);
    const rawAnchorId =
      !archived && question.section !== null
        ? (sectionAnchor.get(question.section) ?? null)
        : null;
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
        : badgeKindFor(changeKind, isDecision, isUnreachable, isEntry, isTerminal),
      isEntry,
      isTerminal,
      isDecision,
      isUnreachable,
      hasFault: !archived && faultedQuestions.has(question.id),
      changeKind,
      // The anchor for its own section is nothing to anchor to.
      sectionAnchorId: rawAnchorId !== question.id ? rawAnchorId : null,
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
      changeKind: null,
      sectionAnchorId: null,
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
      changeKind: null,
      sectionAnchorId: null,
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
      changeKind: changeKinds.edges.get(edge.id) ?? null,
    };
    elements.push({ data, group: "edges" });
  }

  return elements;
}
