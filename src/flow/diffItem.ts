import type {
  DiffChange,
  Edge,
  Graph,
  ItemDiff,
  Question,
  QuestionOption,
  Section,
  UUID,
} from "../api/types";

/**
 * What a row means to a reviewer, which is not always what `change` says.
 *
 * `diffing._sides` folds a question's `archived_at` into the comparison as
 * one boolean field, `archived`, beside its prompt and answer type. So
 * retiring a question the draft inherited does not arrive as `removed` --
 * the code still matches on both sides -- but as `changed` with
 * `archived: false -> true`. The backend's own comment on that field says
 * what changed is that the question left the flow, and that is what the
 * review screen says too: a removal, not an edit. The same flip read the
 * other way round (`compare/` can put the archived side first) is a
 * question coming back, which reads as an addition.
 */
export function effectiveChange(item: ItemDiff): DiffChange {
  if (item.kind !== "question" || item.change !== "changed") return item.change;
  const archived = item.fields.find((change) => change.field === "archived");
  if (archived === undefined) return "changed";
  if (archived.draft === true) return "removed";
  if (archived.base === true) return "added";
  return "changed";
}

/** Where a row's subject was found. Only something on the draft graph has
 * a node the map can jump to; the base version is not what the map draws. */
export interface Located<T> {
  value: T;
  /** The graph `value` came from, for looking up whatever it refers to. */
  graph: Graph;
  onMap: boolean;
}

/**
 * The thing a diff row is about: on the draft graph by `draft_id` first,
 * then on the base version's graph by `base_id`.
 *
 * The draft graph cannot name everything the diff mentions. A removed
 * option, edge or section is not in it at all, and `graph/` serves an
 * archived question only while something still points at it
 * (`FLOW_TOOL_PLAN.md` §4.2), so a retired question usually is not either.
 * The base version is the other side of the very comparison the server
 * made (`diffing.compare`), so its graph is where those names still live.
 */
export function locate<T>(
  item: ItemDiff,
  graph: Graph,
  baseGraph: Graph | undefined,
  find: (graph: Graph, id: UUID) => T | undefined,
): Located<T> | undefined {
  if (item.draft_id !== null) {
    const value = find(graph, item.draft_id);
    if (value !== undefined) return { value, graph, onMap: true };
  }
  if (baseGraph !== undefined && item.base_id !== null) {
    const value = find(baseGraph, item.base_id);
    if (value !== undefined) return { value, graph: baseGraph, onMap: false };
  }
  return undefined;
}

export function findQuestion(graph: Graph, id: UUID): Question | undefined {
  return graph.questions.find((question) => question.id === id);
}

export function findSection(graph: Graph, id: UUID): Section | undefined {
  return graph.sections.find((section) => section.id === id);
}

export function findEdge(graph: Graph, id: UUID): Edge | undefined {
  return graph.edges.find((edge) => edge.id === id);
}

export interface OwnedOption {
  option: QuestionOption;
  question: Question;
}

/** An option and the question that offers it. Options are only ever
 * served nested under their question, so this is the one way to reach one
 * by id. */
export function findOption(graph: Graph, id: UUID): OwnedOption | undefined {
  for (const question of graph.questions) {
    const option = question.options.find((candidate) => candidate.id === id);
    if (option !== undefined) return { option, question };
  }
  return undefined;
}
