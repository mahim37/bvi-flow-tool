import { useId, useState } from "react";
import type { ReactNode } from "react";

import {
  PUBLISH_FLOW_TOOL,
  type ChangeRequest,
  type Graph,
  type UUID,
  type VersionListItem,
} from "../api/types";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { TabsLink, TabsNav } from "@/components/ui/nav-tabs";
import {
  useActivateVersion,
  useCreateDraft,
  useDiscardDraft,
  useRedoDraft,
  useReleaseLock,
  useSubmitDraft,
  useUndoDraft,
  useWithdrawDraft,
} from "../api/queries";
import { useAuth } from "../auth/useAuth";
import { AlertsButton } from "./AlertsButton";
import type { ChromeAlert } from "./AlertsButton";
import { ConfirmAction } from "./ConfirmAction";
import { EditorDialog } from "./EditorDialog";
import { isUnderReview, reviewRoundFrom, sameEmail } from "./draftState";
import {
  editHistoryTooltip,
  formatTimestamp,
  statusLabel,
  statusMeaning,
  versionLabel,
} from "./labels";
import { SubmitForReview } from "./SubmitForReview";
import {
  useReviewErrorHandler,
  useWriteErrorHandler,
  writeErrorMessage,
} from "./useWriteError";

interface DraftBarProps {
  graph: Graph;
  /** Live proposal from `graph/` + `review/` + `proposals/`. Falls back
   * to `graph.change_request` when the layout has not passed one yet. */
  proposal?: ChangeRequest | null;
  /** Every version of the current questionnaire, drafts included --
   * `editing.create_draft` refuses a second one while any of these has
   * `is_draft: true`, so this is how "Propose a change" knows to offer
   * a link to the existing one instead of a form the server would just
   * 409 on. Already fetched and scoped to this product by
   * `VersionLayout`; not a second request. */
  versions: VersionListItem[];
  /** Null means "nowhere in particular" -- the version landing screen,
   * which picks a sensible default. Only `discard` ever passes it: every
   * other caller (propose) always has a real id, the thing it just
   * created. */
  onOpenVersion: (versionId: UUID | null) => void;
}

/** Map/Review/Preview — a compact cluster centered in the sidebar
 * column, not stretched to its edges. */
function VersionTabs({ versionId, isDraft }: { versionId: UUID; isDraft: boolean }) {
  return (
    <TabsNav label="Version views">
      <TabsLink end to={`/versions/${versionId}`}>
        Map
      </TabsLink>
      <TabsLink to={`/versions/${versionId}/review`}>
        {isDraft ? "Review" : "What changed"}
      </TabsLink>
      <TabsLink to={`/versions/${versionId}/preview`}>Preview</TabsLink>
    </TabsNav>
  );
}

/** Left column is the sidebar's width; the switcher sits in the middle
 * of that cell. Status and actions use the rest. */
function DraftChrome({
  versionId,
  isDraft,
  children,
  after,
}: {
  versionId: UUID;
  isDraft: boolean;
  children: ReactNode;
  after?: ReactNode;
}) {
  return (
    <div className="border-t border-border bg-background">
      <div className="flex items-stretch">
        <div className="flex w-(--sidebar-width) min-w-(--sidebar-width) max-w-(--sidebar-width) items-center justify-center border-r border-border px-2">
          <VersionTabs versionId={versionId} isDraft={isDraft} />
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3 px-4 py-2">
          {children}
        </div>
      </div>
      {after !== undefined && after !== null ? (
        <div className="space-y-2 px-4 pb-2">{after}</div>
      ) : null}
    </div>
  );
}

/** A plain, single-line button whose longer explanation surfaces as a
 * native tooltip (`title`) rather than a second line of text under the
 * label -- keeps the button itself compact; used where the click itself
 * doesn't already open some other overlay that could carry the same text
 * (see `ConfirmAction`/`EditorDialog` call sites, which fold it in
 * there instead). */
function Cta({
  primary = false,
  title,
  description,
  disabled,
  loading,
  onClick,
}: {
  primary?: boolean;
  title: string;
  description?: string;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant={primary ? "primary" : "default"}
      onClick={onClick}
      {...(description !== undefined ? { title: description } : {})}
      {...(disabled !== undefined ? { disabled } : {})}
      {...(loading !== undefined ? { loading } : {})}
    >
      {title}
    </Button>
  );
}

