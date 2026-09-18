import type { ElementDefinition } from "cytoscape";

import {
  CHOICE_ANSWER_TYPES,
  type AnswerType,
  type Edge,
  type Graph,
  type Question,
  type QuestionOption,
  type Section,
  type UUID,
  type VersionDiff,
} from "../api/types";
import { effectiveChange } from "./diffItem";

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

/** Short type tag under a canvas prompt -- `(single)` / `(multiple)` /
 * `(integer)` / `(text)`, matching the words the rest of the product
 * already uses for those four answer types. */
const ANSWER_TYPE_PAREN: Record<AnswerType, string> = {
  single_choice: "single",
  multi_choice: "multiple",
  scale: "integer",
  free_text: "text",
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
const SECTION_PREFIX = "__section__:";

export const missingNodeId = (questionId: UUID) => `${MISSING_PREFIX}${questionId}`;
export const sectionNodeId = (sectionId: UUID) => `${SECTION_PREFIX}${sectionId}`;
export const isSyntheticNode = (id: string) =>
  id === END_NODE_ID || id.startsWith(MISSING_PREFIX);
export const isSectionNode = (id: string) => id.startsWith(SECTION_PREFIX);

export type NodeKind = "question" | "archived" | "end" | "missing" | "section";

/** What an open draft's own diff says about a node/edge/option -- "added"
 * for a brand new question, option or edge, "changed" for an existing
 * one with a changed field of its own, or (a question only) a changed/
 * added/removed option or edge underneath it. `null` off a live/
 * published version, which has nothing pending to show, and for
 * anything the diff doesn't mention. Same two values `DiffChange` itself
 * uses for "added"/"changed" (`labels.ts`'s `diffChangeLabel`). Removed
 * questions still draw as `kind: "archived"` in draft/review (see
 * `withRemovedDraftEntities`); removed routes carry `isRemoved` instead
 * of a third `ChangeKind`. */
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
  /** The on-canvas label: `ID: <code>` on the first line, the prompt
   * (truncated) in the middle, then `(single)` / `(multiple)` /
   * `(integer)` / `(text)` underneath. Never `display_order`, which is
   * presentational under graph routing, so a position-based label would
   * shift every time a question is inserted elsewhere in the flow.
   * Structural state (entry/branch/terminal/unreachable) is carried
   * entirely by `badgeKind`, not by anything in this text. */
  label: string;
  /** Untruncated canvas wording. Hover shows this at a larger size so
   * ellipsis and wrap are only the resting state, including on nodes
   * whose compact label already fitted. */
  fullLabel: string;
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
  /** Cytoscape compound parent -- the section box when this question's
   * section is expanded. Absent on the section node itself, on unfiled
   * questions, and on every synthetic node. */
  parent?: string;
  /** Real section uuid, only on `kind: "section"` nodes. */
  sectionId?: UUID;
  collapsed?: boolean;
  questionCount?: number;
}

export interface EdgeData {
  id: string;
  source: string;
  target: string;
  /** The guard, in words: an option's label, or a choice-count for the
   * question-level default route ("4 choices"). Truncated for the arrow;
   * hover uses `fullGuard`. */
  guard: string;
  /** Untruncated option wording, or the same short default-route label. */
  fullGuard: string;
  priority: number;
  isDead: boolean;
  isBroken: boolean;
  isBack: boolean;
  changeKind: ChangeKind | null;
  /** A route the draft removed, kept on the canvas in draft/review so a
   * retired question (and the arrows that used to reach it) do not
   * vanish the moment nothing live points at them. */
  isRemoved: boolean;
}

export function questionTypeParen(type: AnswerType): string {
  return ANSWER_TYPE_PAREN[type];
}

export function questionLabel(question: Question): string {
  return `ID: ${question.code}\n${trunc(question.prompt, 60)}\n(${questionTypeParen(question.answer_type)})`;
}

