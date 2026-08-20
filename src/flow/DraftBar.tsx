import { useId, useState } from "react";
import { Link } from "react-router-dom";

import type { Graph, UUID } from "../api/types";
import {
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

  const error =
    writeErrorMessage(createDraft.error) ??
    writeErrorMessage(discardDraft.error) ??
    writeErrorMessage(submitDraft.error) ??
    writeErrorMessage(withdrawDraft.error) ??
    writeErrorMessage(releaseLock.error) ??
    writeErrorMessage(spawnProduct.error);

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

  // Branches on `is_draft`, not on whether a proposal exists. A published
  // version keeps the proposal it was published from -- that row is the
  // history of the change, and `graph/` still serves it -- so "has a
  // change request" stopped meaning "is editable" the moment publishing
  // stood `is_draft` down.
  if (!graph.version.is_draft) {
    return (
      <div className="draftbar">
        <div className="draftbar__status">
          <strong>{versionLabel(graph.version)}</strong>
          <span className="draftbar__note">
            {graph.version.is_active ? "Live version" : "Published version"} — read
            only. Edits are made on a proposal.
            {changeRequest !== null && changeRequest.published_at !== null && (
              <>
                {" "}
                Published {formatTimestamp(changeRequest.published_at)} from a proposal
                by {changeRequest.created_by_email}.
              </>
            )}
          </span>
        </div>

        {editRefused ? (
          <p className="banner banner--warn">
            Your account can view the flow tool but not propose changes.
          </p>
        ) : proposing ? (
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
        ) : (
          <>
            <button
              className="button button--primary"
              type="button"
              onClick={() => setProposing(true)}
            >
              Propose a change
            </button>
            {/* Several drafts may be open against one questionnaire, so
                this is not a one-at-a-time button. What is refused is
                publishing a draft the live version has moved out from
                under -- see the staleness banner below. */}
            <span className="draftbar__note">
              A draft is a whole copy of this version. Several can be open at once.
            </span>
          </>
        )}

        {reviewRefused ? (
          <p className="banner banner--warn">
            Your account can view the flow tool but not spawn a product from it.
          </p>
        ) : spawning ? (
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
        ) : (
          <>
            <button className="button" type="button" onClick={() => setSpawning(true)}>
              Spawn a product
            </button>
            {/* A product, not a draft: it goes live the moment it exists,
                with no review round, and there is no merge back into
                this timeline -- see `editing.spawn_product`. */}
            <span className="draftbar__note">
              Copies this version into a brand-new questionnaire, live immediately.
            </span>
          </>
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
        <p className="banner banner--warn">
          This version is a draft with no proposal attached, which should not be
          possible. Nothing here can be edited safely.
        </p>
      </div>
    );
  }

  const lock = changeRequest.lock;
  const heldByMe = lock !== null && lock.email === identity?.email;
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
      <div className="draftbar__status">
        <strong>
          {versionLabel(graph.version)} —{" "}
          {statusLabel(changeRequest.status).toLowerCase()}
        </strong>
        <span className="draftbar__note">
          {statusMeaning(changeRequest.status)} Proposed by{" "}
          {changeRequest.created_by_email}
          {changeRequest.summary !== "" && ` — ${changeRequest.summary}`}
        </span>
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

      <div className="draftbar__actions">
        <Link className="button button--quiet" to={`/versions/${versionId}/review`}>
          {isOpen ? "Check the diff" : "Review and publish"}
        </Link>

        {isOpen && (
          <>
            <button
              className="button button--primary"
              type="button"
              disabled={busy || editRefused}
              onClick={() => submitDraft.mutate(undefined, { onError: onWriteError })}
            >
              Submit for review
            </button>
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
          </>
        )}

        {isFrozen && (
          <button
            className="button"
            type="button"
            disabled={busy || editRefused}
            onClick={() => withdrawDraft.mutate(undefined, { onError: onWriteError })}
          >
            {changeRequest.status === "approved"
              ? "Withdraw (drops the approval)"
              : "Withdraw"}
          </button>
        )}
      </div>

      {error !== null && (
        <p className="banner banner--error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
