import { useId, useMemo, useState, type ReactNode } from "react";

import {
  ArrowUpRight,
  Check,
  CircleHelp,
  Pencil,
  Trash2,
  Unlink,
  X,
} from "lucide-react";
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
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, nativeSelectClassName } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTrigger,
} from "@/components/ui/popover";
import { BlockingList } from "./BlockingList";
import { ConfirmAction } from "./ConfirmAction";
import { EditorDropdown } from "./EditorDropdown";
import type { ChangeKind, ChangeKinds } from "./graphElements";
import { optionsCoveredByFallback } from "./graphElements";
import { targetLabel } from "./labels";
import {
  emptyText,
  editorActions,
  editorBox,
  mutedHint,
  questionLink,
  subCount,
  subHeading,
} from "@/lib/chrome";
import { slugify } from "@/lib/slug";
import { cn } from "@/lib/utils";
import { useWriteErrorHandler, writeErrorMessage } from "./useWriteError";

const END_OF_FLOW = "__end__";
const ANY_ANSWER = "__any__";
const EMPTY_CHANGE_KINDS: ChangeKinds = {
  questions: new Map(),
  options: new Map(),
  edges: new Map(),
};

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

/** A help control beside a heading. The short `label` is the button's
 * accessible name; `text` is the explanation, shown in a Popover so it
 * doesn't take a row on every card. */
function HelpHint({ label, text }: { label: string; text: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-5 text-muted-foreground"
          aria-label={label}
        >
          <CircleHelp />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 text-xs">
        <PopoverDescription>{text}</PopoverDescription>
      </PopoverContent>
    </Popover>
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

  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          "min-w-0 text-sm",
          edge.to_question === null && "text-destructive",
        )}
      >
        {edge.to_question !== null && targetQuestion !== undefined ? (
          <Button
            variant="link"
            className={questionLink}
            aria-label={`Go to ${targetQuestion.code}: ${targetQuestion.prompt}`}
            onClick={() => onSelectQuestion(edge.to_question as UUID)}
          >
            <span className="underline underline-offset-2">
              {targetQuestion.archived_at === null
                ? targetQuestion.prompt
                : `${targetQuestion.prompt} (archived)`}
            </span>
            <ArrowUpRight aria-hidden="true" />
          </Button>
        ) : (
          targetLabel(edge, ctx.questionsById)
        )}
      </div>

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

      {editable && (
        <div className="flex flex-wrap items-center gap-1.5">
          {isRetargeting ? (
            <IconAction
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
                  <Button variant="outline" size="sm">
                    Change destination
                  </Button>
                }
                {...(pending ? { disabled: true } : {})}
              >
                {(close) => (
                  <div className="flex flex-col items-start gap-2">
                    <p className={mutedHint}>What should happen after this answer?</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        onStartRetarget(edge.id, selectLabel);
                        close();
                      }}
                    >
                      Jump to a specific question
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
                    icon={Unlink}
                    variant="danger"
                    disabled={pending}
                    onClick={open}
                  />
                )}
              </ConfirmAction>
            </>
          )}
        </div>
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
 * more answer). Route remove lives on each `EdgeRow`, so this card has
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
    <li>
      <Card size="sm">
        <CardHeader className="border-b">
          <CardTitle>{heading}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {note !== undefined && (
            <CardDescription className="text-destructive">{note}</CardDescription>
          )}
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
        </CardContent>
      </Card>
    </li>
  );
}

