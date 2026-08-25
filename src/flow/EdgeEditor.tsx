import { useId, useMemo, useState } from "react";

import { CHOICE_ANSWER_TYPES } from "../api/types";
import type { Edge, Graph, Question, UUID } from "../api/types";
import {
  useAddEdge,
  useRemoveEdge,
  useReorderEdges,
  useUpdateEdge,
} from "../api/queries";
import { NO_SECTION_COLOR, sectionColorMap } from "./graphElements";
import { optionLabel, targetLabel } from "./labels";
import { useWriteErrorHandler, writeErrorMessage } from "./useWriteError";

const END_OF_FLOW = "__end__";
const ANY_ANSWER = "__any__";

interface EdgeEditorProps {
  graph: Graph;
  question: Question;
  editable: boolean;
  onSelectQuestion: (id: UUID) => void;
}

export function EdgeEditor({
  graph,
  question,
  editable,
  onSelectQuestion,
}: EdgeEditorProps) {
  const versionId = graph.version.id;
  const onWriteError = useWriteErrorHandler();
  const addEdge = useAddEdge(versionId);
  const updateEdge = useUpdateEdge(versionId);
  const removeEdge = useRemoveEdge(versionId);
  const reorderEdges = useReorderEdges(versionId);

  const addGuardId = useId();
  const addTargetId = useId();
  const [newGuard, setNewGuard] = useState<string>(ANY_ANSWER);
  const [newTarget, setNewTarget] = useState<string>(END_OF_FLOW);

  const questionsById = useMemo(
    () => new Map(graph.questions.map((item) => [item.id, item])),
    [graph.questions],
  );

  // Same per-section colour the canvas and the detail panel's own badges
  // use (`graphElements.ts`), so a destination chip's dot matches the
  // section colour everywhere else in the app.
  const sectionColors = useMemo(
    () => sectionColorMap(graph.sections),
    [graph.sections],
  );

  const edges = useMemo(
    () =>
      graph.edges
        .filter((edge) => edge.from_question === question.id)
        .sort((left, right) => left.priority - right.priority),
    [graph.edges, question.id],
  );

  const deadEdges = useMemo(
    () => new Set(graph.diagnostics.dead_edge_ids),
    [graph.diagnostics.dead_edge_ids],
  );
  const brokenEdges = useMemo(
    () => new Set(graph.diagnostics.broken_edge_ids),
    [graph.diagnostics.broken_edge_ids],
  );

  // Only the choice types select options, so those are the only ones a
  // per-option guard can ever match on. Offering the rest a per-option
  // guard would be offering an edge the resolver reports as dead the
  // moment it is saved. The server refuses it too -- this is the same rule
  // stated where somebody can read it, not a second authority.
  const guardsAreOffered = CHOICE_ANSWER_TYPES.has(question.answer_type);

  const targets = useMemo(
    () =>
      graph.questions
        .filter((candidate) => candidate.archived_at === null)
        .sort((left, right) => left.display_order - right.display_order),
    [graph.questions],
  );

  const pending =
    addEdge.isPending ||
    updateEdge.isPending ||
    removeEdge.isPending ||
    reorderEdges.isPending;

  const error =
    writeErrorMessage(addEdge.error) ??
    writeErrorMessage(updateEdge.error) ??
    writeErrorMessage(removeEdge.error) ??
    writeErrorMessage(reorderEdges.error);

  function move(edge: Edge, direction: -1 | 1) {
    const index = edges.findIndex((candidate) => candidate.id === edge.id);
    const swapWith = index + direction;
    if (index < 0 || swapWith < 0 || swapWith >= edges.length) return;
    const ordered = edges.map((item) => item.id);
    const here = ordered[index];
    const there = ordered[swapWith];
    if (here === undefined || there === undefined) return;
    ordered[index] = there;
    ordered[swapWith] = here;
    // The whole list goes, every time. There is no per-edge priority
    // write: the unique index on (from_question, priority) is checked per
    // row, so a swap sent as two writes fails halfway and leaves the order
    // it stopped at.
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
        },
      },
    );
  }

  return (
    <section className="panel__section" aria-labelledby="edges-heading">
      <h3 id="edges-heading" className="d-sub">
        Outgoing edges <span className="count">{edges.length}</span>
      </h3>
      <p className="panel__hint">
        Tried in this order. The first whose guard matches the answer wins; if none
        match, the flow ends.
      </p>

      {edges.length === 0 ? (
        <p className="empty">
          No edges leave this question, so answering it always ends the flow.
        </p>
      ) : (
        // A flat, priority-ordered list -- not grouped by guard the way the
        // detail panel's Options card list is -- on purpose: a per-option
        // edge and the question-level "Any answer" edge can both match the
        // same real answer, and this order is what decides which one wins.
        // Grouping by guard (break's own "Answers & where they lead" card
        // layout) would hide that cross-guard relationship rather than show
        // it, so only the visual language (card, destination chip) is
        // ported here, not the grouping.
        <ol className="opt-list">
          {edges.map((edge, index) => {
            const isDead = deadEdges.has(edge.id);
            const isBroken = brokenEdges.has(edge.id);
            const targetQuestion =
              edge.to_question !== null ? questionsById.get(edge.to_question) : undefined;
            const targetColor =
              targetQuestion?.section != null
                ? (sectionColors.get(targetQuestion.section) ?? NO_SECTION_COLOR)
                : NO_SECTION_COLOR;
            return (
              <li key={edge.id} className="opt">
                <div className="opt-label">
                  <span className="edges__priority" aria-hidden="true">
                    {index + 1}
                  </span>{" "}
                  <span>{optionLabel(question, edge.from_option)}</span>
                </div>

                <div
                  className={
                    edge.to_question === null ? "opt-dest terminal-dest" : "opt-dest"
                  }
                >
                  <span className="arrow" aria-hidden="true">
                    {edge.to_question === null ? "⏹" : "↘"}
                  </span>
                  {edge.to_question !== null && (
                    <span className="dest-sw" style={{ background: targetColor }} />
                  )}
                  <span className="dest-txt">
                    {edge.to_question !== null && questionsById.has(edge.to_question) ? (
                      <button
                        type="button"
                        className="link"
                        onClick={() => onSelectQuestion(edge.to_question as UUID)}
                      >
                        {targetLabel(edge, questionsById)}
                      </button>
                    ) : (
                      targetLabel(edge, questionsById)
                    )}
                  </span>
                </div>

                {(isDead || isBroken) && (
                  <p className="edges__fault">
                    {isBroken
                      ? "Broken: the target is archived or belongs to another version, so serving this answer raises rather than routing."
                      : "Dead: this question does not offer that option, so the guard can never match."}
                  </p>
                )}

                {editable && (
                  <div className="opt-edit-row">
                    <label className="sr-only" htmlFor={`target-${edge.id}`}>
                      Target for {optionLabel(question, edge.from_option)}
                    </label>
                    <select
                      id={`target-${edge.id}`}
                      value={edge.to_question ?? END_OF_FLOW}
                      disabled={pending}
                      onChange={(event) =>
                        updateEdge.mutate(
                          {
                            edgeId: edge.id,
                            changes: {
                              to_question:
                                event.target.value === END_OF_FLOW
                                  ? null
                                  : event.target.value,
                            },
                          },
                          { onError: onWriteError },
                        )
                      }
                    >
                      <option value={END_OF_FLOW}>End of flow</option>
                      {targets.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.code}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="opt-edit-btn"
                      disabled={pending || index === 0}
                      onClick={() => move(edge, -1)}
                    >
                      Move up
                    </button>
                    <button
                      type="button"
                      className="opt-edit-btn"
                      disabled={pending || index === edges.length - 1}
                      onClick={() => move(edge, 1)}
                    >
                      Move down
                    </button>
                    <button
                      type="button"
                      className="opt-edit-btn danger"
                      disabled={pending}
                      onClick={() =>
                        removeEdge.mutate(edge.id, { onError: onWriteError })
                      }
                    >
                      Remove
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {editable && (
        <form className="edges__add" onSubmit={submitNewEdge}>
          <h4 className="panel__subheading">Add an edge</h4>
          <div className="field field--inline">
            <label htmlFor={addGuardId}>When the answer is</label>
            <select
              id={addGuardId}
              value={newGuard}
              disabled={pending}
              onChange={(event) => setNewGuard(event.target.value)}
            >
              <option value={ANY_ANSWER}>Any answer</option>
              {guardsAreOffered &&
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
          {!guardsAreOffered && (
            <p className="panel__hint">
              Answers to a {question.answer_type.replace("_", " ")} question do not
              select options, so only a question-level edge can fire here.
            </p>
          )}
          <button className="button button--primary" type="submit" disabled={pending}>
            Add edge
          </button>
        </form>
      )}

      {error !== null && (
        <p className="banner banner--error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
