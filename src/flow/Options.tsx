import { useId, useMemo, useState, type ReactNode } from "react";

import { ArrowUpRight, Pencil, Trash2, TriangleAlert, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

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
import { Banner } from "@/components/ui/banner";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { BlockingList } from "./BlockingList";
import { ConfirmAction } from "./ConfirmAction";
import { EditorDialog } from "./EditorDialog";
import { EditorDropdown } from "./EditorDropdown";
import type { ChangeKind, ChangeKinds } from "./graphElements";
import { INTEGER_ANSWER_EDGE_LABEL, optionsCoveredByFallback } from "./graphElements";
import { answerTypeLabel, targetLabel } from "./labels";
import {
  emptyText,
  editorActions,
  mutedHint,
  optCard,
  questionLink,
  routeHeading,
  subCount,
  subHeading,
} from "@/lib/chrome";
import { slugify } from "@/lib/slug";
import { cn } from "@/lib/utils";
import { useWriteErrorHandler, writeErrorMessage } from "./useWriteError";

const ANY_ANSWER = "__any__";
const EMPTY_CHANGE_KINDS: ChangeKinds = {
  questions: new Map(),
  options: new Map(),
  edges: new Map(),
};

/** Nested children under a tree row: indent plus a stem, like a folder.
 * Same weight as the default-route trunk so specific routes stay visible. */
const treeBranch = "flex flex-col gap-2 border-l-2 border-border-strong pl-3";
const defaultStem = "flex flex-col gap-2 border-l-2 border-border pl-3";

interface OptionsProps {
  graph: Graph;
  question: Question;
  editable: boolean;
  retargetingEdgeId: UUID | null;
  addingRouteOptionId: UUID | null;
  /** The question a new canvas-pick route is currently mid-add for, if
   * any. Combined with `addingRouteOptionId === null` this is a
   * default-route add. Optional so a direct test render can omit it. */
  addingRouteQuestionId?: UUID | null;
  onSelectQuestion: (id: UUID) => void;
  onStartRetarget: (edgeId: UUID, label: string) => void;
  onStartAddRoute: (questionId: UUID, optionId: UUID | null, label: string) => void;
  onCancelPick: () => void;
  /** The open draft's own diff, bucketed by `changeKindsFromDiff` --
   * same data the canvas highlights with (`MapView`). Optional so a
   * direct test render (no draft, or no diff fetched yet) doesn't need
   * to pass one. */
  changeKinds?: ChangeKinds;
}

/** Icon-only chrome. `label` is the accessible name and the hover
 * tooltip, so a pictogram never sits mute. */
function IconAction({
  label,
  icon: Icon,
  title,
  ...props
}: {
  label: string;
  icon: LucideIcon;
} & Omit<ButtonProps, "children" | "size">) {
  return (
    <Button size="icon-sm" aria-label={label} title={title ?? label} {...props}>
      <Icon />
    </Button>
  );
}

/** Read-only data every route row needs, bundled so it isn't six separate
 * props on every card. Computed once per render in `Options`, not per
 * card. */
interface EdgeContext {
  questionsById: ReadonlyMap<UUID, Question>;
  targets: Question[];
  deadEdges: ReadonlySet<UUID>;
  brokenEdges: ReadonlySet<UUID>;
  edgeChangeKinds: ReadonlyMap<UUID, ChangeKind>;
  optionChangeKinds: ReadonlyMap<UUID, ChangeKind>;
}

/** One route's destination chip and its "Change destination" popup
 * (shown whenever `editable` -- it acts immediately and isn't
 * destructive, so there's no need to hide it behind a confirmation
 * step). Removing the route is an icon with a confirm step, same as
 * deleting an answer: both destroy data, both ask first.
 * Ported from break-backend's own destination picker
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
  disabled,
  retargetingEdgeId,
  hasFallback,
  hideDeadNote,
  footnote,
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
  disabled: boolean;
  /** The edge currently mid-retarget (clicking a question on the canvas
   * sets its target), if any. Compared by id rather than passing a
   * boolean so only the one row involved re-renders into its "Cancel"
   * state. */
  retargetingEdgeId: UUID | null;
  /** Whether this row's question has a default route (question-level
   * edge) -- offers a one-click way to delete a per-option edge in favour
   * of it, instead of knowing that's what an empty card does. `false` for
   * `EdgeGroupCard`'s rows: removing the default route itself doesn't
   * fall through to itself. */
  hasFallback: boolean;
  /** Set by `EdgeGroupCard`: every row it renders is dead for the same
   * reason its own card-level note already states, so the row doesn't
   * repeat it a second time per route. */
  hideDeadNote?: boolean;
  /** Extra line on this route, e.g. that a scale question's only edge is
   * an integer answer. */
  footnote?: string;
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

  const destPrompt =
    targetQuestion === undefined
      ? null
      : targetQuestion.archived_at === null
        ? targetQuestion.prompt
        : `${targetQuestion.prompt} (archived)`;

  const destName = destPrompt ?? targetLabel(edge, ctx.questionsById);
  const destIsLink = edge.to_question !== null && targetQuestion !== undefined;
  const destLabel = (
    <>
      <span className="shrink-0">To: </span>
      <span className="min-w-0 truncate underline-offset-2" title={destName}>
        {destIsLink ? <span className="underline underline-offset-2">{destName}</span> : destName}
      </span>
    </>
  );

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-w-0 flex-row flex-nowrap items-center gap-1">
        {destIsLink ? (
          <Button
            variant="link"
            className={cn(questionLink, "min-w-0")}
            aria-label={`To: ${destName}`}
            title={destName}
            onClick={() => onSelectQuestion(edge.to_question as UUID)}
          >
            {destLabel}
            <ArrowUpRight aria-hidden="true" />
          </Button>
        ) : (
          <span
            className={cn(
              "flex min-w-0 flex-1 items-baseline overflow-hidden text-sm font-medium",
              edge.to_question === null && "text-destructive",
            )}
          >
            {destLabel}
          </span>
        )}
        {editable && (
          <div className="flex shrink-0 flex-row items-center gap-1">
            {isRetargeting ? (
              <IconAction
                className="shrink-0"
                label="Cancel retarget"
                icon={X}
                variant="outline"
                pressed
                disabled={pending}
                onClick={onCancelPick}
              />
            ) : (
              <>
                <EditorDropdown
                  trigger={
                    <IconAction
                      className="shrink-0"
                      label="Change destination"
                      icon={Pencil}
                      variant="outline"
                      disabled={pending}
                    />
                  }
                  {...(pending ? { disabled: true } : {})}
                >
                  {(close) => (
                    <div className="flex flex-col items-start gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          onStartRetarget(edge.id, selectLabel);
                          close();
                        }}
                      >
                        Change destination
                      </Button>
                      {edge.from_option !== null && hasFallback && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            removeEdge.mutate(edge.id, { onError: onWriteError });
                            close();
                          }}
                        >
                          Use the default route instead
                        </Button>
                      )}
                      <Button
                        variant="danger"
                        size="sm"
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
                      </Button>
                    </div>
                  )}
                </EditorDropdown>
                <ConfirmAction
                  message="Remove this route?"
                  confirmLabel="Remove route"
                  danger
                  onConfirm={() => removeEdge.mutate(edge.id, { onError: onWriteError })}
                >
                  {(open) => (
                    <IconAction
                      label="Remove route"
                      icon={Trash2}
                      variant="danger"
                      className="shrink-0"
                      disabled={pending}
                      onClick={open}
                    />
                  )}
                </ConfirmAction>
              </>
            )}
          </div>
        )}
      </div>

      {footnote !== undefined && footnote !== "" && (
        <p className={cn(mutedHint, "mb-0")}>{footnote}</p>
      )}

      {isBroken && (
        <p className="text-destructive text-xs">
          This route leads to a question that has been archived or removed, so it would
          fail instead of continuing.
        </p>
      )}
      {isDead && !hideDeadNote && (
        <p className="text-destructive text-xs">
          This route is tied to an answer that is not one of this question's options
          anymore, so it can never happen.
        </p>
      )}

      {editable && isRetargeting && (
        <p className={cn(mutedHint, "mb-0")} role="status">
          Click a question on the canvas to send this route there, or press Esc to
          cancel.
        </p>
      )}

      {error !== null && (
        <Banner tone="error" role="alert">
          {error}
        </Banner>
      )}
    </div>
  );
}

