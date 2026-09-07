import { useMemo } from "react";

import { useArchiveQuestion } from "../api/queries";
import type { Edge, Graph, Question, UUID } from "../api/types";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { emptyText, mutedHint, panelSection, subCount, subHeading } from "@/lib/chrome";
import { ConfirmAction } from "./ConfirmAction";
import type { ChangeKinds } from "./graphElements";
import { NO_SECTION_COLOR, sectionColorMap } from "./graphElements";
import { Options } from "./Options";
import { QuestionEditor } from "./QuestionEditor";
import { answerTypeLabel, formatTimestamp, optionLabel, sourceLabel } from "./labels";
import { useWriteErrorHandler, writeErrorMessage } from "./useWriteError";

const EMPTY_CHANGE_KINDS: ChangeKinds = {
  questions: new Map(),
  options: new Map(),
  edges: new Map(),
};

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
  /** The open draft's own diff, already bucketed by `changeKindsFromDiff`
   * -- same data the canvas highlights nodes/edges with (`MapView`),
   * shared rather than a second copy computed here. Absent off a
   * published version (nothing pending to show) and in every existing
   * test that renders this panel directly, so it defaults to "nothing
   * changed" rather than requiring every call site to pass one. */
  changeKinds?: ChangeKinds | undefined;
}

/** Ported from break-backend's `.flag` + per-kind modifiers (styles.css
 * ~L690-733) -- colour by what the flag means, not one flat pill style.
 * "neutral" is this app's own addition (break has no equivalent to
 * "nothing to report"); it borrows the muted look break gives `.flag.deleted`.
 * "added"/"changed" reuse the exact green/gold `--entry`/`--branch` already
 * use, not a third colour pair. */
function Flag({
  kind,
  children,
}: {
  kind: "entry" | "branch" | "term" | "unreach" | "neutral" | "added" | "changed";
  children: React.ReactNode;
}) {
  return <Badge tone={kind}>{children}</Badge>;
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
    <h3 id={id} className={subHeading}>
      {children} <span className={subCount}>{count}</span>
    </h3>
  );
}

/** Ported from break-backend's "Danger zone" (app.js's `openDetail`,
 * ~L1355-1362) -- same position, last in the panel, same `.danger-zone`
 * spacing. Delete-with-restore there is one-way retirement here: this
 * app's draft/publish model has no live single-version state to toggle
 * back, an archival made by mistake is undone by discarding the whole
 * draft instead (see the hint below). The button is `Button variant="danger"`,
 * the same primitive EdgeEditor's "Remove" uses, rather than break's small
 * outline ghost. */
