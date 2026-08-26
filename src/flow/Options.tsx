import { useId, useMemo, useState } from "react";

import { ApiError } from "../api/client";
import {
  useAddEdge,
  useAddOption,
  useRemoveEdge,
  useRemoveOption,
  useUpdateEdge,
  useUpdateOption,
} from "../api/queries";
import { CHOICE_ANSWER_TYPES } from "../api/types";
import type { Edge, Graph, Question, QuestionOption, UUID } from "../api/types";
import { BlockingList } from "./BlockingList";
import { EditorDropdown } from "./EditorDropdown";
import { NO_SECTION_COLOR, sectionColorMap } from "./graphElements";
import { targetLabel } from "./labels";
import { useWriteErrorHandler, writeErrorMessage } from "./useWriteError";

const END_OF_FLOW = "__end__";
const ANY_ANSWER = "__any__";

interface OptionsProps {
  graph: Graph;
  question: Question;
  editable: boolean;
  retargetingEdgeId: UUID | null;
  addingRouteOptionId: UUID | null;
  onSelectQuestion: (id: UUID) => void;
  onStartRetarget: (edgeId: UUID, label: string) => void;
  onStartAddRoute: (questionId: UUID, optionId: UUID | null, label: string) => void;
  onCancelPick: () => void;
}

/** Read-only data every route row needs, bundled so it isn't six separate
 * props on every card. Computed once per render in `Options`, not per
 * card. */
interface EdgeContext {
  questionsById: ReadonlyMap<UUID, Question>;
  sectionColors: ReadonlyMap<UUID, string>;
  targets: Question[];
  deadEdges: ReadonlySet<UUID>;
  brokenEdges: ReadonlySet<UUID>;
}

/** One route's destination chip and its "Change destination" popup
 * (shown whenever `editable` -- it acts immediately and isn't
 * destructive, so there's no need to hide it behind a confirmation
 * step), and -- only once the card it lives in is opened for editing via
 * `expanded` -- its remove control, destructive enough to want that
 * extra step. Ported from break-backend's own destination picker
 * (question_graph_editor/app.js's `openDestinationPicker`): one
 * plain-language "what should happen after this answer" popup instead of
 * separate Retarget/Clear-jump/End buttons competing for space on the
 * row. */
