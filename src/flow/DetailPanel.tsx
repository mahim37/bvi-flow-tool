import { useEffect, useMemo, useState } from "react";

import { useArchiveQuestion, useUpdateQuestion } from "../api/queries";
import type { Edge, Graph, Question, UUID } from "../api/types";
import { EdgeEditor } from "./EdgeEditor";
import { NO_SECTION_COLOR, sectionColorMap } from "./graphElements";
import { OptionEditor } from "./OptionEditor";
import { QuestionEditor } from "./QuestionEditor";
import { answerTypeLabel, formatTimestamp, optionLabel } from "./labels";
import { useWriteErrorHandler, writeErrorMessage } from "./useWriteError";

interface DetailPanelProps {
  graph: Graph;
  question: Question | null;
  editable: boolean;
  onSelectQuestion: (id: UUID) => void;
  /** Optional so the panel can be rendered outside the router. The map
   * passes a navigation; nothing else needs one. */
  onPreviewFrom?: (() => void) | undefined;
  /** Optional for the same reason -- clears the map's selection, which is
   * what closes the drawer (there is no separate "closed" state to track).
   * Absent wherever there is nothing to select out of, same as above. */
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

/** The question text, edited in place -- ported from break-backend's own
 * affordance for it (an "Edit" button on the read view swaps it for a
 * textarea with Save/Cancel, `data-edit-question`/`data-save-question` and
 * `.content-edit-form` in app.js/styles.css). Everything else about a
 * question (code, answer type, section, required) still goes through
 * `QuestionEditor`'s persistent form below; only the text -- the thing
 * somebody is already looking at right here -- gets the quick, in-place
 * path. */
function PromptEditor({ versionId, question }: { versionId: UUID; question: Question }) {
  const onWriteError = useWriteErrorHandler();
  const updateQuestion = useUpdateQuestion(versionId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(question.prompt);

  useEffect(() => {
    setDraft(question.prompt);
    setEditing(false);
  }, [question.id, question.prompt]);

  if (!editing) {
    return (
      <p className="d-question">
        {question.prompt}{" "}
        <button
          type="button"
          className="opt-edit-btn d-edit-btn"
          onClick={() => setEditing(true)}
        >
          Edit
        </button>
      </p>
    );
  }

  const dirty = draft !== question.prompt;
  const error = writeErrorMessage(updateQuestion.error);

  return (
    <div className="content-edit-form">
      <label htmlFor="prompt-edit">Question text</label>
      <textarea
        id="prompt-edit"
        value={draft}
        disabled={updateQuestion.isPending}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="edit-actions">
        <button
          type="button"
          className="opt-edit-btn active"
          disabled={updateQuestion.isPending || !dirty}
          onClick={() =>
            updateQuestion.mutate(
              { questionId: question.id, changes: { prompt: draft } },
              { onError: onWriteError, onSuccess: () => setEditing(false) },
            )
          }
        >
          {updateQuestion.isPending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="opt-edit-btn"
          disabled={updateQuestion.isPending}
          onClick={() => {
            setDraft(question.prompt);
            setEditing(false);
          }}
        >
          Cancel
        </button>
      </div>
      {error !== null && (
        <p className="banner banner--error" role="alert">
          {error}
        </p>
      )}
    </div>
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
        <button
          className="button button--danger"
          type="button"
          disabled={archiveQuestion.isPending}
          onClick={() => {
            if (
              !window.confirm(
                `Retire ${question.code}? It stops being served, stays drawn while anything still points at it, and there is no way to bring it back except discarding the draft.`,
              )
            ) {
              return;
            }
            archiveQuestion.mutate(question.id, { onError: onWriteError });
          }}
        >
          Retire this question
        </button>
        <p className="panel__hint">
          Retiring archives rather than deletes, and there is no un-archive: an archival
          made by mistake is undone by discarding the draft. Edges pointing at it are left
          alone on purpose — they become broken edges, which is what keeps the arrow into
          nowhere visible until somebody deals with it.
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
  onSelectQuestion,
  onPreviewFrom,
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
  const uncovered = new Set(audit?.uncovered_option_ids ?? []);
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
          diagnostics badge) followed by small muted chips. "Required" has
          no break equivalent -- it is this app's own field -- so it gets
          the same `.d-type` chip treatment rather than a new style, and
          only appears when true so an optional question's row does not
          carry a chip saying so. */}
      <div className="d-meta">
        <span
          className="d-section-badge"
          style={{ background: `${sectionColor}22`, color: sectionColor }}
        >
          <span className="sw" style={{ background: sectionColor }} />
          {section ? section.name : "No section"}
        </span>
        <span className="d-type">{answerTypeLabel(question.answer_type)}</span>
        {question.is_required && <span className="d-type">Required</span>}
      </div>

      <header className="panel__header">
        <div className="d-id">{question.code}</div>
        {editable && live ? (
          <PromptEditor versionId={graph.version.id} question={question} />
        ) : (
          <p className="d-question">{question.prompt}</p>
        )}
      </header>

      {question.options.length > 0 && (
        <section className="panel__section" aria-labelledby="options-heading">
          <SubHeading id="options-heading" count={question.options.length}>
            Options
          </SubHeading>
          <ul className="opt-list">
            {question.options.map((option) => (
              <li key={option.id} className="opt">
                <div className="opt-label">
                  {option.label} <code className="options__code">{option.code}</code>
                </div>
                {uncovered.has(option.id) && (
                  <span className="options__fault">
                    No edge covers this answer, so choosing it ends the flow.
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Archived questions get no editor at all. There is no un-archive
          verb -- spec 4.2 gives the canvas nothing that resurrects one --
          and every content verb refuses them, so the controls would be a
          guaranteed refusal. Discarding the draft is how an archival made
          by mistake is undone. */}
      {editable && live && (
        <>
          <OptionEditor
            graph={graph}
            question={question}
            editable={editable}
            onSelectQuestion={onSelectQuestion}
          />
          <QuestionEditor graph={graph} question={question} />
        </>
      )}

      <EdgeEditor
        graph={graph}
        question={question}
        editable={editable && live}
        onSelectQuestion={onSelectQuestion}
      />

      {onPreviewFrom !== undefined && live && (
        <section className="panel__section" aria-labelledby="walk-heading">
          <h3 id="walk-heading" className="panel__heading">
            Walk it
          </h3>
          <button className="button" type="button" onClick={onPreviewFrom}>
            Open the preview
          </button>
          {/* The preview replays from the entry point every time, so it
              cannot be dropped straight onto this question: the route that
              reaches it is part of what is being checked. */}
          <p className="panel__hint">
            The preview walks from the entry point, through the same resolver a
            respondent goes through. There is no way to start halfway — the route that
            reaches a question is part of what a preview is for.
          </p>
        </section>
      )}

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
                  <span>
                    <button
                      type="button"
                      className="link in-q"
                      onClick={() => onSelectQuestion(fromId)}
                    >
                      {source ? source.code : "Unknown question"}
                    </button>
                    <br />
                    <span className="in-via">
                      {guards.length === 1 ? (
                        `when ${guards[0]?.toLowerCase()}`
                      ) : (
                        <>
                          when:
                          {guards.map((guard, index) => (
                            <span key={index}>
                              <br />
                              {index + 1}. {guard}
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

      {editable && live && <DangerZone versionId={graph.version.id} question={question} />}
    </aside>
  );
}