/** A block of routes that has no label/code of its own to edit -- today
 * just "Can't be used" (dead-guard edges; the question-level route has
 * its own dedicated `DefaultRouteSection` instead, since it isn't one
 * more answer). Route remove lives on each `EdgeRow`, so this row has
 * no extra Edit toggle. */
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
  return (
    <li className={cn("flex flex-col gap-2", optCard)}>
      <h4 className={routeHeading}>{heading}</h4>
      <div className={treeBranch}>
        {note !== undefined && <p className="text-destructive text-xs">{note}</p>}
        {edges.map((edge) => (
          <EdgeRow
            key={edge.id}
            versionId={versionId}
            edge={edge}
            selectLabel={selectLabel}
            ctx={ctx}
            editable={editable}
            disabled={disabled}
            retargetingEdgeId={retargetingEdgeId}
            hasFallback={false}
            hideDeadNote={note !== undefined}
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
 * uses when it has no explicit route of its own. Sits first inside the
 * Options section, as a folder. Leftover answers that actually take this
 * route are `children`, listed under the destination so they read as one
 * group rather than empty rows of their own. Adding one uses the same
 * canvas picker as a specific route (`onStartAddRoute` with
 * `optionId === null`), plus End the flow here -- the server allows only
 * one default route, so the add controls hide once this question has one. */
function DefaultRouteSection({
  versionId,
  questionId,
  takesOptions,
  answerType,
  edges,
  ctx,
  editable,
  disabled,
  retargetingEdgeId,
  addingRouteOptionId,
  addingRouteQuestionId,
  onSelectQuestion,
  onStartRetarget,
  onStartAddRoute,
  onCancelPick,
  children,
}: {
  versionId: UUID;
  questionId: UUID;
  takesOptions: boolean;
  answerType: Question["answer_type"];
  edges: Edge[];
  ctx: EdgeContext;
  editable: boolean;
  disabled: boolean;
  retargetingEdgeId: UUID | null;
  addingRouteOptionId: UUID | null;
  addingRouteQuestionId: UUID | null;
  onSelectQuestion: (id: UUID) => void;
  onStartRetarget: (edgeId: UUID, label: string) => void;
  onStartAddRoute: (questionId: UUID, optionId: UUID | null, label: string) => void;
  onCancelPick: () => void;
  children?: ReactNode;
}) {
  const onWriteError = useWriteErrorHandler();
  const addEdge = useAddEdge(versionId);
  const headingId = useId();
  const isAddingDefault =
    addingRouteQuestionId === questionId && addingRouteOptionId === null;
  const pending = addEdge.isPending || disabled;

  function endFlow() {
    onCancelPick();
    addEdge.mutate(
      { from_question: questionId, from_option: null, to_question: null },
      { onError: onWriteError },
    );
  }

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      data-slot="tree-folder"
      className={cn("flex flex-col gap-2", optCard)}
    >
      <div className="flex min-w-0 flex-row flex-wrap items-center gap-2">
        <h4 id={headingId} className={cn(routeHeading, "mb-0 shrink-0")}>
          Default route
        </h4>
        {edges.map((edge) => (
          <div key={edge.id} className="min-w-0 flex-1">
            <EdgeRow
              versionId={versionId}
              edge={edge}
              selectLabel="Where the default route leads"
              ctx={ctx}
              editable={editable}
              disabled={disabled}
              retargetingEdgeId={retargetingEdgeId}
              hasFallback={false}
              {...(answerType === "scale"
                ? { footnote: INTEGER_ANSWER_EDGE_LABEL }
                : {})}
              onSelectQuestion={onSelectQuestion}
              onStartRetarget={onStartRetarget}
              onCancelPick={onCancelPick}
            />
          </div>
        ))}
      </div>

      {edges.length > 0 && children ? (
        <div className={defaultStem}>{children}</div>
      ) : null}

      {editable && edges.length === 0 && (
        <div className={defaultStem}>
          {isAddingDefault && (
            <p className={cn(mutedHint, "mb-0")} role="status">
              Click a question on the canvas to send this route there, or press Esc to
              cancel.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {isAddingDefault ? (
              <IconAction
                label="Cancel add route"
                icon={X}
                variant="outline"
                pressed
                disabled={pending}
                onClick={onCancelPick}
              />
            ) : (
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => onStartAddRoute(questionId, null, "the default route")}
              >
                {takesOptions ? "+ Add a default route" : "+ Add a route"}
              </Button>
            )}
            <Button variant="danger" size="sm" disabled={pending} onClick={endFlow}>
              End the flow here
            </Button>
          </div>
          {writeErrorMessage(addEdge.error) !== null && (
            <Banner tone="error" role="alert">
              {writeErrorMessage(addEdge.error)}
            </Banner>
          )}
        </div>
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
  /** Specific-route answers get a `Choice:` heading that matches Default
   * route. Leftover answers nested under Default route keep their label. */
  asChoice?: boolean;
  /** Own card, same chrome as Default route. Listed answers use this;
   * leftovers nested inside the default card do not. */
  boxed?: boolean;
  onSelectQuestion: (id: UUID) => void;
  onStartRetarget: (edgeId: UUID, label: string) => void;
  onStartAddRoute: (questionId: UUID, optionId: UUID | null, label: string) => void;
  onCancelPick: () => void;
}

/** One answer, one tree row: what it's called, what leads from it, and
 * (when editable) every control for both. Rename and default-vs-specific
 * path live in the edit dialog; delete sits next to the pencil and asks
 * first. Route remove lives on `EdgeRow` the same way. Combines what were
 * three separate places (a read-only Options list, a separate "Edit
 * options" form, and `EdgeEditor`'s own "Outgoing edges" list) into the
 * one place somebody actually thinks about an answer: together with
 * where it goes. */
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
  asChoice = false,
  boxed = false,
  onSelectQuestion,
  onStartRetarget,
  onStartAddRoute,
  onCancelPick,
}: OptionCardProps) {
  const onWriteError = useWriteErrorHandler();
  const updateOption = useUpdateOption(versionId);
  const removeOption = useRemoveOption(versionId);
  const removeEdge = useRemoveEdge(versionId);

  const labelId = useId();
  const pathGroupId = useId();
  const [label, setLabel] = useState(option.label);
  const [path, setPath] = useState<"default" | "specific">(() =>
    edges.length > 0 ? "specific" : "default",
  );
  const isAddingRoute = addingRouteOptionId === option.id;
  const optionChange = ctx.optionChangeKinds.get(option.id);
  // Only an option this draft itself introduced ("added" against the
  // parent version) may have its code rewritten -- `editing.update_option`
  // outright refuses a code change on one this draft inherited, so an
  // inherited option's rename must never touch it.
  const isDraftNew = optionChange === "added";

  const dirty = label !== option.label;
  const initialPath: "default" | "specific" = edges.length > 0 ? "specific" : "default";
  const pathDirty = path !== initialPath;
  const pending =
    updateOption.isPending ||
    removeOption.isPending ||
    removeEdge.isPending ||
    disabled;
  const error =
    writeErrorMessage(updateOption.error) ??
    writeErrorMessage(removeOption.error) ??
    writeErrorMessage(removeEdge.error);
  // Named, not just counted: `editing.OptionGuardedError.detail_payload`
  // lists the actual edges a delete would strand, so the refusal is
  // somewhere to click through to rather than a number to go hunting for.
  const blockingEdges =
    removeOption.error instanceof ApiError ? removeOption.error.blockingEdges : null;

  const hasBody = error !== null || edges.length > 0 || isAddingRoute;

  function saveLabel(onDone: () => void) {
    if (!dirty) {
      onDone();
      return;
    }
    updateOption.mutate(
      {
        optionId: option.id,
        changes: isDraftNew ? { label, code: slugify(label) } : { label },
      },
      { onError: onWriteError, onSuccess: onDone },
    );
  }

  function applyDefaultPath(onDone: () => void) {
    if (edges.length === 0) {
      onDone();
      return;
    }
    let remaining = edges.length;
    for (const edge of edges) {
      removeEdge.mutate(edge.id, {
        onError: onWriteError,
        onSuccess: () => {
          remaining -= 1;
          if (remaining === 0) onDone();
        },
      });
    }
  }

  function chooseDestination(close: () => void) {
    saveLabel(() => {
      close();
      const own = edges[0];
      if (own !== undefined) {
        onStartRetarget(own.id, `Where "${option.label}" leads`);
      } else {
        onStartAddRoute(questionId, option.id, `"${option.label}"'s new route`);
      }
    });
  }

  const toolbar = editable ? (
    <div className="flex shrink-0 flex-row items-center gap-1">
      {isAddingRoute && (
        <IconAction
          label="Cancel specific route"
          icon={X}
          variant="outline"
          pressed
          onClick={onCancelPick}
        />
      )}
      <EditorDialog
        title="Edit answer"
        onOpenChange={(open) => {
          if (open) {
            setLabel(option.label);
            setPath(edges.length > 0 ? "specific" : "default");
          }
        }}
        trigger={
          <IconAction
            label="Edit answer"
            icon={Pencil}
            variant="outline"
            disabled={pending}
          />
        }
      >
        {(close) => (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!dirty && !pathDirty) return;
              saveLabel(() => {
                if (path === "default") applyDefaultPath(close);
                else close();
              });
            }}
          >
            <Field label="Label" htmlFor={labelId}>
              <Input
                id={labelId}
                value={label}
                required
                {...(pending ? { disabled: true } : {})}
                onChange={(event) => setLabel(event.target.value)}
              />
            </Field>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Path</legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={pathGroupId}
                  value="default"
                  checked={path === "default"}
                  disabled={pending}
                  onChange={() => setPath("default")}
                />
                Default path
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={pathGroupId}
                  value="specific"
                  checked={path === "specific"}
                  disabled={pending}
                  onChange={() => setPath("specific")}
                />
                Specific path
              </label>
              {path === "specific" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => chooseDestination(close)}
                >
                  Choose destination
                </Button>
              )}
            </fieldset>
            <div className={editorActions}>
              <Button
                variant="primary"
                type="submit"
                loading={updateOption.isPending || removeEdge.isPending}
                disabled={(!dirty && !pathDirty) || removeOption.isPending || disabled}
              >
                Save
              </Button>
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setLabel(option.label);
                  setPath(initialPath);
                  close();
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </EditorDialog>
      <ConfirmAction
        message={`Delete "${option.label}"?`}
        confirmLabel="Delete answer"
        danger
        onConfirm={() => removeOption.mutate(option.id, { onError: onWriteError })}
      >
        {(open) => (
          <IconAction
            label="Delete answer"
            icon={Trash2}
            variant="danger"
            disabled={pending || isGuard}
            title={
              isGuard
                ? "A route still uses this answer. Remove that route first."
                : "Delete answer"
            }
            onClick={open}
          />
        )}
      </ConfirmAction>
    </div>
  ) : null;

  const title = asChoice ? (
    <h4 className={cn(routeHeading, "min-w-0 truncate")} title={option.label}>
      Choice: <span>{option.label}</span>
    </h4>
  ) : (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="min-w-0 truncate text-sm leading-snug font-medium">
        {option.label}
      </span>
      {isUncovered && (
        <span title="No route covers this answer">
          <TriangleAlert
            className="size-3.5 shrink-0 text-destructive"
            aria-label="No route covers this answer"
          />
        </span>
      )}
    </span>
  );

  const body = (
    <>
      {error !== null && (
        <Banner as="div" tone="error" role="alert">
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
        </Banner>
      )}

      {edges.map((edge) => (
        <EdgeRow
          key={edge.id}
          versionId={versionId}
          edge={edge}
          selectLabel={`Where "${option.label}" leads`}
          ctx={ctx}
          editable={editable}
          disabled={disabled}
          retargetingEdgeId={retargetingEdgeId}
          hasFallback={hasFallback}
          onSelectQuestion={onSelectQuestion}
          onStartRetarget={onStartRetarget}
          onCancelPick={onCancelPick}
        />
      ))}

      {isAddingRoute && (
        <p className={cn(mutedHint, "mb-0")} role="status">
          Click a question on the canvas to route this answer there, or press Esc to
          cancel.
        </p>
      )}
    </>
  );

  return (
    <li
      className={cn("flex flex-col gap-2", boxed && optCard)}
      data-slot="tree-item"
    >
      <div className="flex min-w-0 flex-row items-center justify-between gap-2">
        {title}
        {toolbar}
      </div>
      {hasBody && <div className={treeBranch}>{body}</div>}
    </li>
  );
}

export function Options({
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
  changeKinds = EMPTY_CHANGE_KINDS,
}: OptionsProps) {
  const versionId = graph.version.id;
  const onWriteError = useWriteErrorHandler();
  const addOption = useAddOption(versionId);

  const optionLabelId = useId();
  const leftoverHeadingId = useId();
  const newPathGroupId = useId();
  const [newOptionLabel, setNewOptionLabel] = useState("");
  const [newPath, setNewPath] = useState<"default" | "specific">("default");

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
    targets,
    deadEdges,
    brokenEdges,
    edgeChangeKinds: changeKinds.edges,
    optionChangeKinds: changeKinds.options,
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

  // Leftover answers: listed options with no higher-priority route of
  // their own, so they actually take the default route. They belong
  // inside that folder (same destination, one group) instead of as empty
  // sibling rows. The first `from_option === null` edge is the one that
  // fires -- same pick `optionsCoveredByFallback` uses on the canvas.
  const leftoverOptions = useMemo(() => {
    const fallback = edges.find((edge) => edge.from_option === null);
    if (fallback === undefined || !takesOptions) return [];
    return optionsCoveredByFallback(question, edges, fallback);
  }, [edges, takesOptions, question]);
  const leftoverIds = useMemo(
    () => new Set(leftoverOptions.map((option) => option.id)),
    [leftoverOptions],
  );
  const listedOptions = useMemo(
    () => options.filter((option) => !leftoverIds.has(option.id)),
    [options, leftoverIds],
  );

  // A dead edge is guarded by an option this question doesn't offer (it
  // belongs to a different question entirely) -- exactly the one guard
  // key `edgesByGuard` can hold that never matches an id in `options`.
  // Grouping strictly by this question's own options would make those
  // edges vanish from the panel instead of just failing to route, so
  // anything left over after every real option and "anything else" gets
  // its row is swept into one more, rather than silently dropped.
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
    <section className="flex flex-col gap-4" aria-labelledby="options-heading">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="options-heading" className={cn(subHeading, "mb-0")}>
          {takesOptions ? "Answers" : "Route"}{" "}
          <span className={subCount}>{cardCount}</span>
        </h3>
        <Badge tone="meta">{answerTypeLabel(question.answer_type)}</Badge>
        {!question.is_required && <Badge tone="meta">Optional</Badge>}
      </div>

      {(anyAnswerEdges.length > 0 || editable) && (
        <DefaultRouteSection
          versionId={versionId}
          questionId={question.id}
          takesOptions={takesOptions}
          answerType={question.answer_type}
          edges={anyAnswerEdges}
          ctx={ctx}
          editable={editable}
          disabled={pending}
          retargetingEdgeId={retargetingEdgeId}
          addingRouteOptionId={addingRouteOptionId}
          addingRouteQuestionId={addingRouteQuestionId}
          onSelectQuestion={onSelectQuestion}
          onStartRetarget={onStartRetarget}
          onStartAddRoute={onStartAddRoute}
          onCancelPick={onCancelPick}
        >
          {leftoverOptions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <h5 id={leftoverHeadingId} className={cn(subHeading, "mb-0")}>
                Answers{" "}
                <span className={subCount}>{leftoverOptions.length}</span>
              </h5>
              <ol
                className="flex list-none flex-col gap-1.5 p-0"
                aria-labelledby={leftoverHeadingId}
              >
                {leftoverOptions.map((option) => (
                  <OptionCard
                    key={option.id}
                    versionId={versionId}
                    questionId={question.id}
                    option={option}
                    edges={edgesByGuard.get(option.id) ?? []}
                    ctx={ctx}
                    isUncovered={false}
                    hasFallback
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
              </ol>
            </div>
          )}
        </DefaultRouteSection>
      )}

      {options.length === 0 && deadGuardEdges.length === 0 ? (
        anyAnswerEdges.length === 0 && (
          <p className={cn(emptyText, "my-0")}>
            {takesOptions
              ? "This question has no answers yet."
              : "Nothing leads anywhere yet."}
          </p>
        )
      ) : (
        <>
          {listedOptions.length > 0 && (
            <ol className="flex list-none flex-col gap-4 p-0">
              {listedOptions.map((option) => (
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
                  asChoice={(edgesByGuard.get(option.id) ?? []).length > 0}
                  boxed
                  onSelectQuestion={onSelectQuestion}
                  onStartRetarget={onStartRetarget}
                  onStartAddRoute={onStartAddRoute}
                  onCancelPick={onCancelPick}
                />
              ))}
            </ol>
          )}

          {deadGuardEdges.length > 0 && (
            <ul className="flex list-none flex-col gap-4 p-0">
              <EdgeGroupCard
                heading="Can't be used"
                note="Tied to an answer this question doesn't have anymore, so these can never happen. They can only be removed."
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
            </ul>
          )}
        </>
      )}

      {editable && takesOptions && (
        <EditorDialog
          title="Add an answer"
          onOpenChange={(open) => {
            if (open) {
              setNewOptionLabel("");
              setNewPath("default");
            }
          }}
          trigger={<Button variant="ghost">+ Add an answer</Button>}
        >
          {(close) => {
            function addThen(startRoute: boolean) {
              addOption.mutate(
                {
                  question: question.id,
                  code: slugify(newOptionLabel),
                  label: newOptionLabel,
                },
                {
                  onError: onWriteError,
                  onSuccess: (created) => {
                    setNewOptionLabel("");
                    close();
                    if (startRoute) {
                      onStartAddRoute(
                        question.id,
                        created.id,
                        `"${created.label}"'s new route`,
                      );
                    }
                  },
                },
              );
            }

            return (
              <form
                className="flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  addThen(false);
                }}
              >
                <Field label="Label" htmlFor={optionLabelId}>
                  <Input
                    id={optionLabelId}
                    value={newOptionLabel}
                    required
                    {...(pending ? { disabled: true } : {})}
                    onChange={(event) => setNewOptionLabel(event.target.value)}
                  />
                </Field>
                <fieldset className="flex flex-col gap-2">
                  <legend className="text-sm font-medium">Path</legend>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={newPathGroupId}
                      value="default"
                      checked={newPath === "default"}
                      disabled={pending}
                      onChange={() => setNewPath("default")}
                    />
                    Default path
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={newPathGroupId}
                      value="specific"
                      checked={newPath === "specific"}
                      disabled={pending}
                      onChange={() => setNewPath("specific")}
                    />
                    Specific path
                  </label>
                  {newPath === "specific" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending || newOptionLabel.trim() === ""}
                      onClick={() => addThen(true)}
                    >
                      Choose destination
                    </Button>
                  )}
                </fieldset>
                <div className={editorActions}>
                  <Button
                    variant="primary"
                    type="submit"
                    loading={addOption.isPending}
                    disabled={newOptionLabel.trim() === ""}
                  >
                    Add option
                  </Button>
                  <Button variant="ghost" disabled={pending} onClick={close}>
                    Cancel
                  </Button>
                </div>
              </form>
            );
          }}
        </EditorDialog>
      )}

      {error !== null && (
        <Banner tone="error" role="alert">
          {error}
        </Banner>
      )}
    </section>
  );
}
