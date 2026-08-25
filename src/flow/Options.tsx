import { useId, useMemo, useState } from "react";

import { ApiError } from "../api/client";
import {
  useAddEdge,
  useAddOption,
  useRemoveEdge,
  useRemoveOption,
  useReorderEdges,
  useReorderOptions,
  useUpdateEdge,
  useUpdateOption,
} from "../api/queries";
import { CHOICE_ANSWER_TYPES } from "../api/types";
import type { Edge, Graph, Question, QuestionOption, UUID } from "../api/types";
import { BlockingList } from "./BlockingList";
import { NO_SECTION_COLOR, sectionColorMap } from "./graphElements";
import { optionLabel, targetLabel } from "./labels";
import { useWriteErrorHandler, writeErrorMessage } from "./useWriteError";

const END_OF_FLOW = "__end__";
const ANY_ANSWER = "__any__";

interface OptionsProps {
  graph: Graph;
  question: Question;
  editable: boolean;
  onSelectQuestion: (id: UUID) => void;
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

/** One route's destination chip + (when `editable` and the card it lives
 * in is open for editing) its retarget/move/remove controls. The select
 * and buttons here act immediately -- there is no draft/Save step for a
 * route the way there is for an option's label/code -- so showing or
 * hiding this block is purely about not cluttering the read view, not
 * about protecting unsaved work. */
function EdgeRow({
  versionId,
  edge,
  selectLabel,
  allEdges,
  ctx,
  editable,
  disabled,
  onMoveEdge,
  onSelectQuestion,
}: {
  versionId: UUID;
  edge: Edge;
  /** Full accessible name for the retarget select, e.g. `Where "Yes"
   * leads` -- the row itself carries no visible label of its own (that
   * lives once, on the card it's nested in). */
  selectLabel: string;
  allEdges: Edge[];
  ctx: EdgeContext;
  editable: boolean;
  disabled: boolean;
  onMoveEdge: (edge: Edge, direction: -1 | 1) => void;
  onSelectQuestion: (id: UUID) => void;
}) {
  const onWriteError = useWriteErrorHandler();
  const updateEdge = useUpdateEdge(versionId);
  const removeEdge = useRemoveEdge(versionId);

  const index = allEdges.findIndex((candidate) => candidate.id === edge.id);
  const pending = updateEdge.isPending || removeEdge.isPending || disabled;
  const error =
    writeErrorMessage(updateEdge.error) ?? writeErrorMessage(removeEdge.error);

  const isDead = ctx.deadEdges.has(edge.id);
  const isBroken = ctx.brokenEdges.has(edge.id);
  const targetQuestion =
    edge.to_question !== null ? ctx.questionsById.get(edge.to_question) : undefined;
  const targetColor =
    targetQuestion?.section != null
      ? (ctx.sectionColors.get(targetQuestion.section) ?? NO_SECTION_COLOR)
      : NO_SECTION_COLOR;

  return (
    <div className="edge-row">
      <div className={edge.to_question === null ? "opt-dest terminal-dest" : "opt-dest"}>
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

      {editable && (
        <div className="opt-edit-row">
          <select
            aria-label={selectLabel}
            value={edge.to_question ?? END_OF_FLOW}
            disabled={pending}
            onChange={(event) =>
              updateEdge.mutate(
                {
                  edgeId: edge.id,
                  changes: {
                    to_question:
                      event.target.value === END_OF_FLOW ? null : event.target.value,
                  },
                },
                { onError: onWriteError },
              )
            }
          >
            <option value={END_OF_FLOW}>End of flow</option>
            {ctx.targets.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.code}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="opt-edit-btn"
            disabled={pending || index <= 0}
            onClick={() => onMoveEdge(edge, -1)}
          >
            Move up
          </button>
          <button
            type="button"
            className="opt-edit-btn"
            disabled={pending || index < 0 || index >= allEdges.length - 1}
            onClick={() => onMoveEdge(edge, 1)}
          >
            Move down
          </button>
          <button
            type="button"
            className="opt-edit-btn danger"
            disabled={pending}
            onClick={() => removeEdge.mutate(edge.id, { onError: onWriteError })}
          >
            Remove
          </button>
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
 * own to edit ("Any answer", "Can't be used") -- just an Edit/Done toggle
 * around the same live-acting `EdgeRow` controls `OptionCard` gates
 * behind its own Edit. */
function EdgeGroupCard({
  heading,
  note,
  versionId,
  edges,
  allEdges,
  ctx,
  selectLabel,
  editable,
  disabled,
  onMoveEdge,
  onSelectQuestion,
}: {
  heading: string;
  note?: string;
  versionId: UUID;
  edges: Edge[];
  allEdges: Edge[];
  ctx: EdgeContext;
  selectLabel: string;
  editable: boolean;
  disabled: boolean;
  onMoveEdge: (edge: Edge, direction: -1 | 1) => void;
  onSelectQuestion: (id: UUID) => void;
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
            allEdges={allEdges}
            ctx={ctx}
            editable={editable && editing}
            disabled={disabled}
            onMoveEdge={onMoveEdge}
            onSelectQuestion={onSelectQuestion}
          />
        ))}
      </div>
    </li>
  );
}

interface OptionCardProps {
  versionId: UUID;
  option: QuestionOption;
  edges: Edge[];
  allEdges: Edge[];
  ctx: EdgeContext;
  isUncovered: boolean;
  isGuard: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveOption: (direction: -1 | 1) => void;
  onMoveEdge: (edge: Edge, direction: -1 | 1) => void;
  editable: boolean;
  disabled: boolean;
  onSelectQuestion: (id: UUID) => void;
}

/** One answer, one card: what it's called, what leads from it, and (when
 * editable) every control for both -- label/code, reorder, delete, and
 * per-route retarget/reorder/remove -- collapsed behind one "Edit" until
 * asked for, matching `QuestionEditor`'s own text-edit toggle rather than
 * showing every control on every card at once. Combines what were three
 * separate places (a read-only Options list, a separate "Edit options"
 * form, and `EdgeEditor`'s own "Outgoing edges" list) into the one place
 * somebody actually thinks about an answer: together with where it goes. */
function OptionCard({
  versionId,
  option,
  edges,
  allEdges,
  ctx,
  isUncovered,
  isGuard,
  canMoveUp,
  canMoveDown,
  onMoveOption,
  onMoveEdge,
  editable,
  disabled,
  onSelectQuestion,
}: OptionCardProps) {
  const onWriteError = useWriteErrorHandler();
  const updateOption = useUpdateOption(versionId);
  const removeOption = useRemoveOption(versionId);

  const labelId = useId();
  const codeId = useId();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(option.label);
  const [code, setCode] = useState(option.code);

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
          <span>{option.label}</span> <code className="options__code">{option.code}</code>
          {editable && (
            <button
              type="button"
              className="opt-edit-btn d-edit-btn"
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
          )}
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
              className="opt-edit-btn"
              type="button"
              disabled={pending || !canMoveUp}
              onClick={() => onMoveOption(-1)}
            >
              Move up
            </button>
            <button
              className="opt-edit-btn"
              type="button"
              disabled={pending || !canMoveDown}
              onClick={() => onMoveOption(1)}
            >
              Move down
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
              allEdges={allEdges}
              ctx={ctx}
              editable={editable && editing}
              disabled={disabled}
              onMoveEdge={onMoveEdge}
              onSelectQuestion={onSelectQuestion}
            />
          ))}
        </div>
      )}
    </li>
  );
}

