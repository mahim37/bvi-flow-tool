import { XIcon } from "lucide-react";

import { useArchiveQuestion } from "../api/queries";
import type { Graph, Question, UUID } from "../api/types";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { emptyText, subHeading } from "@/lib/chrome";
import { cn } from "@/lib/utils";
import { ConfirmAction } from "./ConfirmAction";
import type { ChangeKinds } from "./graphElements";
import { Options } from "./Options";
import { QuestionEditor } from "./QuestionEditor";
import { formatTimestamp } from "./labels";
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
  /** The question that new route is being added from. With
   * `addingRouteOptionId === null`, this is a default-route add. Optional
   * so existing panel tests can omit it. */
  addingRouteQuestionId?: UUID | null;
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

/** Ported from break-backend's "Danger zone" (app.js's `openDetail`,
 * ~L1355-1362) -- same position, last in the panel. Delete-with-restore
 * there is one-way retirement here: this app's draft/publish model has
 * no live single-version state to toggle back, an archival made by
 * mistake is undone by discarding the whole draft instead. The button is
 * `Button variant="danger"`, the same primitive EdgeEditor's "Remove"
 * uses, rather than break's small outline ghost. */
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
          message="Retire this question?"
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
  addingRouteQuestionId = null,
  onSelectQuestion,
  onStartRetarget,
  onStartAddRoute,
  onCancelPick,
  onClose,
  changeKinds = EMPTY_CHANGE_KINDS,
}: DetailPanelProps) {
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
  const live = question.archived_at === null;
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
      aria-label={`Detail for ${question.prompt}`}
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

        <div className="flex flex-col gap-1">
          {editable && live ? (
            <QuestionEditor graph={graph} question={question} />
          ) : (
            <h2 className="m-0 text-base leading-snug font-medium">
              {question.prompt}
            </h2>
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
        addingRouteQuestionId={addingRouteQuestionId}
        onSelectQuestion={onSelectQuestion}
        onStartRetarget={onStartRetarget}
        onStartAddRoute={onStartAddRoute}
        onCancelPick={onCancelPick}
      />

      {editable && live && (
        <>
          <Separator />
          <DangerZone versionId={graph.version.id} question={question} />
        </>
      )}
    </aside>
  );
}
