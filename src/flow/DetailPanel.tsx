import { useMemo } from "react";

import { useArchiveQuestion } from "../api/queries";
import type { Edge, Graph, Question, UUID } from "../api/types";
import { ConfirmAction } from "./ConfirmAction";
import { NO_SECTION_COLOR, sectionColorMap } from "./graphElements";
import { Options } from "./Options";
import { QuestionEditor } from "./QuestionEditor";
import { answerTypeLabel, formatTimestamp, optionLabel, sourceLabel } from "./labels";
import { useWriteErrorHandler, writeErrorMessage } from "./useWriteError";

interface DetailPanelProps {
  graph: Graph;
  question: Question | null;
  editable: boolean;
  /** The edge currently mid-retarget on the canvas, if any -- see
   * `MapView`. Threaded straight through to `Options`. */
  retargetingEdgeId: UUID | null;
  /** The option (or `null` for a fallback route) a new route is currently
   * mid-add for, if any -- see `MapView`. Threaded straight through to
   * `Options`. */
  addingRouteOptionId: UUID | null;
  onSelectQuestion: (id: UUID) => void;
  onStartRetarget: (edgeId: UUID, label: string) => void;
  onStartAddRoute: (questionId: UUID, optionId: UUID | null, label: string) => void;
  /** Cancels whichever of the above is in progress. One handler, since
   * only one canvas pick can be active at a time. */
  onCancelPick: () => void;
  /** Optional so the panel can be rendered outside the router. Clears the
   * map's selection, which is what closes the drawer (there is no
   * separate "closed" state to track). */
  onClose?: (() => void) | undefined;
}

/** Ported from break-backend's `.flag` + per-kind modifiers (styles.css
 * ~L690-733) -- colour by what the flag means, not one flat pill style.
 * "neutral" is this app's own addition (break has no equivalent to
 * "nothing to report"); it borrows the muted look break gives `.flag.deleted`. */
function Flag({
  kind,
  children,
}: {
  kind: "entry" | "branch" | "term" | "unreach" | "neutral";
  children: React.ReactNode;
}) {
  return <span className={`flag flag--${kind}`}>{children}</span>;
}

/** A `.d-sub` heading with break's count-bubble (styles.css ~L778-795). */
function SubHeading({
  id,
  count,
  children,
}: {
  id: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <h3 id={id} className="d-sub">
      {children} <span className="count">{count}</span>
    </h3>
  );
}

/** Ported from break-backend's "Danger zone" (app.js's `openDetail`,
 * ~L1355-1362) -- same position, last in the panel, same `.danger-zone`
 * spacing. Delete-with-restore there is one-way retirement here: this
 * app's draft/publish model has no live single-version state to toggle
 * back, an archival made by mistake is undone by discarding the whole
 * draft instead (see the hint below). The button itself keeps this app's
 * own `.button--danger` look rather than break's small `.opt-edit-btn
 * .danger` ghost button -- that is the one control every other danger
 * action in this app already uses (EdgeEditor's "Remove"), so matching it
 * here beats matching break at the cost of an inconsistent button
 * language within this app's own UI. */