/** The question-level route (`from_option === null`) -- the one any answer
 * uses when it has no explicit route of its own. Sits first inside the
 * Options section. Leftover answers that actually take this route are
 * `children`, listed under the destination so they read as one group
 * rather than empty cards of their own. Owns its own "+ Add a default
 * route" form (only shown once this question has none yet -- the server
 * allows only one). */
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
  children,
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
  children?: ReactNode;
}) {
  const onWriteError = useWriteErrorHandler();
  const addEdge = useAddEdge(versionId);
  const addTargetId = useId();
  const [addingEdge, setAddingEdge] = useState(false);
  const [newTarget, setNewTarget] = useState<string>(END_OF_FLOW);

  const hasBody = edges.length > 0 || (editable && edges.length === 0);

  return (
    <Card size="sm" className="gap-2">
      <CardHeader className={hasBody ? "border-b pb-2" : undefined}>
        <h4 className={cn(subHeading, "mb-0")}>Default route</h4>
        <CardAction className="flex items-center gap-1">
          <HelpHint
            label="What the default route does"
            text={
              takesOptions
                ? "Used when an answer has no route of its own. An answer's own route always wins over this."
                : "This route applies no matter what's answered."
            }
          />
        </CardAction>
      </CardHeader>

      {edges.length > 0 && (
        <CardContent className="flex flex-col gap-3 px-2.5 pt-0">
          {edges.map((edge) => (
            <EdgeRow
              key={edge.id}
              versionId={versionId}
              edge={edge}
              selectLabel="Where the default route leads"
              ctx={ctx}
              editable={editable}
              disabled={disabled}
              retargetingEdgeId={retargetingEdgeId}
              hasFallback={false}
              onSelectQuestion={onSelectQuestion}
              onStartRetarget={onStartRetarget}
              onCancelPick={onCancelPick}
            />
          ))}
          {children}
        </CardContent>
      )}

      {editable && edges.length === 0 && (
        <CardContent className="flex flex-col gap-2">
          {addingEdge ? (
            <form
              className={cn(editorBox, "mt-0")}
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
              <Field label="Go to" htmlFor={addTargetId}>
                <select
                  id={addTargetId}
                  className={nativeSelectClassName}
                  value={newTarget}
                  {...(addEdge.isPending || disabled ? { disabled: true } : {})}
                  onChange={(event) => setNewTarget(event.target.value)}
                >
                  <option value={END_OF_FLOW}>End of flow</option>
                  {ctx.targets.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.code}
                    </option>
                  ))}
                </select>
              </Field>
              <div className={editorActions}>
                <Button
                  variant="primary"
                  type="submit"
                  loading={addEdge.isPending}
                  disabled={disabled}
                >
                  Add route
                </Button>
                <Button
                  variant="ghost"
                  disabled={addEdge.isPending || disabled}
                  onClick={() => setAddingEdge(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="ghost" onClick={() => setAddingEdge(true)}>
              {takesOptions ? "+ Add a default route" : "+ Add a route"}
            </Button>
          )}
          {writeErrorMessage(addEdge.error) !== null && (
            <Banner tone="error" role="alert">
              {writeErrorMessage(addEdge.error)}
            </Banner>
          )}
        </CardContent>
      )}
    </Card>
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
  /** Inside the default-route card: no nested Card, so leftover answers
   * read as members of that route rather than a second stack of cards. */
  nested?: boolean;
  onSelectQuestion: (id: UUID) => void;
  onStartRetarget: (edgeId: UUID, label: string) => void;
  onStartAddRoute: (questionId: UUID, optionId: UUID | null, label: string) => void;
  onCancelPick: () => void;
}