function DangerZone({ versionId, question }: { versionId: UUID; question: Question }) {
  const onWriteError = useWriteErrorHandler();
  const archiveQuestion = useArchiveQuestion(versionId);
  const error = writeErrorMessage(archiveQuestion.error);

  return (
    <section className={panelSection} aria-labelledby="danger-heading">
      <h3 id="danger-heading" className={subHeading}>
        Danger zone
      </h3>
      <div className="mb-[22px]">
        <ConfirmAction
          message={`Retire ${question.code}? It stops being served, stays drawn while anything still points at it, and there is no way to bring it back except discarding the draft.`}
          confirmLabel="Retire this question"
          danger
          onConfirm={() =>
            archiveQuestion.mutate(question.id, { onError: onWriteError })
          }
        >
          {(open) => (
            <Button
              variant="danger"
              disabled={archiveQuestion.isPending}
              onClick={open}
            >
              Retire this question
            </Button>
          )}
        </ConfirmAction>
        <p className={mutedHint}>
          Retiring archives rather than deletes, and there is no un-archive: an archival
          made by mistake is undone by discarding the draft. Edges pointing at it are
          left alone on purpose — they become broken edges, which is what keeps the
          arrow into nowhere visible until somebody deals with it.
        </p>
      </div>
      {error !== null && (
        <Banner tone="error" role="alert">
          {error}
        </Banner>
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
  changeKinds = EMPTY_CHANGE_KINDS,
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
      <aside
        className="panel relative h-full min-h-0 min-w-0 overflow-y-auto bg-background p-5"
        aria-label="Question detail"
        aria-hidden="true"
      >
        <p className={emptyText}>Select a question to see where its answers lead.</p>
      </aside>
    );
  }

  const audit = question.diagnostics;
  const section = graph.sections.find((item) => item.id === question.section);
  const live = question.archived_at === null;
  const sectionColor = section
    ? (sectionColors.get(section.id) ?? NO_SECTION_COLOR)
    : NO_SECTION_COLOR;
  // Only ever set for a live question: an archived one's own diff row is
  // exactly what put it here, and it already gets the banner below
  // instead of this flag row at all.
  const questionChange = changeKinds.questions.get(question.id);

  return (
    <aside
      className="panel relative h-full min-h-0 min-w-0 overflow-y-auto bg-background p-5"
      aria-label={`Detail for ${question.code}`}
    >
      {onClose !== undefined && (
        // Ported from break-backend's #detailClose (index.html ~L369-371,
        // same "✕" glyph and icon Button as the canvas's own zoom
        // controls). Closing just clears the map's selection -- there is
        // no separate open/closed state to keep in sync with it.
        <Button
          size="icon"
          className="absolute top-3 right-3 z-3"
          title="Close"
          aria-label="Close detail panel"
          onClick={onClose}
        >
          ✕
        </Button>
      )}

      {/* Flags first, no heading -- ported from break-backend's
          `.d-flags` (openDetail, ~L1203-1225), which leads with exactly
          this: what kind of question this is, before anything about its
          content. An archived question gets the "why is this here" banner
          in the same slot instead, matching break's own "Deleted
          placeholder" flag substituting for the rest of the row. */}
      {question.archived_at !== null ? (
        <Banner tone="warn">
          Archived on {formatTimestamp(question.archived_at)}. It is shown only because
          an edge still points at it, and the resolver raises rather than serving it.
          Nothing here describes routing behaviour, because it has none.
        </Banner>
      ) : (
        audit !== null && (
          <div className="mb-3.5 flex flex-wrap gap-1.5" aria-label="Diagnostics">
            {questionChange === "added" && <Flag kind="added">New</Flag>}
            {questionChange === "changed" && <Flag kind="changed">Changed</Flag>}
            {audit.is_entry && <Flag kind="entry">Entry point</Flag>}
            {audit.is_decision_point && <Flag kind="branch">Decision point</Flag>}
            {audit.is_terminal && <Flag kind="term">Can end the flow</Flag>}
            {!audit.is_reachable && <Flag kind="unreach">Unreachable</Flag>}
            {questionChange === undefined &&
              !audit.is_entry &&
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
          gets the same meta Badge chip rather than a new style.
          Shown as "Optional" only when true, not "Required" when true:
          every question is required right now, so a chip that fires on
          the common case would just be noise on every card. */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge
          tone="section"
          style={{ background: `${sectionColor}22`, color: sectionColor }}
        >
          <span
            className="inline-block size-2.5 shrink-0 rounded-full"
            style={{ background: sectionColor }}
          />
          {section ? section.name : "No section"}
        </Badge>
        <Badge tone="meta">{answerTypeLabel(question.answer_type)}</Badge>
        {!question.is_required && <Badge tone="meta">Optional</Badge>}
      </div>

      <header className="mt-4">
        <div className="text-muted-foreground text-xs tabular-nums">
          QID {question.code}
        </div>
        {editable && live ? (
          <QuestionEditor graph={graph} question={question} />
        ) : (
          <p className="mt-1.5 text-[16.5px] leading-snug font-medium">
            {question.prompt}
          </p>
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
        changeKinds={changeKinds}
        retargetingEdgeId={retargetingEdgeId}
        addingRouteOptionId={addingRouteOptionId}
        onSelectQuestion={onSelectQuestion}
        onStartRetarget={onStartRetarget}
        onStartAddRoute={onStartAddRoute}
        onCancelPick={onCancelPick}
      />

      <section className={panelSection} aria-labelledby="incoming-heading">
        <SubHeading id="incoming-heading" count={incomingBySource.size}>
          Reached from
        </SubHeading>
        {incoming.length === 0 ? (
          <p className={emptyText}>
            {audit?.is_entry === true
              ? "Nothing routes here. It is the entry point, so it runs first anyway."
              : "Nothing routes here, so this question is never served."}
          </p>
        ) : (
          <ul className="flex list-none flex-col gap-1.5 p-0">
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
                <li key={fromId}>
                  <Card
                    size="sm"
                    className="flex-row items-start gap-2.5 rounded-[9px] p-2.5 ring-border hover:ring-[var(--accent-2)]"
                  >
                    <span
                      className="mt-1 size-2 shrink-0 rounded-full"
                      style={{ background: swatch }}
                    />
                    <span className="min-w-0 flex-1">
                      <Button variant="link" onClick={() => onSelectQuestion(fromId)}>
                        {sourceLabel(source)}
                      </Button>
                      <br />
                      <span className="text-muted-foreground text-[11.5px]">
                        {guards.length === 1 ? (
                          <>
                            when{" "}
                            {guards[0] !== undefined && <strong>{guards[0]}</strong>}
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
                  </Card>
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
