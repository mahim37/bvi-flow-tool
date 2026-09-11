import { useId, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";

import type { Graph, UUID, VersionListItem } from "../api/types";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { TabsLink, TabsNav } from "@/components/ui/nav-tabs";
import {
  useActivateVersion,
  useCreateDraft,
  useDiscardDraft,
  useReleaseLock,
  useSubmitDraft,
  useWithdrawDraft,
} from "../api/queries";
import { useAuth } from "../auth/useAuth";
import { AlertsButton } from "./AlertsButton";
import type { ChromeAlert } from "./AlertsButton";
import { AddQuestion } from "./AddQuestion";
import { ConfirmAction } from "./ConfirmAction";
import { EditorDialog } from "./EditorDialog";
import {
  REQUIRED_REVIEWER_EMAILS,
  formatTimestamp,
  statusLabel,
  statusMeaning,
  versionLabel,
} from "./labels";
import {
  useReviewErrorHandler,
  useWriteErrorHandler,
  writeErrorMessage,
} from "./useWriteError";

interface DraftBarProps {
  graph: Graph;
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

export function DraftBar({ graph, versions, onOpenVersion }: DraftBarProps) {
  const navigate = useNavigate();
  const { identity, editRefused, reviewRefused } = useAuth();
  const onWriteError = useWriteErrorHandler();
  const onReviewError = useReviewErrorHandler();
  const versionId = graph.version.id;
  const changeRequest = graph.change_request;

  const labelId = useId();
  const [label, setLabel] = useState("");

  const createDraft = useCreateDraft();
  const discardDraft = useDiscardDraft();
  const submitDraft = useSubmitDraft(versionId);
  const withdrawDraft = useWithdrawDraft(versionId);
  const releaseLock = useReleaseLock(versionId);
  const activate = useActivateVersion(versionId);

  const error =
    writeErrorMessage(createDraft.error) ??
    writeErrorMessage(discardDraft.error) ??
    writeErrorMessage(submitDraft.error) ??
    writeErrorMessage(withdrawDraft.error) ??
    writeErrorMessage(releaseLock.error) ??
    writeErrorMessage(activate.error);

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
  const heldByMe = lock !== null && lock.email === identity?.email;
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
  const isAuthor = changeRequest.created_by_email === identity?.email;
  // Whether *this* account is one of the two required reviewers -- not
  // `isNamedReviewer` below, which only answers "is one of *this*
  // proposal's two," a fact that does not exist yet for an OPEN draft
  // (`submit` is what names them, and it always names the same two
  // people). Checked against `REQUIRED_REVIEWER_EMAILS` directly rather
  // than a `reviewers/` list call -- there is no longer a picker for that
  // endpoint to populate, and with only ever two possible people, a fetch
  // buys nothing a constant doesn't already have.
  const isPublisher =
    identity !== null &&
    (REQUIRED_REVIEWER_EMAILS as readonly string[]).includes(identity.email);
  const isOpen = changeRequest.status === "open";
  // Withdrawing accepts both, and drops an approval rather than banking
  // it: what comes back is an editable proposal, and an approval of an
  // older draft is not an approval of the next one.
  const isFrozen =
    changeRequest.status === "submitted" || changeRequest.status === "approved";
  // Mirrors `ReviewView`'s own `isNamedReviewer`/`canApprove`/`canReject` --
  // not re-deriving a routing decision (spec 1.3 is about the graph, not
  // this), just the same client-side echo of who may act that this file
  // already keeps for Discard/Withdraw. There is no more `canPublish` to
  // mirror: publishing is automatic the moment the second required
  // reviewer approves (`editing.approve`), not a separate action anybody
  // presses. `submitted` *or* `approved` both still mean "something for a
  // reviewer to do" now -- `approved` means one of the two has cleared it
  // and the other one still can, where it used to mean "anyone holding
  // publish may press Publish."
  const isNamedReviewer =
    identity !== null &&
    (changeRequest.reviewer_1_email === identity.email ||
      changeRequest.reviewer_2_email === identity.email);
  const canActOnReview =
    !reviewRefused &&
    !isAuthor &&
    isNamedReviewer &&
    (changeRequest.status === "submitted" || changeRequest.status === "approved");
  const busy =
    submitDraft.isPending ||
    withdrawDraft.isPending ||
    discardDraft.isPending ||
    releaseLock.isPending;

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
  if (lock !== null) {
    alerts.push({
      id: "lock",
      tone: heldByMe ? "info" : "warn",
      children: heldByMe ? (
        <>
          You last edited this draft at {formatTimestamp(lock.since)}. It's yours to
          keep editing until {formatTimestamp(lock.expires_at)} unless you edit again
          before then.{" "}
          <Button
            variant="link"
            disabled={busy}
            onClick={() => releaseLock.mutate(undefined, { onError: onWriteError })}
          >
            Release it
          </Button>{" "}
          so somebody else can edit sooner.
        </>
      ) : (
        <>
          {lock.email} last edited this at {formatTimestamp(lock.since)}. Nobody else
          can edit until {formatTimestamp(lock.expires_at)}, unless they release it
          first.
        </>
      ),
    });
  }
  if (!isAuthor && isOpen) {
    alerts.push({
      id: "submit-author",
      tone: "info",
      children: `Only ${changeRequest.created_by_email} can submit this for review.`,
    });
  }
  if (!isAuthor && !isOpen) {
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
            {statusLabel(changeRequest.status).toLowerCase()}
          </strong>
          <span className="text-muted-foreground truncate text-xs">
            {statusMeaning(changeRequest.status)} Proposed by{" "}
            {changeRequest.created_by_email}
            {changeRequest.summary !== "" && `. ${changeRequest.summary}`}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {isOpen && !editRefused && (
          <AddQuestion
            graph={graph}
            onAdded={(id) => navigate(`/versions/${versionId}?question=${id}`)}
          />
        )}
        {/* Quiet while there's a more primary action beside it (Submit
              for review) or while this signed-in account cannot actually
              approve or reject this proposal -- everyone with view access
              may still open it to read the diff, but only
              `canActOnReview` earns the same visual weight Submit gets
              elsewhere and the wording that promises an action. */}
        <Button asChild variant={isOpen || !canActOnReview ? "ghost" : "primary"}>
          <Link to={`/versions/${versionId}/review`}>
            {isOpen || !canActOnReview ? "Check diff" : "Review"}
          </Link>
        </Button>

        <AlertsButton items={alerts} />

        {/* No more reviewer picker -- `submit` always sends this to the
              same two required people (`REQUIRED_REVIEWER_EMAILS`), so
              there is nothing left for a form to ask. A plain confirm
              rather than an instant click: submitting still freezes the
              draft for editing and, for a BREAK-hosted one, pushes its
              content to break for real -- not nothing, even with no
              input left to fill in. Author-only, same restriction
              Withdraw already has (`editing.submit`'s own
              `_require_author`) -- a draft may be edited by more than one
              person, but deciding it is ready for review is the author's
              call. */}
        {isOpen && isAuthor && (
          <ConfirmAction
            message={`Submit for review? ${REQUIRED_REVIEWER_EMAILS.join(" and ")} will both need to approve before this publishes.`}
            confirmLabel="Submit for review"
            onConfirm={() => submitDraft.mutate(undefined, { onError: onWriteError })}
          >
            {(open) => (
              <Button
                variant="primary"
                loading={submitDraft.isPending}
                disabled={
                  editRefused ||
                  withdrawDraft.isPending ||
                  discardDraft.isPending ||
                  releaseLock.isPending
                }
                onClick={open}
              >
                Submit for review
              </Button>
            )}
          </ConfirmAction>
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
        {isOpen && (isAuthor || isPublisher) && (
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
            // shape as Propose/Activate, so "Withdraw" itself stays one
            // short word and the row has a chance to fit on one line.
            <Cta
              title="Withdraw"
              description="Also drops the current approval."
              disabled={busy || editRefused}
              onClick={() => withdrawDraft.mutate(undefined, { onError: onWriteError })}
            />
          ) : (
            <Button
              disabled={busy || editRefused}
              onClick={() => withdrawDraft.mutate(undefined, { onError: onWriteError })}
            >
              Withdraw
            </Button>
          ))}
      </div>
    </DraftChrome>
  );
}