export function DraftBar({ graph, proposal, versions, onOpenVersion }: DraftBarProps) {
  const { identity, editRefused, reviewRefused } = useAuth();
  const onWriteError = useWriteErrorHandler();
  const onReviewError = useReviewErrorHandler();
  const versionId = graph.version.id;
  const changeRequest = proposal ?? graph.change_request;
  // Assigned to a local rather than read off `graph.edit_history` at each
  // use, the same reasoning `changeRequest` above already follows: TS
  // narrows a `const` across the closures below, which it will not do for
  // a prop's own property. Coalesced to `null` the same way `useAuth`
  // guards `identity.permission_codes` -- the field is typed as always
  // present, but a backend that has not yet deployed the undo/redo
  // release omits the key entirely rather than sending an explicit
  // `null`, which `graph.edit_history` on its own would read as
  // `undefined` and crash the `.undo`/`.can_undo` reads below.
  const editHistory = graph.edit_history ?? null;

  const labelId = useId();
  const [label, setLabel] = useState("");

  const createDraft = useCreateDraft();
  const discardDraft = useDiscardDraft();
  const submitDraft = useSubmitDraft(versionId);
  const withdrawDraft = useWithdrawDraft(versionId);
  const releaseLock = useReleaseLock(versionId);
  const activate = useActivateVersion(versionId);
  const undoDraft = useUndoDraft(versionId);
  const redoDraft = useRedoDraft(versionId);

  const error =
    writeErrorMessage(createDraft.error) ??
    writeErrorMessage(discardDraft.error) ??
    writeErrorMessage(submitDraft.error) ??
    writeErrorMessage(withdrawDraft.error) ??
    writeErrorMessage(activate.error) ??
    writeErrorMessage(undoDraft.error) ??
    writeErrorMessage(redoDraft.error);

  function startProposal(event: React.FormEvent, close: () => void) {
    event.preventDefault();
    createDraft.mutate(
      // The server takes `summary` as an optional second line of context,
      // but the dialog no longer asks for it -- one field to fill is
      // simpler than two, and it was always freeform "why", never load-
      // bearing the way the name is.
      { versionId, label, summary: "" },
      {
        onError: onWriteError,
        onSuccess: (created) => {
          close();
          setLabel("");
          // Straight into the copy. Staying on the source would leave the
          // editor looking at a version its controls no longer apply to.
          onOpenVersion(created.draft_version);
        },
      },
    );
  }

  // `editing.create_draft` refuses a second draft while one is already
  // open for this questionnaire -- checked here so "Propose a change" can
  // send an editor straight to the existing one instead of opening a form
  // the server would just 409 on. `versions` is already scoped to this
  // product, so there is nothing else to filter by.
  const existingDraft = versions.find((version) => version.is_draft);

  // Branches on `is_draft`, not on whether a proposal exists. A published
  // version keeps the proposal it was published from -- that row is the
  // history of the change, and `graph/` still serves it -- so "has a
  // change request" stopped meaning "is editable" the moment publishing
  // stood `is_draft` down.
  if (!graph.version.is_draft) {
    return (
      <DraftChrome
        versionId={versionId}
        isDraft={false}
        {...(error !== null
          ? {
              after: (
                <Banner tone="error" role="alert">
                  {error}
                </Banner>
              ),
            }
          : {})}
      >
        <div className="bg-muted/70 flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-3 py-1.5">
          <span
            className={`inline-block size-2 shrink-0 rounded-full ${graph.version.is_active ? "bg-green" : "bg-muted-foreground"}`}
            aria-hidden="true"
          />
          <div className="flex min-w-0 flex-col">
            <strong className="truncate text-sm">{versionLabel(graph.version)}</strong>
            <span className="text-muted-foreground truncate text-xs">
              {graph.version.is_active ? "Latest version" : "Published version"}. Read
              only. Edits are made on a proposal.
              {changeRequest !== null && changeRequest.published_at !== null && (
                <>
                  {" "}
                  Published {formatTimestamp(changeRequest.published_at)} from a
                  proposal by {changeRequest.created_by_email}.
                </>
              )}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Rollback (spec 4.10) -- only offered on a version that was
                live before and has since been replaced. It already went
                through a review on the way in, so this is the one route to
                `is_active` that skips a fresh one: the recovery path for a
                bad publish has to be a button, not a second round trip
                through review while a respondent is being served something
                wrong. Gated on the same publish grant as Propose below,
                not the edit one -- see `FlowToolActivateView`'s
                docstring. The refusal itself is an alert, not a banner
                in this row. */}
          {!graph.version.is_active && !reviewRefused && (
            <ConfirmAction
              message={`Activate ${versionLabel(graph.version)}? It becomes the latest version immediately, replacing whatever is latest now, with no new review round.`}
              confirmLabel="Activate"
              onConfirm={() => activate.mutate(undefined, { onError: onReviewError })}
            >
              {(open) => (
                <Cta
                  primary
                  title="Activate this version"
                  loading={activate.isPending}
                  onClick={open}
                />
              )}
            </ConfirmAction>
          )}

          {editRefused ? null : existingDraft !== undefined ? (
            // Only one draft may be open per questionnaire (spec:
            // `editing.DraftAlreadyExistsError`) -- offering the form
            // anyway would be a button that always 409s, the same
            // reasoning every other disabled-vs-hidden control in this
            // file already follows. Stays a pill in the row rather than
            // becoming a banner: it is still one click to the thing that
            // matters (the existing draft), just quieted and relabelled
            // instead of swapped for a form.
            <Button
              variant="ghost"
              title={`${versionLabel(existingDraft)} is already open. Only one draft may exist per product at a time.`}
              onClick={() => onOpenVersion(existingDraft.id)}
            >
              Open the existing draft
            </Button>
          ) : (
            <EditorDialog
              title="Create draft"
              description="A draft is a whole copy of this version. Only one may be open at a time."
              trigger={<Button variant="primary">Propose a change</Button>}
            >
              {(close) => (
                <form
                  className="flex flex-col gap-4"
                  onSubmit={(event) => startProposal(event, close)}
                >
                  {writeErrorMessage(createDraft.error) !== null && (
                    <Banner tone="error" role="alert" className="mt-0">
                      {writeErrorMessage(createDraft.error)}
                    </Banner>
                  )}
                  <Field label="What's this draft for?" htmlFor={labelId}>
                    <Input
                      id={labelId}
                      value={label}
                      placeholder='e.g. "Reword Q4" or "Add a new risk question"'
                      onChange={(event) => setLabel(event.target.value)}
                    />
                  </Field>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={close}>
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      type="submit"
                      loading={createDraft.isPending}
                    >
                      Create draft
                    </Button>
                  </div>
                </form>
              )}
            </EditorDialog>
          )}
        </div>
      </DraftChrome>
    );
  }

  // A draft always has a proposal -- `create_draft` makes the pair -- but
  // the payload types it as nullable, so this keeps the rest honest.
  if (changeRequest === null) {
    return (
      <DraftChrome versionId={versionId} isDraft={true}>
        <AlertsButton
          items={[
            {
              id: "missing-proposal",
              tone: "warn",
              children:
                "This version is a draft with no proposal attached, which should not be possible. Nothing here can be edited safely.",
            },
          ]}
        />
      </DraftChrome>
    );
  }

  const lock = changeRequest.lock;
  const heldByMe = sameEmail(lock?.email, identity?.email);
  const lockedByOther = lock !== null && !heldByMe;
  // `editing.withdraw` is author-only on the server (`_require_author`) --
  // not a permission grant, so offering the button to anyone else would be
  // a control that always 403s. Checked here rather than left to the
  // write-error handler because that 403 would otherwise be
  // indistinguishable from "this account lacks edit_flow_tool" and would
  // wrongly hide every edit control for the rest of the session (see
  // `useWriteErrorHandler`) -- the same reason ReviewView keeps its own
  // `isAuthor` check for approve/reject instead of relying on the
  // refusal. `editing.discard_draft` is wider (see `isPublisher` below);
  // `isAuthor` alone still gates Withdraw, which stayed author-only.
  const isAuthor = sameEmail(changeRequest.created_by_email, identity?.email);
  // Whether *this* account holds the publish grant at all -- not "is one
  // of the two required reviewers" (that's `SubmitForReview`'s own,
  // narrower check against `REQUIRED_REVIEWER_EMAILS`, for the one thing
  // that's genuinely fixed to those two people: who reviews a
  // submission). `editing._require_author_or_publisher` (the server check
  // behind Discard) is deliberately wider than that -- "trusted with
  // review at all," the same grant that qualifies someone for the role in
  // the first place, since discarding an OPEN draft happens before
  // `submit` has named anyone. Reading `permission_codes` off the signed-
  // in identity rather than a server round trip: it is already on hand
  // from `session/`, and is a rendering hint only -- the server's own
  // check is what actually decides. `?? []` guards a stale identity
  // remembered in `localStorage` from before this field existed on it --
  // `useAuth.ts`'s own docstring already flags that nothing here
  // proactively repairs one of those against a dead cookie; a login
  // predating `permission_codes` leaves it `undefined` rather than `[]`.
  const isPublisher =
    identity !== null && (identity.permission_codes ?? []).includes(PUBLISH_FLOW_TOOL);
  const isOpen = changeRequest.status === "open";
  const isFrozen = isUnderReview(changeRequest.status, reviewRoundFrom(changeRequest));
  const busy =
    submitDraft.isPending || withdrawDraft.isPending || discardDraft.isPending;

  const alerts: ChromeAlert[] = [];
  if (graph.version.is_stale) {
    // Named here, because this is the bar somebody edits under.
    // `is_stale` is the server's answer, through the same function the
    // publish refusal reads, so this cannot promise a publish the
    // backend then declines.
    alerts.push({
      id: "stale",
      tone: "warn",
      children:
        "Behind the latest version: something was published after this draft was copied, so publishing it is refused rather than silently reinstating whatever landed in between. There is no automatic rebase. Draft again from the latest version and re-apply.",
    });
  }
  if (!isAuthor && isOpen && !isFrozen) {
    alerts.push({
      id: "submit-author",
      tone: "info",
      children: `Only ${changeRequest.created_by_email} can submit this for review.`,
    });
  }
  if (!isAuthor && (isFrozen || !isOpen)) {
    alerts.push({
      id: "act-author",
      tone: "info",
      children: `Only ${changeRequest.created_by_email} can discard or withdraw this proposal.`,
    });
  }
  if (editRefused) {
    alerts.push({
      id: "edit-refused",
      tone: "warn",
      children: "Your account can view this proposal but not change it.",
    });
  }
  if (error !== null) {
    alerts.push({
      id: "write-error",
      tone: "error",
      children: error,
    });
  }

  return (
    <DraftChrome versionId={versionId} isDraft={true}>
      <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md bg-card/80 px-3 py-1.5">
        <span
          className="inline-block size-2 shrink-0 rounded-full bg-gold"
          aria-hidden="true"
        />
        <div className="flex min-w-0 flex-col">
          <strong className="truncate text-sm">
            {versionLabel(graph.version)} ·{" "}
            {isFrozen && changeRequest.status === "open"
              ? "submitted"
              : statusLabel(changeRequest.status).toLowerCase()}
            {changeRequest.status === "open" && !isFrozen && graph.version.is_draft ? (
              <span className="text-muted-foreground font-normal"> draft</span>
            ) : null}
          </strong>
          <span className="text-muted-foreground truncate text-xs">
            {statusMeaning(changeRequest.status) !== ""
              ? `${statusMeaning(changeRequest.status)} `
              : ""}
            Proposed by {changeRequest.created_by_email}
            {changeRequest.summary !== "" && `. ${changeRequest.summary}`}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <AlertsButton items={alerts} />

        {/* Undo/redo walk the draft's own private revision timeline, not
              the permanent audit trail -- shown only where an edit could
              legally happen right now (open, not under review, not held
              by someone else, and this account may edit at all), the
              same guard every content-editing control in the map already
              applies. `editHistory === null` only outside that window in
              practice (a published version never reaches this branch),
              but stays a real check rather than a cast: the payload
              types it nullable, so this is honest about the case where
              it is. */}
        {isOpen &&
          !isFrozen &&
          !lockedByOther &&
          !editRefused &&
          editHistory !== null && (
            <div
              className="flex items-center gap-1"
              role="group"
              aria-label="Draft history"
            >
              <Cta
                title="Undo"
                description={editHistoryTooltip("Undo", editHistory.undo)}
                disabled={busy || redoDraft.isPending || !editHistory.can_undo}
                loading={undoDraft.isPending}
                onClick={() => undoDraft.mutate(undefined, { onError: onWriteError })}
              />
              <Cta
                title="Redo"
                description={editHistoryTooltip("Redo", editHistory.redo)}
                disabled={busy || undoDraft.isPending || !editHistory.can_redo}
                loading={redoDraft.isPending}
                onClick={() => redoDraft.mutate(undefined, { onError: onWriteError })}
              />
            </div>
          )}

        {heldByMe && isOpen && !isFrozen && (
          <ConfirmAction
            message="Allow others to edit this draft? Making a change locks draft automatically."
            confirmLabel="Unlock"
            onConfirm={() => releaseLock.mutate(undefined, { onError: onWriteError })}
          >
            {(open) => (
              <Button variant="outline" loading={releaseLock.isPending} onClick={open}>
                Unlock
              </Button>
            )}
          </ConfirmAction>
        )}

        {/* Author-only, same restriction Withdraw already has
              (`editing.submit`'s own `_require_author`) -- a draft may be
              edited by more than one person, but deciding it is ready
              for review is the author's call. `submit` always sends this
              to the same two required people (`REQUIRED_REVIEWER_EMAILS`)
              -- except when the author is themselves one of the two, the
              one case `SubmitForReview` turns into a form instead of a
              plain confirm. Hidden while someone else holds the lock or
              while this draft is already under review. */}
        {isOpen && isAuthor && !lockedByOther && !isFrozen && (
          <SubmitForReview
            versionId={versionId}
            authorEmail={changeRequest.created_by_email}
            disabled={
              editRefused ||
              withdrawDraft.isPending ||
              discardDraft.isPending ||
              releaseLock.isPending
            }
            submitDraft={submitDraft}
          />
        )}

        {/* Discard accepts the author or anyone holding the publish
              grant (`isPublisher`) -- widened from author-only so an
              abandoned draft does not permanently occupy the one slot
              `create_draft` now caps a questionnaire at. Withdraw stays
              author-only on the server (`_require_author`) -- neither is
              offered to anyone else. `isOpen`/`isFrozen` between them
              cover every status this bar reaches (never both at once),
              so exactly one control or the explanatory note below
              renders. */}
        {isOpen && (isAuthor || isPublisher) && !lockedByOther && !isFrozen && (
          <ConfirmAction
            message="Discard this draft? The proposal and every edit in it are deleted."
            confirmLabel="Discard draft"
            danger
            onConfirm={() =>
              // `parent_version` is null only when this draft was itself
              // drafted from another (now-discarded) draft -- an edge
              // case worth not crashing on, not a version to fall back
              // to: `versionId` is the one that just stopped existing.
              // `onOpenVersion(null)` sends whoever discarded it
              // somewhere that still does.
              discardDraft.mutate(versionId, {
                onError: onWriteError,
                onSuccess: () => onOpenVersion(graph.version.parent_version),
              })
            }
          >
            {(open) => (
              <Button
                variant="danger"
                // `editRefused` only matters on the author path: a pure
                // publisher needs no edit grant for this action at all,
                // so an unrelated edit refusal earlier this session
                // must not block a discard they are otherwise entitled
                // to.
                disabled={busy || (editRefused && !isPublisher)}
                onClick={open}
              >
                Discard draft
              </Button>
            )}
          </ConfirmAction>
        )}

        {isFrozen &&
          isAuthor &&
          (changeRequest.status === "approved" ? (
            // The parenthetical used to be part of the button's own
            // label, which was the longest thing on this row -- moved
            // into the description line instead, same self-describing
            // shape as Propose/Activate, so "Withdraw review" itself
            // stays short and the row has a chance to fit on one line.
            <Cta
              title="Withdraw review"
              description="Also drops the current approval."
              disabled={busy || editRefused}
              onClick={() => withdrawDraft.mutate(undefined, { onError: onWriteError })}
            />
          ) : (
            <Button
              disabled={busy || editRefused}
              onClick={() => withdrawDraft.mutate(undefined, { onError: onWriteError })}
            >
              Withdraw review
            </Button>
          ))}
      </div>
    </DraftChrome>
  );
}