function DangerZone({ versionId, question }: { versionId: UUID; question: Question }) {
  const onWriteError = useWriteErrorHandler();
  const archiveQuestion = useArchiveQuestion(versionId);
  const error = writeErrorMessage(archiveQuestion.error);

  return (
    <section className="panel__section" aria-labelledby="danger-heading">
      <h3 id="danger-heading" className="d-sub">
        Danger zone
      </h3>
      <div className="danger-zone">
        <ConfirmAction
          message={`Retire ${question.code}? It stops being served, stays drawn while anything still points at it, and there is no way to bring it back except discarding the draft.`}
          confirmLabel="Retire this question"
          danger
          onConfirm={() =>
            archiveQuestion.mutate(question.id, { onError: onWriteError })
          }
        >
          {(open) => (
            <button
              className="button button--danger"
              type="button"
              disabled={archiveQuestion.isPending}
              onClick={open}
            >
              Retire this question
            </button>
          )}
        </ConfirmAction>
        <p className="panel__hint">
          Retiring archives rather than deletes, and there is no un-archive: an archival
          made by mistake is undone by discarding the draft. Edges pointing at it are
          left alone on purpose — they become broken edges, which is what keeps the
          arrow into nowhere visible until somebody deals with it.
        </p>
      </div>
      {error !== null && (
        <p className="banner banner--error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function DetailPanel({
  graph,
  question,
  editable,
  retargetingEdgeId,
  addingRouteOptionId,
  onSelectQuestion,
  onStartRetarget,
  onStartAddRoute,
  onCancelPick,
  onClose,
}: DetailPanelProps) {
  const questionsById = useMemo(
    () => new Map(graph.questions.map((item) => [item.id, item])),
    [graph.questions],
  );

  const incoming = useMemo(() => {
    if (question === null) return [];
    return graph.edges.filter((edge) => edge.to_question === question.id);
  }, [graph.edges, question]);

  // The same per-section colour the canvas draws that section's node
  // borders in (`graphElements.ts`), so the section badge below and the
  // "Reached from" swatches match the map instead of inventing a second
  // palette for this one panel.
  const sectionColors = useMemo(
    () => sectionColorMap(graph.sections),
    [graph.sections],
  );

  // Grouped by source question, not left as one row per edge -- ported
  // from break-backend's own merged incoming rows (openDetail's `ins`,
  // ~L1281-1319): several answers on the same source question that all
  // lead here read as one card with a numbered "via" list, not as that
  // question repeated once per answer. Purely a display grouping of
  // already-resolved edges, no priority/match computation involved.
  const incomingBySource = useMemo(() => {
    const map = new Map<UUID, Edge[]>();
    for (const edge of incoming) {
      const list = map.get(edge.from_question);
      if (list) list.push(edge);
      else map.set(edge.from_question, [edge]);
    }
    return map;
  }, [incoming]);

  if (question === null) {
    return (
      <aside className="panel" aria-label="Question detail" aria-hidden="true">
        <p className="empty">Select a question to see where its answers lead.</p>
      </aside>
    );
  }

  const audit = question.diagnostics;
  const section = graph.sections.find((item) => item.id === question.section);
  const live = question.archived_at === null;
  const sectionColor = section
    ? (sectionColors.get(section.id) ?? NO_SECTION_COLOR)
    : NO_SECTION_COLOR;

  return (
    <aside className="panel" aria-label={`Detail for ${question.code}`}>
      {onClose !== undefined && (
        // Ported from break-backend's #detailClose (index.html ~L369-371,
        // same "✕" glyph and .icon-btn look as the canvas's own zoom
        // controls). Closing just clears the map's selection -- there is
        // no separate open/closed state to keep in sync with it.
        <button
          type="button"
          className="icon-btn panel__close"
          title="Close"
          aria-label="Close detail panel"
          onClick={onClose}
        >
          ✕
        </button>
      )}

      {/* Flags first, no heading -- ported from break-backend's
          `.d-flags` (openDetail, ~L1203-1225), which leads with exactly
          this: what kind of question this is, before anything about its
          content. An archived question gets the "why is this here" banner
          in the same slot instead, matching break's own "Deleted
          placeholder" flag substituting for the rest of the row. */}
      {question.archived_at !== null ? (
        <p className="banner banner--warn">
          Archived on {formatTimestamp(question.archived_at)}. It is shown only because
          an edge still points at it, and the resolver raises rather than serving it.
          Nothing here describes routing behaviour, because it has none.
        </p>
      ) : (
        audit !== null && (
          <div className="d-flags" aria-label="Diagnostics">
            {audit.is_entry && <Flag kind="entry">Entry point</Flag>}
            {audit.is_decision_point && <Flag kind="branch">Decision point</Flag>}
            {audit.is_terminal && <Flag kind="term">Can end the flow</Flag>}
            {!audit.is_reachable && <Flag kind="unreach">Unreachable</Flag>}
            {!audit.is_entry &&
              !audit.is_decision_point &&
              !audit.is_terminal &&
              audit.is_reachable && <Flag kind="neutral">Nothing to report</Flag>}
          </div>
        )
      )}

      {/* Ported from break-backend's `.d-meta` (openDetail, ~L1343-1348):
          a coloured section badge (same dot-plus-tint look as the
          diagnostics badge) followed by small muted chips. Requiredness
          has no break equivalent -- it is this app's own field -- so it
          gets the same `.d-type` chip treatment rather than a new style.
          Shown as "Optional" only when true, not "Required" when true:
          every question is required right now, so a chip that fires on
          the common case would just be noise on every card. */}
      <div className="d-meta">
        <span
          className="d-section-badge"
          style={{ background: `${sectionColor}22`, color: sectionColor }}
        >
          <span className="sw" style={{ background: sectionColor }} />
          {section ? section.name : "No section"}
        </span>
        <span className="d-type">{answerTypeLabel(question.answer_type)}</span>
        {!question.is_required && <span className="d-type">Optional</span>}
      </div>

      <header className="panel__header">
        <div className="d-id">{question.code}</div>
        {editable && live ? (
          <QuestionEditor graph={graph} question={question} />
        ) : (
          <p className="d-question">{question.prompt}</p>
        )}
      </header>

      {/* One section for a question's whole answer set: what each answer
          is called, and (nested inside the same card) where it leads --
          combining what used to be a read-only Options list, a separate
          "Edit options" form, and `EdgeEditor`'s own "Outgoing edges"
          list. Archived questions get no editing controls at all -- spec
          4.2 gives the canvas nothing that resurrects one, and every
          content verb refuses them -- but the read-only cards (`editable`
          gates only the controls inside `Options`, not the section
          itself) still show what routing existed. */}
      <Options
        graph={graph}
        question={question}
        editable={editable && live}
        retargetingEdgeId={retargetingEdgeId}
        addingRouteOptionId={addingRouteOptionId}
        onSelectQuestion={onSelectQuestion}
        onStartRetarget={onStartRetarget}
        onStartAddRoute={onStartAddRoute}
        onCancelPick={onCancelPick}
      />

      <section className="panel__section" aria-labelledby="incoming-heading">
        <SubHeading id="incoming-heading" count={incomingBySource.size}>
          Reached from
        </SubHeading>
        {incoming.length === 0 ? (
          <p className="empty">
            {audit?.is_entry === true
              ? "Nothing routes here. It is the entry point, so it runs first anyway."
              : "Nothing routes here, so this question is never served."}
          </p>
        ) : (
          <ul className="in-list">
            {[...incomingBySource.entries()].map(([fromId, edgesFromSource]) => {
              const source = questionsById.get(fromId);
              const swatch =
                source?.section !== undefined && source.section !== null
                  ? (sectionColors.get(source.section) ?? NO_SECTION_COLOR)
                  : NO_SECTION_COLOR;
              const guards = edgesFromSource.map((edge) =>
                optionLabel(source, edge.from_option),
              );
              return (
                <li key={fromId} className="in-row">
                  <span className="in-sw" style={{ background: swatch }} />
                  <span className="in-row__body">
                    <button
                      type="button"
                      className="link in-q"
                      onClick={() => onSelectQuestion(fromId)}
                    >
                      {sourceLabel(source)}
                    </button>
                    <br />
                    <span className="in-via">
                      {guards.length === 1 ? (
                        <>
                          when {guards[0] !== undefined && <strong>{guards[0]}</strong>}
                        </>
                      ) : (
                        <>
                          when:
                          {guards.map((guard, index) => (
                            <span key={index}>
                              <br />
                              {index + 1}. <strong>{guard}</strong>
                            </span>
                          ))}
                        </>
                      )}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {editable && live && (
        <DangerZone versionId={graph.version.id} question={question} />
      )}
    </aside>
  );
}
