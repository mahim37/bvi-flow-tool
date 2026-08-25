import { useId, useState } from "react";
import { Link, NavLink } from "react-router-dom";

import type { Graph, UUID, VersionListItem } from "../api/types";
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
    <nav className="tabs" aria-label="Version views">
      <NavLink end to={`/versions/${versionId}`} className="tabs__tab">
        Map
      </NavLink>
      {/* Shown for a published version too, where the same diff answers
          "what did this release change" against the version it superseded.
          That is the history half of spec 4.10, and it needs no endpoint
          the review screen does not already call. */}
      <NavLink to={`/versions/${versionId}/review`} className="tabs__tab">
        {isDraft ? "Review" : "What changed"}
      </NavLink>
      <NavLink to={`/versions/${versionId}/preview`} className="tabs__tab">
        Preview
      </NavLink>
    </nav>
  );
}

/** A button that carries its own explanation, title and description
 * stacked inside the one element, rather than a plain button beside a
 * separate note span -- so on a narrow row the description can never wrap
 * away from the button it belongs to and land somewhere else looking
 * orphaned. */
function Cta({
  primary = false,
  title,
  description,
  disabled,
  onClick,
}: {
  primary?: boolean;
  title: string;
  description: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`button draftbar__cta${primary ? " button--primary" : ""}`}
      type="button"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="draftbar__cta-title">{title}</span>
      <span className="draftbar__cta-desc">{description}</span>
    </button>
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
      <div className="draftbar">
        <div className="draftbar__row">
          <div className="draftbar__left">
            <VersionTabs versionId={versionId} isDraft={false} />
            <span className="draftbar__divider" aria-hidden="true" />

            <div className="draftbar__status">
              <div className="draftbar__status-name">
                <span
                  className={`draftbar__dot draftbar__dot--${graph.version.is_active ? "live" : "muted"}`}
                />
                <strong>{versionLabel(graph.version)}</strong>
              </div>
              <span className="draftbar__note">
                {graph.version.is_active ? "Live version" : "Published version"} — read
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

          <div className="draftbar__right">
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
                <p className="banner banner--warn">
                  Your account can view this version but not activate it.
                </p>
              ) : (
                <ConfirmAction
                  message={`Activate ${versionLabel(graph.version)}? It goes live immediately, replacing whatever is live now, with no new review round.`}
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
                      description="Puts this exact version back in front of respondents. No new review needed."
                      disabled={activate.isPending}
                      onClick={open}
                    />
                  )}
                </ConfirmAction>
              ))}

            {editRefused ? (
              <p className="banner banner--warn">
                Your account can view the flow tool but not propose changes.
              </p>
            ) : existingDraft !== undefined ? (
              // Only one draft may be open per questionnaire (spec:
              // `editing.DraftAlreadyExistsError`) -- offering the form
              // anyway would be a button that always 409s, the same
              // reasoning every other disabled-vs-hidden control in this
              // file already follows. Stays a pill in the row rather than
              // becoming a banner: it is still one click to the thing that
              // matters (the existing draft), just quieted and relabelled
              // instead of swapped for a form.
              <button
                className="button button--quiet"
                type="button"
                title={`${versionLabel(existingDraft)} is already open. Only one draft may exist per product at a time.`}
                onClick={() => onOpenVersion(existingDraft.id)}
              >
                Already a draft exists
              </button>
            ) : (
              <EditorDropdown
                trigger={
                  <span className="draftbar__cta">
                    <span className="draftbar__cta-title">Propose a change</span>
                    <span className="draftbar__cta-desc">
                      A draft is a whole copy of this version. Only one may be open per
                      product at a time.
                    </span>
                  </span>
                }
              >
                {(close) => (
                  <form
                    className="editor"
                    onSubmit={(event) => startProposal(event, close)}
                  >
                    <div className="field">
                      <label htmlFor={labelId}>Name</label>
                      <input
                        id={labelId}
                        value={label}
                        placeholder="What this proposal is called"
                        onChange={(event) => setLabel(event.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={summaryId}>Summary</label>
                      <input
                        id={summaryId}
                        value={summary}
                        placeholder="Why it exists"
                        onChange={(event) => setSummary(event.target.value)}
                      />
                    </div>
                    <button
                      className="button button--primary"
                      type="submit"
                      disabled={createDraft.isPending}
                    >
                      {createDraft.isPending ? "Copying…" : "Create draft"}
                    </button>
                  </form>
                )}
              </EditorDropdown>
            )}

            {reviewRefused ? (
              <p className="banner banner--warn">
                Your account can view the flow tool but not spawn a product from it.
              </p>
            ) : (
              <EditorDropdown
                trigger={
                  <span className="draftbar__cta">
                    <span className="draftbar__cta-title">Spawn a product</span>
                    <span className="draftbar__cta-desc">
                      Copies this version into a brand-new questionnaire, live
                      immediately.
                    </span>
                  </span>
                }
              >
                {(close) => (
                  <form
                    className="editor"
                    onSubmit={(event) => startSpawn(event, close)}
                  >
                    <div className="field">
                      <label htmlFor={spawnNameId}>Name</label>
                      <input
                        id={spawnNameId}
                        value={spawnName}
                        required
                        placeholder="The new product's name"
                        onChange={(event) => setSpawnName(event.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={spawnCodeId}>Code</label>
                      <input
                        id={spawnCodeId}
                        value={spawnCode}
                        required
                        placeholder="Stable identifier, unique across every product"
                        onChange={(event) => setSpawnCode(event.target.value)}
                      />
                    </div>
                    <button
                      className="button button--primary"
                      type="submit"
                      disabled={
                        spawnProduct.isPending ||
                        spawnName.trim() === "" ||
                        spawnCode.trim() === ""
                      }
                    >
                      {spawnProduct.isPending ? "Spawning…" : "Spawn product"}
                    </button>
                  </form>
                )}
              </EditorDropdown>
            )}
          </div>
        </div>

        {error !== null && (
          <p className="banner banner--error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  // A draft always has a proposal -- `create_draft` makes the pair -- but
  // the payload types it as nullable, so this keeps the rest honest.
  if (changeRequest === null) {
    return (
      <div className="draftbar draftbar--draft">
        <div className="draftbar__row">
          <div className="draftbar__left">
            <VersionTabs versionId={versionId} isDraft={true} />
          </div>
        </div>

        <p className="banner banner--warn">
          This version is a draft with no proposal attached, which should not be
          possible. Nothing here can be edited safely.
        </p>
      </div>
    );
  }

  const lock = changeRequest.lock;
  const heldByMe = lock !== null && lock.email === identity?.email;
  // `editing.discard_draft`/`editing.withdraw` are author-only on the
  // server (`_require_author`) -- not a permission grant, so offering the
  // button to anyone else would be a control that always 403s. Checked
  // here rather than left to the write-error handler because that 403
  // would otherwise be indistinguishable from "this account lacks
  // edit_flow_tool" and would wrongly hide every edit control for the
  // rest of the session (see `useWriteErrorHandler`) -- the same reason
  // ReviewView keeps its own `isAuthor` check for approve/reject instead
  // of relying on the refusal.
  const isAuthor = changeRequest.created_by_email === identity?.email;
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
    <div className="draftbar draftbar--draft">
      <div className="draftbar__row">
        <div className="draftbar__left">
          <VersionTabs versionId={versionId} isDraft={true} />
          <span className="draftbar__divider" aria-hidden="true" />

          <div className="draftbar__status">
            <div className="draftbar__status-name">
              <span className="draftbar__dot draftbar__dot--draft" />
              <strong>
                {versionLabel(graph.version)} —{" "}
                {statusLabel(changeRequest.status).toLowerCase()}
              </strong>
            </div>
            <span className="draftbar__note">
              {statusMeaning(changeRequest.status)} Proposed by{" "}
              {changeRequest.created_by_email}
              {changeRequest.summary !== "" && ` — ${changeRequest.summary}`}
            </span>
          </div>
        </div>

        <div className="draftbar__right">
          {/* Quiet while there's a more primary action beside it (Submit
              for review) or while this signed-in account cannot actually
              approve, reject or publish this proposal -- everyone with
              view access may still open it to read the diff, but only
              `canActOnReview` earns the same visual weight Submit/Publish
              get elsewhere and the wording that promises an action. */}
          <Link
            className={`button ${isOpen || !canActOnReview ? "button--quiet" : "button--primary"}`}
            to={`/versions/${versionId}/review`}
          >
            {isOpen || !canActOnReview ? "Check the diff" : "Review and publish"}
          </Link>

          {isOpen && (
            <EditorDropdown trigger="Submit for review" disabled={busy || editRefused}>
              {(close) => (
                <form
                  className="editor"
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
                  <div className="field">
                    <label htmlFor={reviewer1Id}>First reviewer</label>
                    <select
                      id={reviewer1Id}
                      value={reviewer1}
                      required
                      onChange={(event) => setReviewer1(event.target.value)}
                    >
                      <option value="" disabled>
                        Choose somebody
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
                  </div>
                  <div className="field">
                    <label htmlFor={reviewer2Id}>Second reviewer</label>
                    <select
                      id={reviewer2Id}
                      value={reviewer2}
                      required
                      onChange={(event) => setReviewer2(event.target.value)}
                    >
                      <option value="" disabled>
                        Choose somebody
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
                  </div>
                  <button
                    className="button button--primary"
                    type="submit"
                    disabled={
                      submitDraft.isPending ||
                      reviewer1 === "" ||
                      reviewer2 === "" ||
                      reviewer1 === reviewer2
                    }
                  >
                    {submitDraft.isPending ? "Submitting…" : "Submit for review"}
                  </button>
                  {/* Two named reviewers are required, so a group with
                      fewer than two publish-flow-tool holders cannot
                      submit anything at all -- worth saying here rather
                      than leaving both selects empty with no explanation. */}
                  {reviewers.data !== undefined && reviewers.data.length < 2 && (
                    <p className="panel__hint">
                      Fewer than two people currently hold the publish grant, so there
                      is nobody eligible to name. Ask whoever manages staff accounts to
                      grant it before submitting.
                    </p>
                  )}
                </form>
              )}
            </EditorDropdown>
          )}

          {/* Discard and Withdraw are author-only on the server -- see
              `isAuthor`'s comment above -- so neither is offered to
              anyone else. `isOpen`/`isFrozen` between them cover every
              status this bar reaches (never both at once), so exactly
              one control or the explanatory note below renders. */}
          {isOpen && isAuthor && (
            <ConfirmAction
              message="Discard this draft? The proposal and every edit in it are deleted."
              confirmLabel="Discard draft"
              danger
              onConfirm={() =>
                // `parent_version` is null only when this draft was itself
                // drafted from another (now-discarded) draft -- an edge
                // case worth not crashing on, not a version to fall back
                // to: `versionId` is the one that just stopped existing.
                // `onOpenVersion(null)` sends the author somewhere that
                // still does.
                discardDraft.mutate(versionId, {
                  onError: onWriteError,
                  onSuccess: () => onOpenVersion(graph.version.parent_version),
                })
              }
            >
              {(open) => (
                <button
                  className="button button--danger"
                  type="button"
                  disabled={busy || editRefused}
                  onClick={open}
                >
                  Discard draft
                </button>
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
              <button
                className="button"
                type="button"
                disabled={busy || editRefused}
                onClick={() =>
                  withdrawDraft.mutate(undefined, { onError: onWriteError })
                }
              >
                Withdraw
              </button>
            ))}
        </div>
      </div>

      {graph.version.is_stale && (
        // Named here as well as on the review screen, because this is the
        // bar somebody edits under. `is_stale` is the server's answer,
        // through the same function the publish refusal reads, so this
        // cannot promise a publish the backend then declines.
        <p className="banner banner--warn">
          Behind the live version: something was published after this draft was copied,
          so publishing it is refused rather than silently reinstating whatever landed
          in between. There is no automatic rebase — draft again from the current live
          version and re-apply.
        </p>
      )}

      {lock !== null &&
        (heldByMe ? (
          <p className="banner banner--info">
            You last edited this draft at {formatTimestamp(lock.since)}. It's yours to
            keep editing until {formatTimestamp(lock.expires_at)} unless you edit again
            before then.{" "}
            <button
              className="link"
              type="button"
              disabled={busy}
              onClick={() => releaseLock.mutate(undefined, { onError: onWriteError })}
            >
              Release it
            </button>{" "}
            so somebody else can edit sooner.
          </p>
        ) : (
          // Not an error state: the lock is taken by the first edit and
          // released automatically once it goes idle, so the honest thing
          // to say is who to ask, not "locked". `expires_at` names the
          // moment this banner's own advice goes stale -- past it, the
          // lock is gone whether or not they ever come back to release it.
          <p className="banner banner--warn">
            {lock.email} last edited this at {formatTimestamp(lock.since)}. Nobody else
            can edit until {formatTimestamp(lock.expires_at)}, unless they release it
            first.
          </p>
        ))}

      {/* Moved out of .draftbar__right (which is otherwise just the one
          Review/Check-the-diff link in this state) rather than left as a
          flex sibling of it -- boxed banners are what every other "why a
          control isn't offered" fact in this bar already renders as, and
          giving this one the same full-width treatment is what actually
          lets the row above stay on one line.

          Only shown once frozen (`!isOpen`): while open, Discard being
          author-only is a minor aside -- Submit for review and every
          content edit are still wide open to a non-author editor, so
          there's plenty else to do and nothing missing worth explaining.
          Once frozen, Withdraw is the one thing left that Publish isn't,
          so its absence is worth a word. */}
      {!isAuthor && !isOpen && (
        <p className="banner banner--info">
          Only {changeRequest.created_by_email} can discard or withdraw this proposal.
        </p>
      )}

      {editRefused && (
        <p className="banner banner--warn">
          Your account can view this proposal but not change it.
        </p>
      )}

      {error !== null && (
        <p className="banner banner--error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