/** One answer, one card: what it's called, what leads from it, and (when
 * editable) every control for both. Rename sits behind a pencil; delete
 * sits next to it and asks first. Route remove lives on `EdgeRow` the
 * same way. Combines what were three separate places (a read-only
 * Options list, a separate "Edit options" form, and `EdgeEditor`'s own
 * "Outgoing edges" list) into the one place somebody actually thinks
 * about an answer: together with where it goes. */
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
  nested = false,
  onSelectQuestion,
  onStartRetarget,
  onStartAddRoute,
  onCancelPick,
}: OptionCardProps) {
  const onWriteError = useWriteErrorHandler();
  const updateOption = useUpdateOption(versionId);
  const removeOption = useRemoveOption(versionId);

  const labelId = useId();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(option.label);
  const isAddingRoute = addingRouteOptionId === option.id;
  const optionChange = ctx.optionChangeKinds.get(option.id);
  // Only an option this draft itself introduced ("added" against the
  // parent version) may have its code rewritten -- `editing.update_option`
  // outright refuses a code change on one this draft inherited, so an
  // inherited option's rename must never touch it.
  const isDraftNew = optionChange === "added";

  const dirty = label !== option.label;
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
    setEditing(false);
  }

  function save() {
    updateOption.mutate(
      {
        optionId: option.id,
        changes: isDraftNew ? { label, code: slugify(label) } : { label },
      },
      { onError: onWriteError, onSuccess: () => setEditing(false) },
    );
  }

  const hasBody =
    isUncovered ||
    error !== null ||
    edges.length > 0 ||
    (editable && edges.length === 0);

  const toolbar = editable ? (
    editing ? (
      <div className="flex items-center gap-1">
        <IconAction
          label="Save"
          icon={Check}
          variant="primary"
          loading={updateOption.isPending}
          disabled={!dirty || removeOption.isPending || disabled}
          onClick={save}
        />
        <IconAction label="Cancel" icon={X} disabled={pending} onClick={cancel} />
      </div>
    ) : (
      <div className="flex items-center gap-1">
        <IconAction
          label="Edit answer"
          icon={Pencil}
          variant="outline"
          disabled={pending}
          onClick={() => setEditing(true)}
        />
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
    )
  ) : null;

  const title = editing ? (
    <Input
      id={labelId}
      aria-label="Label"
      value={label}
      className="min-w-[120px]"
      {...(pending ? { disabled: true } : {})}
      onChange={(event) => setLabel(event.target.value)}
    />
  ) : (
    <span className="text-sm font-medium leading-snug">{option.label}</span>
  );

  const body = (
    <>
      {isUncovered && (
        <p className="text-destructive text-xs">
          No route covers this answer yet, so choosing it ends the flow.
        </p>
      )}

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

      {editable && edges.length === 0 && (
        <>
          {isAddingRoute && (
            <p className={cn(mutedHint, "mb-0")} role="status">
              Click a question on the canvas to route this answer there, or press Esc to
              cancel.
            </p>
          )}
          {isAddingRoute ? (
            <IconAction
              label="Cancel specific route"
              icon={X}
              variant="outline"
              pressed
              onClick={onCancelPick}
            />
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() =>
                onStartAddRoute(questionId, option.id, `"${option.label}"'s new route`)
              }
            >
              Add a specific route
            </Button>
          )}
        </>
      )}
    </>
  );

  if (nested) {
    return (
      <li className="flex flex-col gap-2 rounded-[10px] bg-background p-2.5 ring-1 ring-border">
        <div className="flex items-start justify-between gap-2">
          {title}
          {toolbar}
        </div>
        {hasBody && body}
      </li>
    );
  }

  return (
    <li>
      <Card size="sm">
        <CardHeader className={hasBody ? "border-b" : undefined}>
          {editing ? (
            title
          ) : (
            <CardTitle className="text-sm leading-snug">{title}</CardTitle>
          )}
          {toolbar !== null && <CardAction>{toolbar}</CardAction>}
        </CardHeader>
        {hasBody && <CardContent className="flex flex-col gap-2">{body}</CardContent>}
      </Card>
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
  changeKinds = EMPTY_CHANGE_KINDS,
}: OptionsProps) {
  const versionId = graph.version.id;
  const onWriteError = useWriteErrorHandler();
  const addOption = useAddOption(versionId);

  const optionLabelId = useId();
  const leftoverHeadingId = useId();
  const [addingOption, setAddingOption] = useState(false);
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
  // inside that card (same destination, one group) instead of as empty
  // sibling cards. The first `from_option === null` edge is the one that
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
    <section className="flex flex-col gap-3" aria-labelledby="options-heading">
      <div className="flex items-center gap-2">
        <h3 id="options-heading" className={cn(subHeading, "mb-0")}>
          Options <span className={subCount}>{cardCount}</span>
        </h3>
        {editable && (
          <HelpHint
            label="How answers route"
            text={
              "Where each answer leads. Ties go to the first route listed. To send an answer somewhere specific, click a button below, then pick the destination on the canvas."
            }
          />
        )}
      </div>

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
        >
          {leftoverOptions.length > 0 && (
            <div className="flex flex-col gap-2">
              <h5 id={leftoverHeadingId} className={cn(subHeading, "mb-0")}>
                Takes this route{" "}
                <span className={subCount}>{leftoverOptions.length}</span>
              </h5>
              <ol
                className="flex list-none flex-col gap-2 p-0"
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
                    nested
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
              : "Nothing leads anywhere yet, so answering this question ends the flow."}
          </p>
        )
      ) : (
        <>
          {listedOptions.length > 0 && (
            <ol className="flex list-none flex-col gap-2 p-0">
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
                  onSelectQuestion={onSelectQuestion}
                  onStartRetarget={onStartRetarget}
                  onStartAddRoute={onStartAddRoute}
                  onCancelPick={onCancelPick}
                />
              ))}
            </ol>
          )}

          {deadGuardEdges.length > 0 && (
            <ul className="flex list-none flex-col gap-2 p-0">
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

      {editable && (
        <div className="flex flex-col items-start gap-3">
          {takesOptions ? (
            addingOption ? (
              <form
                className={editorBox}
                onSubmit={(event) => {
                  event.preventDefault();
                  addOption.mutate(
                    {
                      question: question.id,
                      code: slugify(newOptionLabel),
                      label: newOptionLabel,
                    },
                    {
                      onError: onWriteError,
                      onSuccess: () => {
                        setNewOptionLabel("");
                        setAddingOption(false);
                      },
                    },
                  );
                }}
              >
                <Field label="Label" htmlFor={optionLabelId}>
                  <Input
                    id={optionLabelId}
                    value={newOptionLabel}
                    required
                    placeholder="What a respondent reads"
                    {...(pending ? { disabled: true } : {})}
                    onChange={(event) => setNewOptionLabel(event.target.value)}
                  />
                </Field>
                <div className={editorActions}>
                  <Button
                    variant="primary"
                    type="submit"
                    loading={addOption.isPending}
                    disabled={newOptionLabel.trim() === ""}
                  >
                    Add option
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setAddingOption(false)}
                  >
                    Cancel
                  </Button>
                </div>
                {/* Appended, never inserted: a unique constraint on
                    (question, display_order) makes an insertion a renumbering,
                    which is what the up/down controls above do. */}
                <p className={mutedHint}>
                  Added last. A new answer with no route yet just ends the flow if
                  picked. That's fine, and it's not refused, because answers are added
                  before the routes that lead from them.
                </p>
              </form>
            ) : (
              <Button variant="ghost" onClick={() => setAddingOption(true)}>
                + Add an answer
              </Button>
            )
          ) : (
            <p className={mutedHint}>
              This question's answers don't use separate options, like a written
              response or a number, so there's nothing to add here.
            </p>
          )}
        </div>
      )}

      {error !== null && (
        <Banner tone="error" role="alert">
          {error}
        </Banner>
      )}
    </section>
  );
}
