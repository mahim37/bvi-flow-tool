import { useId, useState } from "react";
import { Link } from "react-router-dom";

import type { Graph, UUID, VersionListItem } from "../api/types";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field, nativeSelectClassName } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { TabsLink, TabsNav } from "@/components/ui/nav-tabs";
import { editorBox, mutedHint } from "@/lib/chrome";
import { Separator } from "@/components/ui/separator";
import {
  useActivateVersion,
  useCreateDraft,
  useDiscardDraft,
  useReleaseLock,
  useReviewers,
  useSpawnProduct,
  useSubmitDraft,
  useWithdrawDraft,
} from "../api/queries";
import { useAuth } from "../auth/useAuth";
import { ConfirmAction } from "./ConfirmAction";
import { EditorDropdown } from "./EditorDropdown";
import { formatTimestamp, statusLabel, statusMeaning, versionLabel } from "./labels";
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
   * other caller (propose, spawn) always has a real id, the thing it just
   * created. */
  onOpenVersion: (versionId: UUID | null) => void;
}

/** Map/Review/Preview -- folded into this bar (VersionLayout no longer
 * renders a separate tabs strip above it) so the version's own status and
 * actions sit in the same row as the views on it, instead of two stacked
 * bars. */
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

/** A plain, single-line button whose longer explanation surfaces as a
 * native tooltip (`title`) rather than a second line of text under the
 * label -- keeps the button itself compact; used where the click itself
 * doesn't already open some other popup that could carry the same text
 * (see `ConfirmAction`/`EditorDropdown` call sites, which fold it in
 * there instead). */
function Cta({
  primary = false,
  title,
  description,
  disabled,
  onClick,
}: {
  primary?: boolean;
  title: string;
  description?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant={primary ? "primary" : "default"}
      onClick={onClick}
      {...(description !== undefined ? { title: description } : {})}
      {...(disabled !== undefined ? { disabled } : {})}
    >
      {title}
    </Button>
  );
}