function EdgeRow({
  versionId,
  edge,
  selectLabel,
  ctx,
  editable,
  expanded,
  disabled,
  retargetingEdgeId,
  hasFallback,
  onEditText,
  onSelectQuestion,
  onStartRetarget,
  onCancelPick,
}: {
  versionId: UUID;
  edge: Edge;
  /** Names what this row routes, e.g. `Where "Yes" leads` -- the row
   * itself carries no visible label of its own (that lives once, on the
   * card it's nested in). Doubles as the retarget banner's context text. */
  selectLabel: string;
  ctx: EdgeContext;
  editable: boolean;
  /** Whether the card this row lives in has its own "Edit" toggle open --
   * gates only Remove, not "Change destination". */
  expanded: boolean;
  disabled: boolean;
  /** The edge currently mid-retarget (clicking a question on the canvas
   * sets its target), if any. Compared by id rather than passing a
   * boolean so only the one row involved re-renders into its "Cancel"
   * state. */
  retargetingEdgeId: UUID | null;
  /** Whether this row's question has a default route (question-level
   * edge) -- offers a one-click way to delete a per-option edge in favour
   * of it, instead of "Remove" (behind Edit) plus knowing that's what an
   * empty card does. `false` for `EdgeGroupCard`'s rows: removing the
   * default route itself doesn't fall through to itself. */
  hasFallback: boolean;
  /** Present only for an answer's own row (`OptionCard`) -- there's no
   * text to rename on the default-route or dead-guard groups, so those
   * callers leave it out and "Edit text" doesn't render. */
  onEditText?: (() => void) | undefined;
  onSelectQuestion: (id: UUID) => void;
  onStartRetarget: (edgeId: UUID, label: string) => void;
  onCancelPick: () => void;
}) {
  const onWriteError = useWriteErrorHandler();
  const updateEdge = useUpdateEdge(versionId);
  const removeEdge = useRemoveEdge(versionId);

  const pending = updateEdge.isPending || removeEdge.isPending || disabled;
  const error =
    writeErrorMessage(updateEdge.error) ?? writeErrorMessage(removeEdge.error);

  const isDead = ctx.deadEdges.has(edge.id);
  const isBroken = ctx.brokenEdges.has(edge.id);
  const isRetargeting = retargetingEdgeId === edge.id;
  const targetQuestion =
    edge.to_question !== null ? ctx.questionsById.get(edge.to_question) : undefined;
  const targetColor =
    targetQuestion?.section != null
      ? (ctx.sectionColors.get(targetQuestion.section) ?? NO_SECTION_COLOR)
      : NO_SECTION_COLOR;

  return (
    <div className="edge-row">
      <div
        className={edge.to_question === null ? "opt-dest terminal-dest" : "opt-dest"}
      >
        <span className="arrow" aria-hidden="true">
          {edge.to_question === null ? "⏹" : "↘"}
        </span>
        {edge.to_question !== null && (
          <span className="dest-sw" style={{ background: targetColor }} />
        )}
        <span className="dest-txt">
          {edge.to_question !== null && ctx.questionsById.has(edge.to_question) ? (
            <button
              type="button"
              className="link"
              onClick={() => onSelectQuestion(edge.to_question as UUID)}
            >
              {targetLabel(edge, ctx.questionsById)}
            </button>
          ) : (
            targetLabel(edge, ctx.questionsById)
          )}
        </span>
      </div>

      {isBroken && (
        <p className="edges__fault">
          This route leads to a question that has been archived or removed, so it would
          fail instead of continuing.
        </p>
      )}
      {isDead && (
        <p className="edges__fault">
          This route is tied to an answer that is not one of this question's options
          anymore, so it can never happen.
        </p>
      )}

      {editable && isRetargeting && (
        <p className="panel__hint" role="status">
          Click a question on the canvas to send this route there, or press Esc to
          cancel.
        </p>
      )}

      {editable && (
        <div className="opt-edit-row">
          {isRetargeting ? (
            <button
              type="button"
              className="opt-edit-btn active"
              disabled={pending}
              onClick={onCancelPick}
            >
              Cancel retarget
            </button>
          ) : (
            <EditorDropdown
              trigger={<span className="opt-edit-btn">Change destination</span>}
              disabled={pending}
            >
              {(close) => (
                <div className="destination-choices">
                  <p className="panel__hint">What should happen after this answer?</p>
                  <button
                    type="button"
                    className="opt-edit-btn"
                    onClick={() => {
                      onStartRetarget(edge.id, selectLabel);
                      close();
                    }}
                  >
                    Jump to a specific question
                  </button>
                  {edge.from_option !== null && hasFallback && (
                    <button
                      type="button"
                      className="opt-edit-btn"
                      onClick={() => {
                        removeEdge.mutate(edge.id, { onError: onWriteError });
                        close();
                      }}
                    >
                      Use the default route instead
                    </button>
                  )}
                  <button
                    type="button"
                    className="opt-edit-btn danger"
                    disabled={edge.to_question === null}
                    onClick={() => {
                      updateEdge.mutate(
                        { edgeId: edge.id, changes: { to_question: null } },
                        { onError: onWriteError },
                      );
                      close();
                    }}
                  >
                    End the flow here
                  </button>
                </div>
              )}
            </EditorDropdown>
          )}
          {onEditText && (
            <button
              type="button"
              className="opt-edit-btn"
              disabled={pending}
              onClick={onEditText}
            >
              Edit text
            </button>
          )}
          {expanded && (
            <button
              type="button"
              className="opt-edit-btn danger"
              disabled={pending}
              onClick={() => removeEdge.mutate(edge.id, { onError: onWriteError })}
            >
              Remove
            </button>
          )}
        </div>
      )}

      {error !== null && (
        <p className="banner banner--error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** A collapsed reveal for a block of routes that has no label/code of its
 * own to edit -- today just "Can't be used" (dead-guard edges; the
 * question-level route has its own dedicated `DefaultRouteSection`
 * instead, since it isn't one more answer). An Edit/Done toggle around
 * the same `EdgeRow` Remove control `OptionCard` gates the same way
 * ("Change destination" shows regardless, per `EdgeRow`'s own doc
 * comment). */
function EdgeGroupCard({
  heading,
  note,
  versionId,
  edges,
  ctx,
  selectLabel,
  editable,
  disabled,
  retargetingEdgeId,
  onSelectQuestion,
  onStartRetarget,
  onCancelPick,
}: {
  heading: string;
  note?: string;
  versionId: UUID;
  edges: Edge[];
  ctx: EdgeContext;
  selectLabel: string;
  editable: boolean;
  disabled: boolean;
  retargetingEdgeId: UUID | null;
  onSelectQuestion: (id: UUID) => void;
  onStartRetarget: (edgeId: UUID, label: string) => void;
  onCancelPick: () => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <li className="opt">
      <div className="opt-label">
        <span>{heading}</span>
        {editable && (
          <button
            type="button"
            className="opt-edit-btn d-edit-btn"
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </div>
      {note !== undefined && <p className="options__fault">{note}</p>}
      <div className="opt-edges">
        {edges.map((edge) => (
          <EdgeRow
            key={edge.id}
            versionId={versionId}
            edge={edge}
            selectLabel={selectLabel}
            ctx={ctx}
            editable={editable}
            expanded={editing}
            disabled={disabled}
            retargetingEdgeId={retargetingEdgeId}
            hasFallback={false}
            onSelectQuestion={onSelectQuestion}
            onStartRetarget={onStartRetarget}
            onCancelPick={onCancelPick}
          />
        ))}
      </div>
    </li>
  );
}

/** The question-level route (`from_option === null`) -- the one any answer
 * uses when it has no explicit route of its own, below. Sits first inside
 * the Options section, ahead of the answer list, but is deliberately not
 * one more `<li>` in `.opt-list`: it isn't an answer, it's a configuration
 * that applies across all of them, so it gets its own callout-styled
 * block (`.fallback-section`) instead -- outside `Options`' own answer
 * count, with its own explanation of what it means. Owns its own "+ Add a
 * default route" form (only shown once this question has none yet -- the
 * server allows only one) rather than sharing `Options`' "+ Add an
 * answer" one, since the two no longer have anything to do with each
 * other. */
function DefaultRouteSection({
  versionId,
  questionId,
  takesOptions,
  edges,
  ctx,
  editable,
  disabled,
  retargetingEdgeId,
  onSelectQuestion,
  onStartRetarget,
  onCancelPick,
}: {
  versionId: UUID;
  questionId: UUID;
  takesOptions: boolean;
  edges: Edge[];
  ctx: EdgeContext;
  editable: boolean;
  disabled: boolean;
  retargetingEdgeId: UUID | null;
  onSelectQuestion: (id: UUID) => void;
  onStartRetarget: (edgeId: UUID, label: string) => void;
  onCancelPick: () => void;
}) {
  const onWriteError = useWriteErrorHandler();
  const addEdge = useAddEdge(versionId);
  const addTargetId = useId();
  const [editing, setEditing] = useState(false);
  const [addingEdge, setAddingEdge] = useState(false);
  const [newTarget, setNewTarget] = useState<string>(END_OF_FLOW);

  return (
    <div className="fallback-section">
      <div className="opt-label">
        <span>
          <span className="fallback-section__icon" aria-hidden="true">
            ⚙
          </span>{" "}
          Default route
        </span>
        {editable && edges.length > 0 && (
          <button
            type="button"
            className="opt-edit-btn d-edit-btn"
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </div>
      <p className="panel__hint">
        {takesOptions
          ? "The route used by any answer without one of its own -- an answer with an explicit route configured above always takes that instead."
          : "This route applies no matter what's answered."}
      </p>

      {edges.length > 0 && (
        <div className="opt-edges">
          {edges.map((edge) => (
            <EdgeRow
              key={edge.id}
              versionId={versionId}
              edge={edge}
              selectLabel="Where the default route leads"
              ctx={ctx}
              editable={editable}
              expanded={editing}
              disabled={disabled}
              retargetingEdgeId={retargetingEdgeId}
              hasFallback={false}
              onSelectQuestion={onSelectQuestion}
              onStartRetarget={onStartRetarget}
              onCancelPick={onCancelPick}
            />
          ))}
        </div>
      )}

      {editable && edges.length === 0 && (
        <>
          {addingEdge ? (
            <form
              className="editor"
              onSubmit={(event) => {
                event.preventDefault();
                addEdge.mutate(
                  {
                    from_question: questionId,
                    from_option: null,
                    to_question: newTarget === END_OF_FLOW ? null : newTarget,
                  },
                  {
                    onError: onWriteError,
                    onSuccess: () => {
                      setNewTarget(END_OF_FLOW);
                      setAddingEdge(false);
                    },
                  },
                );
              }}
            >
              <div className="field field--inline">
                <label htmlFor={addTargetId}>Go to</label>
                <select
                  id={addTargetId}
                  value={newTarget}
                  disabled={addEdge.isPending || disabled}
                  onChange={(event) => setNewTarget(event.target.value)}
                >
                  <option value={END_OF_FLOW}>End of flow</option>
                  {ctx.targets.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.code}
                    </option>
                  ))}
                </select>
              </div>
              <div className="editor__actions">
                <button
                  className="button button--primary"
                  type="submit"
                  disabled={addEdge.isPending || disabled}
                >
                  Add route
                </button>
                <button
                  className="button button--quiet"
                  type="button"
                  disabled={addEdge.isPending || disabled}
                  onClick={() => setAddingEdge(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              className="button button--quiet"
              type="button"
              onClick={() => setAddingEdge(true)}
            >
              {takesOptions ? "+ Add a default route" : "+ Add a route"}
            </button>
          )}
          {writeErrorMessage(addEdge.error) !== null && (
            <p className="banner banner--error" role="alert">
              {writeErrorMessage(addEdge.error)}
            </p>
          )}
        </>
      )}
    </div>
  );
}

interface OptionCardProps {
  versionId: UUID;
  questionId: UUID;
  option: QuestionOption;
  edges: Edge[];
  ctx: EdgeContext;
  isUncovered: boolean;
  /** Whether this question has a default route (question-level edge) --
   * passed down to each of this answer's `EdgeRow`s so they can offer a
   * one-click "use it instead" in place of that edge. */
  hasFallback: boolean;
  isGuard: boolean;
  editable: boolean;
  disabled: boolean;
  retargetingEdgeId: UUID | null;
  /** Non-null (and equal to this card's `option.id`) while a new route
   * for this answer is mid-add on the canvas. */
  addingRouteOptionId: UUID | null;
  onSelectQuestion: (id: UUID) => void;
  onStartRetarget: (edgeId: UUID, label: string) => void;
  onStartAddRoute: (questionId: UUID, optionId: UUID | null, label: string) => void;
  onCancelPick: () => void;
}

/** One answer, one card: what it's called, what leads from it, and (when
 * editable) every control for both. Label/code rename and delete stay
 * collapsed behind one "Edit text" until asked for, matching
 * `QuestionEditor`'s own text-edit toggle; so does a route's own Remove
 * (see `EdgeRow`). "Change destination" and adding a new route for this
 * answer do not -- they act immediately and aren't destructive, so hiding
 * them behind Edit would just be an extra click for no protection.
 * Combines what were three separate places (a read-only Options list, a
 * separate "Edit options" form, and `EdgeEditor`'s own "Outgoing edges"
 * list) into the one place somebody actually thinks about an answer:
 * together with where it goes. */
function OptionCard({
  versionId,
  questionId,
  option,
  edges,
  ctx,
  isUncovered,
  hasFallback,
  isGuard,
  editable,
  disabled,
  retargetingEdgeId,
  addingRouteOptionId,
  onSelectQuestion,
  onStartRetarget,
  onStartAddRoute,
  onCancelPick,
}: OptionCardProps) {
  const onWriteError = useWriteErrorHandler();
  const updateOption = useUpdateOption(versionId);
  const removeOption = useRemoveOption(versionId);

  const labelId = useId();
  const codeId = useId();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(option.label);
  const [code, setCode] = useState(option.code);
  const isAddingRoute = addingRouteOptionId === option.id;

  const dirty = label !== option.label || code !== option.code;
  const pending = updateOption.isPending || removeOption.isPending || disabled;
  const error =
    writeErrorMessage(updateOption.error) ?? writeErrorMessage(removeOption.error);
  // Named, not just counted: `editing.OptionGuardedError.detail_payload`
  // lists the actual edges a delete would strand, so the refusal is
  // somewhere to click through to rather than a number to go hunting for.
  const blockingEdges =
    removeOption.error instanceof ApiError ? removeOption.error.blockingEdges : null;

  function cancel() {
    setLabel(option.label);
    setCode(option.code);
    setEditing(false);
  }

  return (
    <li className="opt">
      {editing ? (
        <div className="optedit__fields">
          <div className="field field--inline">
            <label htmlFor={labelId}>Label</label>
            <input
              id={labelId}
              value={label}
              disabled={pending}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <div className="field field--inline">
            <label htmlFor={codeId}>Code</label>
            <input
              id={codeId}
              value={code}
              disabled={pending}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
        </div>
      ) : (
        <div className="opt-label">
          <span>{option.label}</span>{" "}
          <code className="options__code">{option.code}</code>
        </div>
      )}

      {isUncovered && (
        <p className="options__fault">
          No route covers this answer yet, so choosing it ends the flow.
        </p>
      )}

      {editing && (
        <>
          <div className="optedit__controls">
            <button
              className="opt-edit-btn active"
              type="button"
              disabled={pending || !dirty}
              onClick={() =>
                updateOption.mutate(
                  {
                    optionId: option.id,
                    // Only what moved: an absent key stays absent from
                    // `validated_data`, and the code of an inherited option is
                    // refused outright, so sending an unchanged one would turn
                    // a label edit into a refusal.
                    changes: {
                      ...(label !== option.label ? { label } : {}),
                      ...(code !== option.code ? { code } : {}),
                    },
                  },
                  { onError: onWriteError, onSuccess: () => setEditing(false) },
                )
              }
            >
              Save
            </button>
            <button
              className="opt-edit-btn danger"
              type="button"
              disabled={pending || isGuard}
              title={
                isGuard
                  ? "A route still uses this answer. Deleting it would break that route without warning, so remove the route first."
                  : undefined
              }
              onClick={() => removeOption.mutate(option.id, { onError: onWriteError })}
            >
              Delete
            </button>
            <button
              className="opt-edit-btn"
              type="button"
              disabled={pending}
              onClick={cancel}
            >
              Cancel
            </button>
          </div>

          {isGuard && (
            // Refused rather than cascaded, and the edge may leave another
            // question entirely -- the dead-edge case the draft copy
            // deliberately preserves.
            <p className="panel__hint">
              A route still uses this answer, so it can't be deleted yet. Remove that
              route first.
            </p>
          )}
        </>
      )}

      {error !== null && (
        <div className="banner banner--error" role="alert">
          <p>{error}</p>
          {blockingEdges !== null && blockingEdges.length > 0 && (
            <BlockingList
              items={blockingEdges.map((item) => ({
                questionId: item.fromQuestionId,
                code: item.fromQuestionCode,
                prompt: item.fromQuestionPrompt,
              }))}
              onSelectQuestion={onSelectQuestion}
            />
          )}
        </div>
      )}

      {edges.length > 0 && (
        <div className="opt-edges">
          {edges.map((edge) => (
            <EdgeRow
              key={edge.id}
              versionId={versionId}
              edge={edge}
              selectLabel={`Where "${option.label}" leads`}
              ctx={ctx}
              editable={editable}
              expanded={editing}
              disabled={disabled}
              retargetingEdgeId={retargetingEdgeId}
              hasFallback={hasFallback}
              onEditText={editing ? undefined : () => setEditing(true)}
              onSelectQuestion={onSelectQuestion}
              onStartRetarget={onStartRetarget}
              onCancelPick={onCancelPick}
            />
          ))}
        </div>
      )}

      {editable && edges.length === 0 && (
        <div className="opt-add-edge">
          {isAddingRoute && (
            <p className="panel__hint" role="status">
              Click a question on the canvas to route this answer there, or press Esc to
              cancel.
            </p>
          )}
          <div className="opt-edit-row">
            {isAddingRoute ? (
              <button
                type="button"
                className="opt-edit-btn active"
                onClick={onCancelPick}
              >
                Cancel specific route
              </button>
            ) : (
              <button
                type="button"
                className="opt-edit-btn"
                disabled={disabled}
                onClick={() =>
                  onStartAddRoute(
                    questionId,
                    option.id,
                    `"${option.label}"'s new route`,
                  )
                }
              >
                Add a specific route
              </button>
            )}
            {!editing && (
              <button
                type="button"
                className="opt-edit-btn"
                onClick={() => setEditing(true)}
              >
                Edit text
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

export function Options({
  graph,
  question,
  editable,
  retargetingEdgeId,
  addingRouteOptionId,
  onSelectQuestion,
  onStartRetarget,
  onStartAddRoute,
  onCancelPick,
}: OptionsProps) {
  const versionId = graph.version.id;
  const onWriteError = useWriteErrorHandler();
  const addOption = useAddOption(versionId);

  const optionCodeId = useId();
  const optionLabelId = useId();
  const [addingOption, setAddingOption] = useState(false);
  const [newOptionCode, setNewOptionCode] = useState("");
  const [newOptionLabel, setNewOptionLabel] = useState("");

  const options = useMemo(
    () =>
      [...question.options].sort(
        (left, right) => left.display_order - right.display_order,
      ),
    [question.options],
  );

  const uncovered = useMemo(
    () => new Set(question.diagnostics?.uncovered_option_ids ?? []),
    [question.diagnostics],
  );

  // Guards from anywhere in the version, not just from this question. An
  // edge leaving another question can be guarded by an option this one
  // owns -- that is precisely the dead edge the map reports -- and the
  // delete refusal covers both.
  const guardOptionIds = useMemo(
    () =>
      new Set(
        graph.edges
          .map((edge) => edge.from_option)
          .filter((optionId): optionId is UUID => optionId !== null),
      ),
    [graph.edges],
  );

  // Nothing selects an option on a free-text or scale question, so the
  // server refuses adding one: the row would be inert, and the only thing
  // it could become is the dead-edge report the map exists to flag.
  const takesOptions = CHOICE_ANSWER_TYPES.has(question.answer_type);

  const questionsById = useMemo(
    () => new Map(graph.questions.map((item) => [item.id, item])),
    [graph.questions],
  );
  const sectionColors = useMemo(
    () => sectionColorMap(graph.sections),
    [graph.sections],
  );
  const targets = useMemo(
    () =>
      graph.questions
        .filter((candidate) => candidate.archived_at === null)
        .sort((left, right) => left.display_order - right.display_order),
    [graph.questions],
  );
  const deadEdges = useMemo(
    () => new Set(graph.diagnostics.dead_edge_ids),
    [graph.diagnostics.dead_edge_ids],
  );
  const brokenEdges = useMemo(
    () => new Set(graph.diagnostics.broken_edge_ids),
    [graph.diagnostics.broken_edge_ids],
  );
  const ctx: EdgeContext = {
    questionsById,
    sectionColors,
    targets,
    deadEdges,
    brokenEdges,
  };

  const edges = useMemo(
    () =>
      graph.edges
        .filter((edge) => edge.from_question === question.id)
        .sort((left, right) => left.priority - right.priority),
    [graph.edges, question.id],
  );

  // Edges grouped by the option that guards them, "anything else"
  // (question-level edges, and every edge on a type that offers no
  // per-option guard) under its own bucket. A specific option's guard and
  // the question-level fallback can both match the same real answer, so
  // `edges` stays priority-sorted within each bucket -- which one fires
  // first inside a bucket is still real, even though the grouping itself
  // is presentational.
  const edgesByGuard = useMemo(() => {
    const map = new Map<string, Edge[]>();
    for (const edge of edges) {
      const key = edge.from_option ?? ANY_ANSWER;
      const list = map.get(key);
      if (list) list.push(edge);
      else map.set(key, [edge]);
    }
    return map;
  }, [edges]);

  const anyAnswerEdges = edgesByGuard.get(ANY_ANSWER) ?? [];

  // A dead edge is guarded by an option this question doesn't offer (it
  // belongs to a different question entirely) -- exactly the one guard
  // key `edgesByGuard` can hold that never matches an id in `options`.
  // Grouping strictly by this question's own options would make those
  // edges vanish from the panel instead of just failing to route, so
  // anything left over after every real option and "anything else" gets
  // its card is swept into one more, rather than silently dropped.
  const optionIds = useMemo(
    () => new Set(options.map((option) => option.id)),
    [options],
  );
  const deadGuardEdges = useMemo(
    () =>
      edges.filter(
        (edge) => edge.from_option !== null && !optionIds.has(edge.from_option),
      ),
    [edges, optionIds],
  );

  const pending = addOption.isPending;
  const error = writeErrorMessage(addOption.error);

  const cardCount = options.length + (deadGuardEdges.length > 0 ? 1 : 0);

  return (
    <section className="panel__section" aria-labelledby="options-heading">
      <h3 id="options-heading" className="d-sub">
        Options <span className="count">{cardCount}</span>
      </h3>
      <p className="panel__hint">
        Where each answer leads. If more than one route could apply, the first one
        listed wins; otherwise the flow ends there. Jumping a route to a specific
        question, or adding one for a specific answer, happens on the canvas: click
        "Change destination" → "Jump to a specific question", or "Add a specific route"
        below, then click the destination question.
      </p>

      {(anyAnswerEdges.length > 0 || editable) && (
        <DefaultRouteSection
          versionId={versionId}
          questionId={question.id}
          takesOptions={takesOptions}
          edges={anyAnswerEdges}
          ctx={ctx}
          editable={editable}
          disabled={pending}
          retargetingEdgeId={retargetingEdgeId}
          onSelectQuestion={onSelectQuestion}
          onStartRetarget={onStartRetarget}
          onCancelPick={onCancelPick}
        />
      )}

      {options.length === 0 && deadGuardEdges.length === 0 ? (
        anyAnswerEdges.length === 0 && (
          <p className="empty">
            {takesOptions
              ? "This question has no answers yet."
              : "Nothing leads anywhere yet, so answering this question ends the flow."}
          </p>
        )
      ) : (
        <ul className="opt-list">
          {options.map((option) => (
            <OptionCard
              key={option.id}
              versionId={versionId}
              questionId={question.id}
              option={option}
              edges={edgesByGuard.get(option.id) ?? []}
              ctx={ctx}
              isUncovered={uncovered.has(option.id)}
              hasFallback={anyAnswerEdges.length > 0}
              isGuard={guardOptionIds.has(option.id)}
              editable={editable}
              disabled={pending}
              retargetingEdgeId={retargetingEdgeId}
              addingRouteOptionId={addingRouteOptionId}
              onSelectQuestion={onSelectQuestion}
              onStartRetarget={onStartRetarget}
              onStartAddRoute={onStartAddRoute}
              onCancelPick={onCancelPick}
            />
          ))}

          {deadGuardEdges.length > 0 && (
            <EdgeGroupCard
              heading="Can't be used"
              note="Tied to an answer this question doesn't have anymore, so these can never happen -- only removed."
              versionId={versionId}
              edges={deadGuardEdges}
              ctx={ctx}
              selectLabel="Where this route leads"
              editable={editable}
              disabled={pending}
              retargetingEdgeId={retargetingEdgeId}
              onSelectQuestion={onSelectQuestion}
              onStartRetarget={onStartRetarget}
              onCancelPick={onCancelPick}
            />
          )}
        </ul>
      )}

      {editable && (
        <div className="options-add">
          {takesOptions ? (
            addingOption ? (
              <form
                className="editor"
                onSubmit={(event) => {
                  event.preventDefault();
                  addOption.mutate(
                    {
                      question: question.id,
                      code: newOptionCode,
                      label: newOptionLabel,
                    },
                    {
                      onError: onWriteError,
                      onSuccess: () => {
                        setNewOptionCode("");
                        setNewOptionLabel("");
                        setAddingOption(false);
                      },
                    },
                  );
                }}
              >
                <div className="field field--inline">
                  <label htmlFor={optionLabelId}>Label</label>
                  <input
                    id={optionLabelId}
                    value={newOptionLabel}
                    required
                    placeholder="What a respondent reads"
                    disabled={pending}
                    onChange={(event) => setNewOptionLabel(event.target.value)}
                  />
                </div>
                <div className="field field--inline">
                  <label htmlFor={optionCodeId}>Code</label>
                  <input
                    id={optionCodeId}
                    value={newOptionCode}
                    required
                    placeholder="Stable identifier"
                    disabled={pending}
                    onChange={(event) => setNewOptionCode(event.target.value)}
                  />
                </div>
                <div className="editor__actions">
                  <button
                    className="button button--primary"
                    type="submit"
                    disabled={
                      pending ||
                      newOptionCode.trim() === "" ||
                      newOptionLabel.trim() === ""
                    }
                  >
                    {addOption.isPending ? "Adding…" : "Add option"}
                  </button>
                  <button
                    className="button button--quiet"
                    type="button"
                    disabled={pending}
                    onClick={() => setAddingOption(false)}
                  >
                    Cancel
                  </button>
                </div>
                {/* Appended, never inserted: a unique constraint on
                    (question, display_order) makes an insertion a renumbering,
                    which is what the up/down controls above do. */}
                <p className="panel__hint">
                  Added last. A new answer with no route yet just ends the flow if
                  picked -- that's fine, and it's not refused, because answers are added
                  before the routes that lead from them.
                </p>
              </form>
            ) : (
              <button
                className="button button--quiet"
                type="button"
                onClick={() => setAddingOption(true)}
              >
                + Add an answer
              </button>
            )
          ) : (
            <p className="panel__hint">
              This question's answers don't use separate options -- like a written
              response or a number -- so there's nothing to add here.
            </p>
          )}
        </div>
      )}

      {error !== null && (
        <p className="banner banner--error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
