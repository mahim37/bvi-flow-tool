import { useId, useState } from "react";
import { Link, NavLink } from "react-router-dom";

import type { Graph, UUID } from "../api/types";
import {
  useActivateVersion,
  useCreateDraft,
  useDiscardDraft,
  useReleaseLock,
  useSpawnProduct,
  useSubmitDraft,
  useWithdrawDraft,
} from "../api/queries";
import { useAuth } from "../auth/useAuth";
import { formatTimestamp, statusLabel, statusMeaning, versionLabel } from "./labels";
import {
  useReviewErrorHandler,
  useWriteErrorHandler,
  writeErrorMessage,
} from "./useWriteError";

interface DraftBarProps {
  graph: Graph;
  onOpenVersion: (versionId: UUID) => void;
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

export function DraftBar({ graph, onOpenVersion }: DraftBarProps) {
  const { identity, editRefused, reviewRefused } = useAuth();
  const onWriteError = useWriteErrorHandler();
  const onReviewError = useReviewErrorHandler();
  const versionId = graph.version.id;
  const changeRequest = graph.change_request;

  const labelId = useId();
  const summaryId = useId();
  const [proposing, setProposing] = useState(false);
  const [label, setLabel] = useState("");
  const [summary, setSummary] = useState("");

  const spawnNameId = useId();
  const spawnCodeId = useId();
  const [spawning, setSpawning] = useState(false);
  const [spawnName, setSpawnName] = useState("");
  const [spawnCode, setSpawnCode] = useState("");

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

  function startProposal(event: React.FormEvent) {
    event.preventDefault();
    createDraft.mutate(
      { versionId, label, summary },
      {
        onError: onWriteError,
        onSuccess: (created) => {
          setProposing(false);
          setLabel("");
          setSummary("");
          // Straight into the copy. Staying on the source would leave the
          // editor looking at a version its controls no longer apply to.
          onOpenVersion(created.draft_version);
        },
      },
    );
  }

  function startSpawn(event: React.FormEvent) {
    event.preventDefault();
    spawnProduct.mutate(
      { name: spawnName, code: spawnCode },
      {
        onError: onReviewError,
        onSuccess: (created) => {
          setSpawning(false);
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

  function activateThisVersion() {
    if (
      !window.confirm(
        `Activate ${versionLabel(graph.version)}? It goes live immediately, replacing whatever is live now, with no new review round.`,
      )
    ) {
      return;
    }
    activate.mutate(undefined, { onError: onReviewError });
  }

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
                <Cta
                  primary
                  title={activate.isPending ? "Activating…" : "Activate this version"}
                  description="Puts this exact version back in front of respondents. No new review needed."
                  disabled={activate.isPending}
                  onClick={activateThisVersion}
                />
              ))}

            {editRefused ? (
              <p className="banner banner--warn">
                Your account can view the flow tool but not propose changes.
              </p>
            ) : (
              !proposing && (
                <Cta
                  primary
                  title="Propose a change"
                  description="A draft is a whole copy of this version. Several can be open at once."
                  onClick={() => setProposing(true)}
                />
              )
            )}

            {reviewRefused ? (
              <p className="banner banner--warn">
                Your account can view the flow tool but not spawn a product from it.
              </p>
            ) : (
              !spawning && (
                <Cta
                  title="Spawn a product"
                  description="Copies this version into a brand-new questionnaire, live immediately."
                  onClick={() => setSpawning(true)}
                />
              )
            )}
          </div>
        </div>

        {proposing && (
          <form className="draftbar__form" onSubmit={startProposal}>
            <div className="field field--inline">
              <label htmlFor={labelId}>Name</label>
              <input
                id={labelId}
                value={label}
                placeholder="What this proposal is called"
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
            <div className="field field--inline">
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
            <button
              className="button button--quiet"
              type="button"
              onClick={() => setProposing(false)}
            >
              Cancel
            </button>
          </form>
        )}

        {spawning && (
          <form className="draftbar__form" onSubmit={startSpawn}>
            <div className="field field--inline">
              <label htmlFor={spawnNameId}>Name</label>
              <input
                id={spawnNameId}
                value={spawnName}
                required
                placeholder="The new product's name"
                onChange={(event) => setSpawnName(event.target.value)}
              />
            </div>
            <div className="field field--inline">
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
            <button
              className="button button--quiet"
              type="button"
              onClick={() => setSpawning(false)}
            >
              Cancel
            </button>
          </form>
        )}

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
          <Link className="button button--quiet" to={`/versions/${versionId}/review`}>
            {isOpen ? "Check the diff" : "Review and publish"}
          </Link>

          {isOpen && (
            <button
              className="button button--primary"
              type="button"
              disabled={busy || editRefused}
              onClick={() => submitDraft.mutate(undefined, { onError: onWriteError })}
            >
              Submit for review
            </button>
          )}

          {/* Discard and Withdraw are author-only on the server -- see
              `isAuthor`'s comment above -- so neither is offered to
              anyone else. `isOpen`/`isFrozen` between them cover every
              status this bar reaches (never both at once), so exactly
              one control or the explanatory note below renders. */}
          {isOpen && isAuthor && (
            <button
              className="button button--danger"
              type="button"
              disabled={busy || editRefused}
              onClick={() => {
                if (
                  !window.confirm(
                    "Discard this draft? The proposal and every edit in it are deleted.",
                  )
                ) {
                  return;
                }
                discardDraft.mutate(versionId, {
                  onError: onWriteError,
                  onSuccess: () =>
                    onOpenVersion(graph.version.parent_version ?? versionId),
                });
              }}
            >
              Discard draft
            </button>
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

          {!isAuthor && (
            <p className="banner banner--info">
              Only {changeRequest.created_by_email} can discard or withdraw this
              proposal.
            </p>
          )}
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
            You have been holding this draft since {formatTimestamp(lock.since)}.{" "}
            <button
              className="link"
              type="button"
              disabled={busy}
              onClick={() => releaseLock.mutate(undefined, { onError: onWriteError })}
            >
              Release it
            </button>{" "}
            so somebody else can edit.
          </p>
        ) : (
          // Not an error state: the lock is taken by the first edit and
          // released automatically once it goes idle, so the honest thing
          // to say is who to ask, not "locked".
          <p className="banner banner--warn">
            {lock.email} has been editing since {formatTimestamp(lock.since)}. Your
            edits will be refused until they release it or it goes idle.
          </p>
        ))}

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
