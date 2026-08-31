import { useId, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ApiError } from "../api/client";
import {
  useApproveDraft,
  usePublishDraft,
  useRejectDraft,
  useReview,
} from "../api/queries";
import type { ChangeRequest, DiffKind, ItemDiff, UUID } from "../api/types";
import { useAuth } from "../auth/useAuth";
import { ConfirmAction } from "./ConfirmAction";
import { DiffList } from "./DiffList";
import { useVersionContext } from "./versionContext";
import {
  decisionLabel,
  formatTimestamp,
  statusLabel,
  statusMeaning,
  versionLabel,
} from "./labels";
import { useReviewErrorHandler, writeErrorMessage } from "./useWriteError";

const KINDS: DiffKind[] = ["question", "option", "edge", "section"];

function ReviewHistory({ changeRequest }: { changeRequest: ChangeRequest }) {
  if (changeRequest.reviews.length === 0) return null;
  return (
    <section className="panel__section" aria-labelledby="review-history">
      <h3 id="review-history" className="panel__heading">
        Review history
      </h3>
      {/* Every round, not just the latest verdict. A proposal rejected
          twice for the same reason and submitted a third time is the case
          this exists for, and it is unreadable from one most-recent row. */}
      <ol className="reviews">
        {changeRequest.reviews.map((review) => (
          <li
            key={review.id}
            className={`reviews__row reviews__row--${review.decision}`}
          >
            <div className="reviews__head">
              <span className="reviews__decision">
                {decisionLabel(review.decision)}
              </span>
              <span className="reviews__by">
                by {review.reviewer_email} on {formatTimestamp(review.created)}
              </span>
            </div>
            {review.note !== "" && <p className="reviews__note">{review.note}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ReviewView() {
  const { versionId } = useParams<{ versionId: string }>();
  const navigate = useNavigate();
  const { graph } = useVersionContext();
  const { identity, reviewRefused } = useAuth();
  const onReviewError = useReviewErrorHandler();

  const review = useReview(versionId ?? null);
  const approve = useApproveDraft(versionId as UUID);
  const reject = useRejectDraft(versionId as UUID);
  const publish = usePublishDraft(versionId as UUID);

  const approveNoteId = useId();
  const rejectNoteId = useId();
  const [approveNote, setApproveNote] = useState("");
  const [rejectNote, setRejectNote] = useState("");

  const error =
    writeErrorMessage(approve.error) ??
    writeErrorMessage(reject.error) ??
    writeErrorMessage(publish.error);

  function showOnMap(questionId: string) {
    navigate(`/versions/${versionId}?question=${questionId}`);
  }

  if (review.isPending) {
    return (
      <main className="page">
        <p className="banner banner--info">Working out what changed…</p>
      </main>
    );
  }

  if (review.isError || review.data === undefined) {
    return (
      <main className="page">
        <p className="banner banner--error" role="alert">
          {review.error instanceof ApiError && review.error.isConflict
            ? review.error.message
            : review.error instanceof Error
              ? review.error.message
              : "Could not work out what changed."}
        </p>
      </main>
    );
  }

  const { diff, summary, publish_blocker, base_version, change_request } = review.data;
  const version = review.data.version;
  const changeRequest = change_request ?? graph.change_request;
  const status = changeRequest?.status ?? null;

  // The author is not offered approve or reject at all. `editing.approve`
  // refuses a self-review with a 403 whatever codes they hold, so the
  // buttons would be a guaranteed refusal -- and the honest thing is to
  // say who has to look at it instead. Publish is a different matter: by
  // then somebody else has already cleared it, so pressing it is
  // scheduling rather than reviewing.
  const isAuthor =
    changeRequest !== null && changeRequest.created_by_email === identity?.email;

  // A `publish_flow_tool` holder who is not one of the two people this
  // proposal actually named is refused the same way the author is --
  // `editing.approve`/`editing.reject` both raise `NotANamedReviewerError`
  // for exactly this case. Checked client-side for the same reason
  // `DraftBar.tsx`'s `isAuthor` gate on Discard/Withdraw is: an offered
  // button that then 403s would be read by `useWriteErrorHandler` as "this
  // account lacks the publish grant," hiding every review control app-wide
  // for the rest of the session instead of naming the real reason.
  const isNamedReviewer =
    changeRequest !== null &&
    identity !== null &&
    (changeRequest.reviewer_1_email === identity.email ||
      changeRequest.reviewer_2_email === identity.email);

  const canApprove = status === "submitted";
  // Reject reaches an approved proposal too, not just a submitted one --
  // it is a reviewer's own way to reverse an approval they've changed
  // their mind about, mirroring `editing.reject`'s widened guard on the
  // server. `withdraw` is the other route back to open, but that one is
  // author-only, so without this a reviewer had no way to undo their own
  // decision at all.
  const canReject = status === "submitted" || status === "approved";
  const canPublish = status === "approved";

  const items: Record<DiffKind, ItemDiff[]> = {
    section: diff.sections,
    question: diff.questions,
    option: diff.options,
    edge: diff.edges,
  };

  return (
    <main className="page page--review">
      <header className="page__header">
        <h2 className="page__title">
          {version.is_draft ? "Review" : "What this version changed"}
        </h2>
        <p className="page__subtitle">
          {versionLabel(version)}
          {base_version === null ? (
            // A draft with no parent is the first version of a new
            // questionnaire, so everything in it is an addition. Saying so
            // beats a diff that silently reports the whole questionnaire
            // as added and leaves the reader guessing why.
            <> — compared against nothing, because it has no earlier version.</>
          ) : (
            <> — compared against {versionLabel(base_version)}.</>
          )}
        </p>
      </header>

      {changeRequest !== null && (
        <div className="review__status">
          <p className="review__statusline">
            <strong>{statusLabel(changeRequest.status)}</strong> —{" "}
            {statusMeaning(changeRequest.status)}
          </p>
          <p className="review__meta">
            Proposed by {changeRequest.created_by_email}
            {changeRequest.summary !== "" && ` — ${changeRequest.summary}`}
            {changeRequest.submitted_at !== null &&
              `. Submitted ${formatTimestamp(changeRequest.submitted_at)}`}
            {changeRequest.published_at !== null &&
              `. Published ${formatTimestamp(changeRequest.published_at)}`}
          </p>
          {changeRequest.reviewer_1_email !== null &&
            changeRequest.reviewer_2_email !== null && (
              <p className="review__meta">
                Reviewers: {changeRequest.reviewer_1_email} and{" "}
                {changeRequest.reviewer_2_email}
              </p>
            )}
        </div>
      )}

      {version.is_stale && (
        // Surfaced here as well as on the draft bar, because this is the
        // screen where somebody is about to approve it. A reviewer who
        // clears a stale draft finds out at publish, which wastes the one
        // round trip through a second person the whole workflow is for.
        <p className="banner banner--warn" role="alert">
          Somebody published underneath this draft: the version it was copied from is no
          longer the latest one. Publishing is refused rather than silently reinstating
          whatever landed in between. Open a new draft from the latest version and
          re-apply these changes.
        </p>
      )}

      {publish_blocker !== null && (
        <p className="banner banner--error" role="alert">
          <strong>This cannot be published as it stands.</strong> {publish_blocker}
        </p>
      )}

      <section className="panel__section" aria-labelledby="diff-summary">
        <h3 id="diff-summary" className="panel__heading">
          Summary
        </h3>
        {diff.is_empty ? (
          // Said plainly, because opening a draft and changing nothing is
          // a thing people do, and an empty list otherwise reads as "the
          // diff failed to load".
          <p className="empty">
            Nothing has changed. This version still says exactly what the one it was
            copied from says.
          </p>
        ) : (
          <ul className="summary">
            <li>
              <span className="summary__count">{summary.added}</span> added
            </li>
            <li>
              <span className="summary__count">{summary.removed}</span> removed
            </li>
            <li>
              <span className="summary__count">{summary.changed}</span> changed
            </li>
          </ul>
        )}
      </section>

      <div className="diff">
        {KINDS.map((kind) => (
          <DiffList
            key={kind}
            kind={kind}
            items={items[kind]}
            onShowOnMap={showOnMap}
          />
        ))}
      </div>

      {changeRequest !== null && <ReviewHistory changeRequest={changeRequest} />}

      {version.is_draft && (
        <section className="panel__section" aria-labelledby="review-actions">
          <h3 id="review-actions" className="panel__heading">
            Decision
          </h3>

          {reviewRefused && (
            <p className="banner banner--warn">
              Your account can read this diff but not act on it. Approving, sending back
              and publishing need the flow-tool publish grant, which is separate from
              the edit one.
            </p>
          )}

          {status === "open" && (
            <p className="empty">
              This proposal has not been submitted yet, so there is nothing to decide.
              Its author submits it when it is ready to be read.
            </p>
          )}

          {status === "published" && (
            <p className="empty">
              This proposal has been published. Nothing is left to do.
            </p>
          )}

          {canApprove && isAuthor && (
            <p className="banner banner--warn">
              This is your own proposal, so you cannot approve or send it back. Somebody
              else has to read it — that independent check is the whole point of the
              workflow. You may press publish once they have cleared it.
            </p>
          )}

          {/* status === "approved" here -- canApprove is false, so the
              banner above didn't fire, but canReject still applies. */}
          {canReject && !canApprove && isAuthor && (
            <p className="banner banner--warn">
              This is your own proposal, so you cannot send it back either, even now
              that it is approved. Withdrawing it is yours to do instead, from the map
              -- that also drops the approval.
            </p>
          )}

          {canReject && !isAuthor && !isNamedReviewer && changeRequest !== null && (
            <p className="banner banner--warn">
              You hold the publish grant, but this proposal named two other people as
              its reviewers: {changeRequest.reviewer_1_email ?? "someone"} and{" "}
              {changeRequest.reviewer_2_email ?? "someone"}. Only they can approve or
              send it back.
            </p>
          )}

          {canReject && !isAuthor && isNamedReviewer && (
            <div className="review__forms">
              {canApprove && (
                <form
                  className="review__form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    approve.mutate(approveNote, {
                      onError: onReviewError,
                      onSuccess: () => setApproveNote(""),
                    });
                  }}
                >
                  <div className="field">
                    <label htmlFor={approveNoteId}>Note (optional)</label>
                    <textarea
                      id={approveNoteId}
                      rows={2}
                      value={approveNote}
                      placeholder="Anything worth saying alongside an approval"
                      disabled={approve.isPending || reviewRefused}
                      onChange={(event) => setApproveNote(event.target.value)}
                    />
                  </div>
                  <button
                    className="button button--primary"
                    type="submit"
                    disabled={approve.isPending || reviewRefused}
                  >
                    {approve.isPending ? "Approving…" : "Approve"}
                  </button>
                  <p className="panel__hint">
                    Approving freezes the draft as it stands. What gets published is
                    what you read.
                  </p>
                </form>
              )}

              <form
                className="review__form"
                onSubmit={(event) => {
                  event.preventDefault();
                  reject.mutate(rejectNote, {
                    onError: onReviewError,
                    onSuccess: () => setRejectNote(""),
                  });
                }}
              >
                <div className="field">
                  <label htmlFor={rejectNoteId}>Why it is going back</label>
                  <textarea
                    id={rejectNoteId}
                    rows={2}
                    required
                    value={rejectNote}
                    placeholder="What the author has to change"
                    disabled={reject.isPending || reviewRefused}
                    onChange={(event) => setRejectNote(event.target.value)}
                  />
                </div>
                <button
                  className="button"
                  type="submit"
                  disabled={
                    reject.isPending || reviewRefused || rejectNote.trim() === ""
                  }
                >
                  {reject.isPending
                    ? "Sending back…"
                    : canApprove
                      ? "Send back"
                      : "Undo the approval"}
                </button>
                {/* A rejection with nothing to say makes the author guess,
                    which is why the note is required here and on the
                    server. There is no "rejected" state: this returns the
                    proposal to open, and your reasons are kept with it. */}
                <p className="panel__hint">
                  This returns the proposal to open so its author can work on it again.
                  {!canApprove &&
                    " It also withdraws the approval you're reversing."}{" "}
                  Your note is kept with it and cannot be overwritten by a resubmission.
                </p>
              </form>
            </div>
          )}

          {canPublish && (
            <div className="review__publish">
              <p>
                Approved
                {changeRequest !== null && changeRequest.reviews[0] !== undefined
                  ? ` by ${changeRequest.reviews[0].reviewer_email}`
                  : ""}
                . Publishing makes this the latest questionnaire.
              </p>
              <ConfirmAction
                message="Publish this version? It becomes the latest questionnaire, and every new assessment is served from it."
                confirmLabel="Publish"
                onConfirm={() => publish.mutate(undefined, { onError: onReviewError })}
              >
                {(open) => (
                  <button
                    className="button button--primary"
                    type="button"
                    disabled={publish.isPending || reviewRefused}
                    onClick={open}
                  >
                    {publish.isPending ? "Publishing…" : "Publish"}
                  </button>
                )}
              </ConfirmAction>
              <p className="panel__hint">
                The version this replaces is kept exactly as it is, so rolling back is
                activating the old one rather than restoring anything.
              </p>
            </div>
          )}

          {error !== null && (
            <p className="banner banner--error" role="alert">
              {error}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