export function questionFullLabel(question: Question): string {
  return `ID: ${question.code}\n${question.prompt}\n(${questionTypeParen(question.answer_type)})`;
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

/**
 * Put retired questions (and the routes that used to reach them) back on
 * a draft graph so the canvas can still draw them.
 *
 * `graph/` omits an archived question once nothing live points at it, so
 * retiring a question and deleting its incoming edges makes the node
 * vanish. The parent graph plus the diff still know both. Ids are the
 * draft-side ones (`draft_id`) so `?question=` from the review list
 * lands on the ghost, and sections are remapped by code so a ghost can
 * sit in the same category box as its live neighbours.
 */
export function withRemovedDraftEntities(
  draft: Graph,
  base: Graph | undefined,
  diff: VersionDiff | undefined,
): Graph {
  if (!draft.version.is_draft || base === undefined || diff === undefined) {
    return draft;
  }

  const draftQuestionIds = new Set(draft.questions.map((question) => question.id));
  const draftCodes = new Set(draft.questions.map((question) => question.code));
  const draftSectionIds = new Set(draft.sections.map((section) => section.id));
  const draftSectionByCode = new Map(
    draft.sections.map((section) => [section.code, section.id]),
  );
  const baseSectionById = new Map(
    base.sections.map((section) => [section.id, section]),
  );
  const baseQuestionById = new Map(
    base.questions.map((question) => [question.id, question]),
  );

  function remapSection(sectionId: UUID | null): UUID | null {
    if (sectionId === null) return null;
    if (draftSectionIds.has(sectionId)) return sectionId;
    const parentSection = baseSectionById.get(sectionId);
    if (parentSection === undefined) return null;
    return draftSectionByCode.get(parentSection.code) ?? null;
  }

  const ghosts: Question[] = [];
  const parentIdToGhostId = new Map<UUID, UUID>();

  for (const item of diff.questions) {
    if (effectiveChange(item) !== "removed") continue;
    if (item.draft_id !== null && draftQuestionIds.has(item.draft_id)) continue;
    const parent =
      item.base_id !== null ? baseQuestionById.get(item.base_id) : undefined;
    if (parent === undefined) continue;
    if (draftCodes.has(parent.code)) continue;
    if (ghosts.some((ghost) => ghost.code === parent.code)) continue;
    const id = item.draft_id ?? parent.id;
    ghosts.push({
      ...parent,
      id,
      section: remapSection(parent.section),
      archived_at: parent.archived_at ?? draft.version.modified,
      diagnostics: null,
    });
    parentIdToGhostId.set(parent.id, id);
  }

  const draftByCode = new Map(
    draft.questions.map((question) => [question.code, question]),
  );

  function remapQuestionId(id: UUID | null): UUID | null {
    if (id === null) return null;
    if (draftQuestionIds.has(id)) return id;
    const ghostId = parentIdToGhostId.get(id);
    if (ghostId !== undefined) return ghostId;
    const parent = baseQuestionById.get(id);
    if (parent !== undefined) {
      const live = draftByCode.get(parent.code);
      if (live !== undefined) return live.id;
    }
    return id;
  }

  const draftEdgeIds = new Set(draft.edges.map((edge) => edge.id));
  const ghostEdges: Edge[] = [];
  const baseEdgeById = new Map(base.edges.map((edge) => [edge.id, edge]));

  for (const item of diff.edges) {
    if (effectiveChange(item) !== "removed") continue;
    const parent = item.base_id !== null ? baseEdgeById.get(item.base_id) : undefined;
    if (parent === undefined) continue;
    const id = item.draft_id ?? parent.id;
    if (draftEdgeIds.has(id) || ghostEdges.some((edge) => edge.id === id)) continue;
    const fromQuestion = remapQuestionId(parent.from_question);
    if (fromQuestion === null) continue;
    ghostEdges.push({
      ...parent,
      id,
      from_question: fromQuestion,
      to_question: remapQuestionId(parent.to_question),
    });
  }

  if (ghosts.length === 0 && ghostEdges.length === 0) return draft;

  return {
    ...draft,
    questions: [...draft.questions, ...ghosts],
    edges: [...draft.edges, ...ghostEdges],
  };
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

/** Answers on `question` that actually take this question-level fallback:
 * anything without a per-option edge of better priority (lower number).
 * Listed in `display_order` so the canvas count and the route sheet agree. */
export function optionsCoveredByFallback(
  question: Question,
  outgoing: readonly Edge[],
  fallback: Edge,
): QuestionOption[] {
  const claimed = new Set(
    outgoing
      .filter((edge) => edge.from_option !== null && edge.priority < fallback.priority)
      .map((edge) => edge.from_option as UUID),
  );
  return [...question.options]
    .sort((a, b) => a.display_order - b.display_order)
    .filter((option) => !claimed.has(option.id));
}

/** Canvas wording for a `from_option === null` arrow. Choice questions
 * show how many listed answers take the route; scale (integer) names
 * the type on the arrow itself; free-text has no list, so it reads as
 * "Any answer". Zero remaining options is the catch-all after every
 * answer already has its own arrow. */
export const INTEGER_ANSWER_EDGE_LABEL = "Number";

export function fallbackCanvasLabel(
  question: Question | undefined,
  outgoing: readonly Edge[],
  fallback: Edge,
): string {
  if (question === undefined) return "Any answer";
  if (question.answer_type === "scale") return INTEGER_ANSWER_EDGE_LABEL;
  if (!CHOICE_ANSWER_TYPES.has(question.answer_type)) return "Any answer";
  const count = optionsCoveredByFallback(question, outgoing, fallback).length;
  if (count === 0) return "Anything else";
  return count === 1 ? "1 choice" : `${count} choices`;
}

export function buildElements(
  graph: Graph,
  diff?: VersionDiff,
  collapsedSectionIds: ReadonlySet<UUID> = new Set(),
): ElementDefinition[] {
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
  const removedEdgeIds = new Set<UUID>();
  if (diff !== undefined) {
    for (const item of diff.edges) {
      if (effectiveChange(item) !== "removed") continue;
      if (item.draft_id !== null) removedEdgeIds.add(item.draft_id);
      if (item.base_id !== null) removedEdgeIds.add(item.base_id);
    }
  }

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

  const questionsInSection = new Map<UUID, Question[]>();
  for (const question of graph.questions) {
    if (question.section === null) continue;
    const list = questionsInSection.get(question.section);
    if (list) list.push(question);
    else questionsInSection.set(question.section, [question]);
  }

  const sectionsById = new Map(graph.sections.map((section) => [section.id, section]));
  for (const [sectionId, members] of questionsInSection) {
    const section = sectionsById.get(sectionId);
    if (section === undefined) continue;
    const collapsed = collapsedSectionIds.has(sectionId);
    const color = sectionColor.get(sectionId) ?? NO_SECTION_COLOR;
    const label = collapsed
      ? `${section.name}\n${members.length} questions`
      : section.name;
    const data: NodeData = {
      id: sectionNodeId(sectionId),
      kind: "section",
      label,
      fullLabel: label,
      prompt: section.description === "" ? section.name : section.description,
      sectionColor: color,
      badgeKind: null,
      isEntry: false,
      isTerminal: false,
      isDecision: false,
      isUnreachable: false,
      hasFault: false,
      changeKind: null,
      sectionAnchorId: null,
      sectionId,
      collapsed,
      questionCount: members.length,
    };
    elements.push({ data, group: "nodes", grabbable: false, pannable: true });
  }

  function endpointFor(questionId: UUID | null): string {
    if (questionId === null) return END_NODE_ID;
    if (!questionsById.has(questionId)) return missingNodeId(questionId);
    const owner = questionsById.get(questionId);
    if (
      owner !== undefined &&
      owner.section !== null &&
      collapsedSectionIds.has(owner.section)
    ) {
      return sectionNodeId(owner.section);
    }
    return questionId;
  }

  for (const question of graph.questions) {
    if (question.section !== null && collapsedSectionIds.has(question.section)) {
      continue;
    }
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
      fullLabel: questionFullLabel(question),
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
      ...(question.section !== null && !collapsedSectionIds.has(question.section)
        ? { parent: sectionNodeId(question.section) }
        : {}),
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
      fullLabel: "Unknown question",
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
      fullLabel: "End of flow",
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

  const outgoingByQuestion = new Map<UUID, Edge[]>();
  for (const edge of graph.edges) {
    const siblings = outgoingByQuestion.get(edge.from_question);
    if (siblings === undefined) outgoingByQuestion.set(edge.from_question, [edge]);
    else siblings.push(edge);
  }

  for (const edge of graph.edges) {
    const source = endpointFor(edge.from_question);
    const target = endpointFor(edge.to_question);
    // An edge that only existed between questions now inside the same
    // collapsed section would be a self-loop on the box. Drop it: the
    // box is the black-box, and those routes are internal.
    if (source === target) continue;
    const sourceQuestion = questionsById.get(edge.from_question);
    const outgoing = outgoingByQuestion.get(edge.from_question) ?? [];
    // Specific options keep their own wording. The question-level
    // fallback used to sit blank so it read as "whatever wasn't one of
    // those"; it now names how many listed answers actually take it
    // ("4 choices"), which is what the right-hand sheet lists on click.
    // Truncated so a long option still fits beside a fanned arrow;
    // hovering the question swaps the native label to `fullGuard` when
    // truncation actually cut the wording.
    const routeLabel =
      edge.from_option === null
        ? fallbackCanvasLabel(sourceQuestion, outgoing, edge)
        : guardLabel(edge, sourceQuestion);
    const data: EdgeData = {
      id: edge.id,
      source,
      target,
      guard: trunc(routeLabel, 32),
      fullGuard: routeLabel,
      priority: edge.priority,
      isDead: deadEdges.has(edge.id),
      isBroken: brokenEdges.has(edge.id),
      isBack: backEdges.has(edge.id),
      changeKind: changeKinds.edges.get(edge.id) ?? null,
      isRemoved: removedEdgeIds.has(edge.id),
    };
    elements.push({ data, group: "edges" });
  }

  return elements;
}