export function DraftBar({ graph, versions, onOpenVersion }: DraftBarProps) {
  const { identity, editRefused, reviewRefused } = useAuth();
  const onWriteError = useWriteErrorHandler();
  const onReviewError = useReviewErrorHandler();
  const versionId = graph.version.id;
  const changeRequest = graph.change_request;

  const labelId = useId();
  const summaryId = useId();
  const [label, setLabel] = useState("");
  const [summary, setSummary] = useState("");

  const spawnNameId = useId();
  const spawnCodeId = useId();
  const [spawnName, setSpawnName] = useState("");
  const [spawnCode, setSpawnCode] = useState("");

  const reviewer1Id = useId();
  const reviewer2Id = useId();
  const [reviewer1, setReviewer1] = useState<UUID | "">("");
  const [reviewer2, setReviewer2] = useState<UUID | "">("");
  const reviewers = useReviewers();

  const createDraft = useCreateDraft();
  const discardDraft = useDiscardDraft();
  const submitDraft = useSubmitDraft(versionId);
  const withdrawDraft = useWithdrawDraft(versionId);
  const releaseLock = useReleaseLock(versionId);
  const spawnProduct = useSpawnProduct(versionId);
  const activate = useActivateVersion(versionId);

  const error =
    writeErrorMessage(createDraft.error) ??
    writeErrorMessage(discardDraft.error) ??
    writeErrorMessage(submitDraft.error) ??
    writeErrorMessage(withdrawDraft.error) ??
    writeErrorMessage(releaseLock.error) ??
    writeErrorMessage(spawnProduct.error) ??
    writeErrorMessage(activate.error);

  function startProposal(event: React.FormEvent, close: () => void) {
    event.preventDefault();
    createDraft.mutate(
      { versionId, label, summary },
      {
        onError: onWriteError,
        onSuccess: (created) => {
          close();
          setLabel("");
          setSummary("");
          // Straight into the copy. Staying on the source would leave the
          // editor looking at a version its controls no longer apply to.
          onOpenVersion(created.draft_version);
        },
      },
    );
  }

  function startSpawn(event: React.FormEvent, close: () => void) {
    event.preventDefault();
    spawnProduct.mutate(
      { name: spawnName, code: spawnCode },
      {
        onError: onReviewError,
        onSuccess: (created) => {
          close();
          setSpawnName("");
          setSpawnCode("");
          // Straight into the child, same reasoning as a fresh draft: it
          // is a different product now, with a different id, and staying
          // on the source would leave the editor looking at a version
          // none of the next steps apply to.
          onOpenVersion(created.id);
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
      <div className="flex flex-col gap-2 border-t border-border bg-background px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
            <VersionTabs versionId={versionId} isDraft={false} />
            <Separator orientation="vertical" className="h-9" />

            <div className="bg-muted/70 flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-3 py-1.5">
              <span
                className={`inline-block size-2 shrink-0 rounded-full ${graph.version.is_active ? "bg-green" : "bg-muted-foreground"}`}
                aria-hidden="true"
              />
              <div className="flex min-w-0 flex-col">
                <strong className="truncate text-sm">
                  {versionLabel(graph.version)}
                </strong>
                <span className="text-muted-foreground truncate text-xs">
                  {graph.version.is_active ? "Latest version" : "Published version"} —
                  read only. Edits are made on a proposal.
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
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Rollback (spec 4.10) -- only offered on a version that was
                live before and has since been replaced. It already went
                through a review on the way in, so this is the one route to
                `is_active` that skips a fresh one: the recovery path for a
                bad publish has to be a button, not a second round trip
                through review while a respondent is being served something
                wrong. Gated on the same publish grant as Propose/Spawn
                below, not the edit one -- see `FlowToolActivateView`'s
                docstring. */}
            {!graph.version.is_active &&
              (reviewRefused ? (
                <Banner tone="warn">
                  Your account can view this version but not activate it.
                </Banner>
              ) : (
                <ConfirmAction
                  message={`Activate ${versionLabel(graph.version)}? It becomes the latest version immediately, replacing whatever is latest now, with no new review round.`}
                  confirmLabel="Activate"
                  onConfirm={() =>
                    activate.mutate(undefined, { onError: onReviewError })
                  }
                >
                  {(open) => (
                    <Cta
                      primary
                      title={
                        activate.isPending ? "Activating…" : "Activate this version"
                      }
                      disabled={activate.isPending}
                      onClick={open}
                    />
                  )}
                </ConfirmAction>
              ))}

            {editRefused ? (
              <Banner tone="warn">
                Your account can view the flow tool but not propose changes.
              </Banner>
            ) : existingDraft !== undefined ? (
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
              <EditorDropdown
                trigger={<Button variant="primary">Propose a change</Button>}
              >
                {(close) => (
                  <form
                    className={editorBox}
                    onSubmit={(event) => startProposal(event, close)}
                  >
                    <p className={mutedHint}>
                      A draft is a whole copy of this version. Only one may be open at a
                      time.
                    </p>
                    <Field label="Name" htmlFor={labelId}>
                      <Input
                        id={labelId}
                        value={label}
                        placeholder="What this proposal is called"
                        onChange={(event) => setLabel(event.target.value)}
                      />
                    </Field>
                    <Field label="Summary" htmlFor={summaryId}>
                      <Input
                        id={summaryId}
                        value={summary}
                        placeholder="Why it exists"
                        onChange={(event) => setSummary(event.target.value)}
                      />
                    </Field>
                    <Button
                      variant="primary"
                      type="submit"
                      disabled={createDraft.isPending}
                    >
                      {createDraft.isPending ? "Copying…" : "Create draft"}
                    </Button>
                  </form>
                )}
              </EditorDropdown>
            )}

            {reviewRefused ? (
              <Banner tone="warn">
                Your account can view the flow tool but not spawn a product from it.
              </Banner>
            ) : (
              <EditorDropdown
                trigger={<Button variant="outline">Spawn a product</Button>}
              >
                {(close) => (
                  <form
                    className={editorBox}
                    onSubmit={(event) => startSpawn(event, close)}
                  >
                    <p className={mutedHint}>
                      Copies this version into a brand-new questionnaire, live
                      immediately.
                    </p>
                    <Field label="Name" htmlFor={spawnNameId}>
                      <Input
                        id={spawnNameId}
                        value={spawnName}
                        required
                        placeholder="The new product's name"
                        onChange={(event) => setSpawnName(event.target.value)}
                      />
                    </Field>
                    <Field label="Code" htmlFor={spawnCodeId}>
                      <Input
                        id={spawnCodeId}
                        value={spawnCode}
                        required
                        placeholder="Stable identifier, unique across every product"
                        onChange={(event) => setSpawnCode(event.target.value)}
                      />
                    </Field>
                    <Button
                      variant="primary"
                      type="submit"
                      disabled={
                        spawnProduct.isPending ||
                        spawnName.trim() === "" ||
                        spawnCode.trim() === ""
                      }
                    >
                      {spawnProduct.isPending ? "Spawning…" : "Spawn product"}
                    </Button>
                  </form>
                )}
              </EditorDropdown>
            )}
          </div>
        </div>

        {error !== null && (
          <Banner tone="error" role="alert">
            {error}
          </Banner>
        )}
      </div>
    );
  }

  // A draft always has a proposal -- `create_draft` makes the pair -- but
  // the payload types it as nullable, so this keeps the rest honest.
  if (changeRequest === null) {
    return (
      <div className="flex flex-col gap-2 border-t border-border bg-background px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <VersionTabs versionId={versionId} isDraft={true} />
          </div>
        </div>

        <Banner tone="warn">
          This version is a draft with no proposal attached, which should not be
          possible. Nothing here can be edited safely.
        </Banner>
      </div>
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
  // Whether *this* account holds `publish_flow_tool` at all -- not
  // `isNamedReviewer` below, which only answers "is one of *this*
  // proposal's two," a fact that does not exist yet for an OPEN draft
  // (`submit` is what names them). `reviewers` already lists everyone
  // holding the grant (fetched for the submit form's picker), so this
  // reads it rather than adding a second source of truth or falling back
  // to guess-by-refusal (`reviewRefused`), which is one-way -- it only
  // ever turns true after a refusal, so it cannot positively confirm
  // anyone holds the grant before they have tried and failed to use it.
  const isPublisher = (reviewers.data ?? []).some(
    (reviewer) => reviewer.email === identity?.email,
  );
  const isOpen = changeRequest.status === "open";
  // Withdrawing accepts both, and drops an approval rather than banking
  // it: what comes back is an editable proposal, and an approval of an
  // older draft is not an approval of the next one.
  const isFrozen =
    changeRequest.status === "submitted" || changeRequest.status === "approved";
  // Mirrors `ReviewView`'s own `isNamedReviewer`/`canApprove`/`canReject`/
  // `canPublish` -- not re-deriving a routing decision (spec 1.3 is about
  // the graph, not this), just the same client-side echo of who may act
  // that this file already keeps for Discard/Withdraw. `editing.approve`/
  // `editing.reject` refuse anyone but the two named reviewers while
  // submitted; `editing.publish` has no such check once approved -- any
  // publish_flow_tool holder, including the author, may press it. Without
  // this, the button below reads "Review and publish" for someone who can
  // do neither, which is the same misleading-primary-button shape this
  // app already avoids elsewhere.
  const isNamedReviewer =
    identity !== null &&
    (changeRequest.reviewer_1_email === identity.email ||
      changeRequest.reviewer_2_email === identity.email);
  const canActOnReview =
    !reviewRefused &&
    (changeRequest.status === "approved" ||
      (changeRequest.status === "submitted" && !isAuthor && isNamedReviewer));
  const busy =
    submitDraft.isPending ||
    withdrawDraft.isPending ||
    discardDraft.isPending ||
    releaseLock.isPending;

  return (
    <div className="flex flex-col gap-2 border-t border-border bg-cream-2 px-4 py-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          <VersionTabs versionId={versionId} isDraft={true} />
          <Separator orientation="vertical" className="h-9" />

          <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md bg-card/80 px-3 py-1.5">
            <span
              className="inline-block size-2 shrink-0 rounded-full bg-gold"
              aria-hidden="true"
            />
            <div className="flex min-w-0 flex-col">
              <strong className="truncate text-sm">
                {versionLabel(graph.version)} —{" "}
                {statusLabel(changeRequest.status).toLowerCase()}
              </strong>
              <span className="text-muted-foreground truncate text-xs">
                {statusMeaning(changeRequest.status)} Proposed by{" "}
                {changeRequest.created_by_email}
                {changeRequest.summary !== "" && ` — ${changeRequest.summary}`}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Quiet while there's a more primary action beside it (Submit
              for review) or while this signed-in account cannot actually
              approve, reject or publish this proposal -- everyone with
              view access may still open it to read the diff, but only
              `canActOnReview` earns the same visual weight Submit/Publish
              get elsewhere and the wording that promises an action. */}
          <Button asChild variant={isOpen || !canActOnReview ? "ghost" : "primary"}>
            <Link to={`/versions/${versionId}/review`}>
              {isOpen || !canActOnReview ? "Check the diff" : "Review and publish"}
            </Link>
          </Button>

          {isOpen && (
            <EditorDropdown trigger="Submit for review" disabled={busy || editRefused}>
              {(close) => (
                <form
                  className={editorBox}
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (reviewer1 === "" || reviewer2 === "") return;
                    submitDraft.mutate(
                      { reviewer1Id: reviewer1, reviewer2Id: reviewer2 },
                      {
                        onError: onWriteError,
                        onSuccess: () => {
                          close();
                          setReviewer1("");
                          setReviewer2("");
                        },
                      },
                    );
                  }}
                >
                  <Field label="First reviewer" htmlFor={reviewer1Id}>
                    <select
                      id={reviewer1Id}
                      className={nativeSelectClassName}
                      value={reviewer1}
                      required
                      onChange={(event) => setReviewer1(event.target.value)}
                    >
                      <option value="" disabled>
                        Choose a reviewer
                      </option>
                      {(reviewers.data ?? [])
                        .filter(
                          (candidate) =>
                            candidate.id !== changeRequest.created_by &&
                            candidate.id !== reviewer2,
                        )
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.email}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Second reviewer" htmlFor={reviewer2Id}>
                    <select
                      id={reviewer2Id}
                      className={nativeSelectClassName}
                      value={reviewer2}
                      required
                      onChange={(event) => setReviewer2(event.target.value)}
                    >
                      <option value="" disabled>
                        Choose a reviewer
                      </option>
                      {(reviewers.data ?? [])
                        .filter(
                          (candidate) =>
                            candidate.id !== changeRequest.created_by &&
                            candidate.id !== reviewer1,
                        )
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.email}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Button
                    variant="primary"
                    type="submit"
                    disabled={
                      submitDraft.isPending ||
                      reviewer1 === "" ||
                      reviewer2 === "" ||
                      reviewer1 === reviewer2
                    }
                  >
                    {submitDraft.isPending ? "Submitting…" : "Submit for review"}
                  </Button>
                  {/* Two named reviewers are required, so a group with
                      fewer than two publish-flow-tool holders cannot
                      submit anything at all -- worth saying here rather
                      than leaving both selects empty with no explanation. */}
                  {reviewers.data !== undefined && reviewers.data.length < 2 && (
                    <p className={mutedHint}>
                      Fewer than two people currently hold the publish grant, so there
                      is nobody eligible to name. Ask whoever manages staff accounts to
                      grant it before submitting.
                    </p>
                  )}
                </form>
              )}
            </EditorDropdown>
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
              // shape as Propose/Spawn/Activate, so "Withdraw" itself
              // stays one short word and the row has a chance to fit on
              // one line.
              <Cta
                title="Withdraw"
                description="Also drops the current approval."
                disabled={busy || editRefused}
                onClick={() =>
                  withdrawDraft.mutate(undefined, { onError: onWriteError })
                }
              />
            ) : (
              <Button
                disabled={busy || editRefused}
                onClick={() =>
                  withdrawDraft.mutate(undefined, { onError: onWriteError })
                }
              >
                Withdraw
              </Button>
            ))}
        </div>
      </div>

      {graph.version.is_stale && (
        // Named here as well as on the review screen, because this is the
        // bar somebody edits under. `is_stale` is the server's answer,
        // through the same function the publish refusal reads, so this
        // cannot promise a publish the backend then declines.
        <Banner tone="warn">
          Behind the latest version: something was published after this draft was
          copied, so publishing it is refused rather than silently reinstating whatever
          landed in between. There is no automatic rebase — draft again from the latest
          version and re-apply.
        </Banner>
      )}

      {lock !== null &&
        (heldByMe ? (
          <Banner as="div" tone="info">
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
          </Banner>
        ) : (
          // Not an error state: the lock is taken by the first edit and
          // released automatically once it goes idle, so the honest thing
          // to say is who to ask, not "locked". `expires_at` names the
          // moment this banner's own advice goes stale -- past it, the
          // lock is gone whether or not they ever come back to release it.
          <Banner tone="warn">
            {lock.email} last edited this at {formatTimestamp(lock.since)}. Nobody else
            can edit until {formatTimestamp(lock.expires_at)}, unless they release it
            first.
          </Banner>
        ))}

      {/* Moved out of .draftbar__right (which is otherwise just the one
          Review/Check-the-diff link in this state) rather than left as a
          flex sibling of it -- boxed banners are what every other "why a
          control isn't offered" fact in this bar already renders as, and
          giving this one the same full-width treatment is what actually
          lets the row above stay on one line.

          Only shown once frozen (`!isOpen`): while open, Discard is
          already offered to a publisher, not just the author, and an
          ordinary editor still has Submit for review and every content
          edit to do, so there's nothing missing worth explaining. Once
          frozen, Withdraw is author-only with no publisher exception (see
          `isAuthor`'s comment above) and is the one thing left that
          Publish isn't, so its absence is worth a word. */}
      {!isAuthor && !isOpen && (
        <Banner tone="info">
          Only {changeRequest.created_by_email} can discard or withdraw this proposal.
        </Banner>
      )}

      {editRefused && (
        <Banner tone="warn">
          Your account can view this proposal but not change it.
        </Banner>
      )}

      {error !== null && (
        <Banner tone="error" role="alert">
          {error}
        </Banner>
      )}
    </div>
  );
}
