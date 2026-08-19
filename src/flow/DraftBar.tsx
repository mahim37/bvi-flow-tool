import { useId, useState } from "react";

import type { Graph, UUID } from "../api/types";
import {
  useCreateDraft,
  useDiscardDraft,
  useReleaseLock,
  useSubmitDraft,
  useWithdrawDraft,
} from "../api/queries";
import { useAuth } from "../auth/useAuth";
import { formatTimestamp } from "./labels";
import { useWriteErrorHandler, writeErrorMessage } from "./useWriteError";

interface DraftBarProps {
  graph: Graph;
  onOpenVersion: (versionId: UUID) => void;
}

export function DraftBar({ graph, onOpenVersion }: DraftBarProps) {
  const { identity, editRefused } = useAuth();
  const onWriteError = useWriteErrorHandler();
  const versionId = graph.version.id;
  const changeRequest = graph.change_request;

  const labelId = useId();
  const summaryId = useId();
  const [proposing, setProposing] = useState(false);
  const [label, setLabel] = useState("");
  const [summary, setSummary] = useState("");

  const createDraft = useCreateDraft();
  const discardDraft = useDiscardDraft();
  const submitDraft = useSubmitDraft(versionId);
  const withdrawDraft = useWithdrawDraft(versionId);
  const releaseLock = useReleaseLock(versionId);

  const error =
    writeErrorMessage(createDraft.error) ??
    writeErrorMessage(discardDraft.error) ??
    writeErrorMessage(submitDraft.error) ??
    writeErrorMessage(withdrawDraft.error) ??
    writeErrorMessage(releaseLock.error);

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

  if (changeRequest === null) {
    return (
      <div className="draftbar">
        <div className="draftbar__status">
          <strong>{graph.version.name}</strong>
          <span className="draftbar__note">
            {graph.version.is_active ? "Live version" : "Published version"} — read
            only. Edits are made on a proposal.
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
          <button
            className="button button--primary"
            type="button"
            onClick={() => setProposing(true)}
          >
            Propose a change
          </button>
        )}

        {error !== null && (
          <p className="banner banner--error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  const lock = changeRequest.lock;
  const heldByMe = lock !== null && lock.email === identity?.email;
  const isOpen = changeRequest.status === "open";
  const busy =
    submitDraft.isPending ||
    withdrawDraft.isPending ||
    discardDraft.isPending ||
    releaseLock.isPending;

  return (
    <div className="draftbar draftbar--draft">
      <div className="draftbar__status">
        <strong>
          {graph.version.label || graph.version.name} — draft
          {isOpen ? "" : ", submitted for review"}
        </strong>
        <span className="draftbar__note">
          Proposed by {changeRequest.created_by_email}
          {changeRequest.summary ? ` — ${changeRequest.summary}` : ""}
        </span>
      </div>

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
        {isOpen ? (
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
        ) : (
          <button
            className="button"
            type="button"
            disabled={busy || editRefused}
            onClick={() => withdrawDraft.mutate(undefined, { onError: onWriteError })}
          >
            Withdraw
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
