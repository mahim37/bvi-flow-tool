import { useMemo } from "react";

import { ArrowUpRight, XIcon } from "lucide-react";

import { useArchiveQuestion } from "../api/queries";
import type { Edge, Graph, Question, UUID } from "../api/types";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { emptyText, mutedHint, questionLink, subCount, subHeading } from "@/lib/chrome";
import { cn } from "@/lib/utils";
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

function incomingVia(guards: string[]): string {
  if (guards.length === 1 && guards[0] === "Default route") {
    return "Via the default route";
  }
  if (guards.length === 1) {
    return `When ${guards[0] ?? ""}`;
  }
  return `When ${guards.join(", ")}`;
}

/** Ported from break-backend's `.flag` + per-kind modifiers (styles.css
 * ~L690-733) -- colour by what the flag means, not one flat pill style.
 * "added"/"changed" reuse the exact green/gold `--entry`/`--branch` already
 * use, not a third colour pair. Empty "nothing to report" is omitted:
 * silence is the clean state, not a pill that says so. */
function Flag({
  kind,
  children,
}: {
  kind: "entry" | "branch" | "term" | "unreach" | "added" | "changed";
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
    <h3 id={id} className={cn(subHeading, "mb-0")}>
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
    <section className="flex flex-col gap-3" aria-labelledby="danger-heading">
      <h3 id="danger-heading" className={cn(subHeading, "mb-0")}>
        Danger zone
      </h3>
      <div>
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
          left alone on purpose. They become broken edges, which is what keeps the arrow
          into nowhere visible until somebody deals with it.
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
  // borders in (`graphElements.ts`), so the section badge below matches
  // the map instead of inventing a second palette for this one panel.
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
        className="panel relative h-full min-h-0 min-w-0 overflow-y-auto bg-background p-4"
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
  const flags =
    question.archived_at !== null || audit === null
      ? []
      : [
          ...(questionChange === "added"
            ? [{ kind: "added" as const, label: "New" }]
            : []),
          ...(questionChange === "changed"
            ? [{ kind: "changed" as const, label: "Changed" }]
            : []),
          ...(audit.is_entry ? [{ kind: "entry" as const, label: "Entry point" }] : []),
          ...(audit.is_decision_point
            ? [{ kind: "branch" as const, label: "Decision point" }]
            : []),
          ...(audit.is_terminal
            ? [{ kind: "term" as const, label: "Can end the flow" }]
            : []),
          ...(!audit.is_reachable
            ? [{ kind: "unreach" as const, label: "Unreachable" }]
            : []),
        ];

  return (
    <aside
      className="panel relative flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-y-auto bg-background p-4"
      aria-label={`Detail for ${question.code}`}
    >
      {onClose !== undefined && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-3 right-3 z-3"
          aria-label="Close detail panel"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      )}

      <header className="flex flex-col gap-3 pr-8">
        {question.archived_at !== null ? (
          <Banner tone="warn">
            Archived on {formatTimestamp(question.archived_at)}. It is shown only
            because an edge still points at it, and the resolver raises rather than
            serving it. Nothing here describes routing behaviour, because it has none.
          </Banner>
        ) : (
          flags.length > 0 && (
            <ul
              className="flex list-none flex-wrap gap-1.5 p-0"
              aria-label="Diagnostics"
            >
              {flags.map((flag) => (
                <li key={flag.label}>
                  <Flag kind={flag.kind}>{flag.label}</Flag>
                </li>
              ))}
            </ul>
          )
        )}

        <div className="flex flex-wrap items-center gap-2">
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

        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-xs tabular-nums">{question.code}</p>
          {editable && live ? (
            <QuestionEditor graph={graph} question={question} />
          ) : (
            <h2 className="text-base leading-snug font-medium">{question.prompt}</h2>
          )}
        </div>
      </header>

      <Separator />

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

      <Separator />

      <section className="flex flex-col gap-3" aria-labelledby="incoming-heading">
        <SubHeading id="incoming-heading" count={incomingBySource.size}>
          Reached from
        </SubHeading>
        {incoming.length === 0 ? (
          <p className={cn(emptyText, "my-0")}>
            {audit?.is_entry === true
              ? "Nothing routes here. It is the entry point, so it runs first anyway."
              : "Nothing routes here, so this question is never served."}
          </p>
        ) : (
          <ul className="flex list-none flex-col gap-2 p-0">
            {[...incomingBySource.entries()].map(([fromId, edgesFromSource]) => {
              const source = questionsById.get(fromId);
              const guards = edgesFromSource.map((edge) =>
                optionLabel(source, edge.from_option),
              );
              return (
                <li key={fromId}>
                  <Card size="sm">
                    <CardHeader>
                      <CardTitle className="min-w-0 text-sm">
                        {source !== undefined ? (
                          <Button
                            variant="link"
                            className={questionLink}
                            aria-label={`Go to ${source.code}: ${source.prompt}`}
                            onClick={() => onSelectQuestion(fromId)}
                          >
                            <span className="underline underline-offset-2">
                              {source.prompt}
                            </span>
                            <ArrowUpRight aria-hidden="true" />
                          </Button>
                        ) : (
                          sourceLabel(source)
                        )}
                      </CardTitle>
                      <CardDescription>{incomingVia(guards)}</CardDescription>
                    </CardHeader>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {editable && live && (
        <>
          <Separator />
          <DangerZone versionId={graph.version.id} question={question} />
        </>
      )}
    </aside>
  );
}