export function Options({ graph, question, editable, onSelectQuestion }: OptionsProps) {
  const versionId = graph.version.id;
  const onWriteError = useWriteErrorHandler();
  const addOption = useAddOption(versionId);
  const reorderOptions = useReorderOptions(versionId);
  const addEdge = useAddEdge(versionId);
  const reorderEdges = useReorderEdges(versionId);

  const optionCodeId = useId();
  const optionLabelId = useId();
  const [addingOption, setAddingOption] = useState(false);
  const [newOptionCode, setNewOptionCode] = useState("");
  const [newOptionLabel, setNewOptionLabel] = useState("");

  const addGuardId = useId();
  const addTargetId = useId();
  const [addingEdge, setAddingEdge] = useState(false);
  const [newGuard, setNewGuard] = useState<string>(ANY_ANSWER);
  const [newTarget, setNewTarget] = useState<string>(END_OF_FLOW);

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
  const sectionColors = useMemo(() => sectionColorMap(graph.sections), [graph.sections]);
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
  const ctx: EdgeContext = { questionsById, sectionColors, targets, deadEdges, brokenEdges };

  const edges = useMemo(
    () =>
      graph.edges
        .filter((edge) => edge.from_question === question.id)
        .sort((left, right) => left.priority - right.priority),
    [graph.edges, question.id],
  );

  // Edges grouped by the option that guards them, "any answer" (question-
  // level edges, and every edge on a type that offers no per-option
  // guard) under its own bucket. A specific option's guard and the
  // question-level fallback can both match the same real answer, so
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
  // anything left over after every real option and "any answer" gets its
  // card is swept into one more, rather than silently dropped.
  const optionIds = useMemo(() => new Set(options.map((option) => option.id)), [options]);
  const deadGuardEdges = useMemo(
    () =>
      edges.filter(
        (edge) => edge.from_option !== null && !optionIds.has(edge.from_option),
      ),
    [edges, optionIds],
  );

  const pending =
    addOption.isPending ||
    reorderOptions.isPending ||
    addEdge.isPending ||
    reorderEdges.isPending;
  const error =
    writeErrorMessage(addOption.error) ??
    writeErrorMessage(reorderOptions.error) ??
    writeErrorMessage(addEdge.error) ??
    writeErrorMessage(reorderEdges.error);

  function moveOption(index: number, direction: -1 | 1) {
    const swapWith = index + direction;
    if (swapWith < 0 || swapWith >= options.length) return;
    const ordered = options.map((item) => item.id);
    const here = ordered[index];
    const there = ordered[swapWith];
    if (here === undefined || there === undefined) return;
    ordered[index] = there;
    ordered[swapWith] = here;
    // Whole-list, like every other reorder here: the unique index on
    // (question, display_order) is checked per row, so a swap sent as two
    // writes fails halfway.
    reorderOptions.mutate(
      { questionId: question.id, optionIds: ordered },
      { onError: onWriteError },
    );
  }

  function moveEdge(edge: Edge, direction: -1 | 1) {
    const index = edges.findIndex((candidate) => candidate.id === edge.id);
    const swapWith = index + direction;
    if (index < 0 || swapWith < 0 || swapWith >= edges.length) return;
    const ordered = edges.map((item) => item.id);
    const here = ordered[index];
    const there = ordered[swapWith];
    if (here === undefined || there === undefined) return;
    ordered[index] = there;
    ordered[swapWith] = here;
    reorderEdges.mutate(
      { questionId: question.id, edgeIds: ordered },
      { onError: onWriteError },
    );
  }

  function submitNewEdge(event: React.FormEvent) {
    event.preventDefault();
    addEdge.mutate(
      {
        from_question: question.id,
        from_option: newGuard === ANY_ANSWER ? null : newGuard,
        to_question: newTarget === END_OF_FLOW ? null : newTarget,
      },
      {
        onError: onWriteError,
        onSuccess: () => {
          setNewGuard(ANY_ANSWER);
          setNewTarget(END_OF_FLOW);
          setAddingEdge(false);
        },
      },
    );
  }

  const cardCount =
    options.length +
    (anyAnswerEdges.length > 0 ? 1 : 0) +
    (deadGuardEdges.length > 0 ? 1 : 0);

  return (
    <section className="panel__section" aria-labelledby="options-heading">
      <h3 id="options-heading" className="d-sub">
        Options <span className="count">{cardCount}</span>
      </h3>
      <p className="panel__hint">
        Where each answer leads. If more than one route could apply, the first one
        listed wins; otherwise the flow ends there.
      </p>

      {options.length === 0 && anyAnswerEdges.length === 0 && deadGuardEdges.length === 0 ? (
        <p className="empty">
          {takesOptions
            ? "This question has no answers yet."
            : "Nothing leads anywhere yet, so answering this question ends the flow."}
        </p>
      ) : (
        <ul className="opt-list">
          {options.map((option, index) => (
            <OptionCard
              key={option.id}
              versionId={versionId}
              option={option}
              edges={edgesByGuard.get(option.id) ?? []}
              allEdges={edges}
              ctx={ctx}
              isUncovered={uncovered.has(option.id)}
              isGuard={guardOptionIds.has(option.id)}
              canMoveUp={index > 0}
              canMoveDown={index < options.length - 1}
              onMoveOption={(direction) => moveOption(index, direction)}
              onMoveEdge={moveEdge}
              editable={editable}
              disabled={pending}
              onSelectQuestion={onSelectQuestion}
            />
          ))}

          {anyAnswerEdges.length > 0 && (
            <EdgeGroupCard
              heading={optionLabel(question, null)}
              versionId={versionId}
              edges={anyAnswerEdges}
              allEdges={edges}
              ctx={ctx}
              selectLabel={`Where "${optionLabel(question, null)}" leads`}
              editable={editable}
              disabled={pending}
              onMoveEdge={moveEdge}
              onSelectQuestion={onSelectQuestion}
            />
          )}

          {deadGuardEdges.length > 0 && (
            <EdgeGroupCard
              heading="Can't be used"
              note="Tied to an answer this question doesn't have anymore, so these can never happen -- only removed."
              versionId={versionId}
              edges={deadGuardEdges}
              allEdges={edges}
              ctx={ctx}
              selectLabel="Where this route leads"
              editable={editable}
              disabled={pending}
              onMoveEdge={moveEdge}
              onSelectQuestion={onSelectQuestion}
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
                    { question: question.id, code: newOptionCode, label: newOptionLabel },
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
                      pending || newOptionCode.trim() === "" || newOptionLabel.trim() === ""
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

          {addingEdge ? (
            <form className="editor" onSubmit={submitNewEdge}>
              <div className="field field--inline">
                <label htmlFor={addGuardId}>When the answer is</label>
                <select
                  id={addGuardId}
                  value={newGuard}
                  disabled={pending}
                  onChange={(event) => setNewGuard(event.target.value)}
                >
                  <option value={ANY_ANSWER}>Any answer</option>
                  {takesOptions &&
                    question.options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field field--inline">
                <label htmlFor={addTargetId}>Go to</label>
                <select
                  id={addTargetId}
                  value={newTarget}
                  disabled={pending}
                  onChange={(event) => setNewTarget(event.target.value)}
                >
                  <option value={END_OF_FLOW}>End of flow</option>
                  {targets.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.code}
                    </option>
                  ))}
                </select>
              </div>
              {!takesOptions && (
                <p className="panel__hint">
                  Since this question has no separate answer options, this route applies
                  no matter what's answered.
                </p>
              )}
              <div className="editor__actions">
                <button className="button button--primary" type="submit" disabled={pending}>
                  Add route
                </button>
                <button
                  className="button button--quiet"
                  type="button"
                  disabled={pending}
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
              + Add a route
            </button>
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
