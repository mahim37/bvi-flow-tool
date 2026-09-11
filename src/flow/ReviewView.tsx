import { useId, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ApiError } from "../api/client";
import { useApproveDraft, useRejectDraft, useReview } from "../api/queries";
import type { ChangeRequest, DiffKind, ItemDiff, UUID } from "../api/types";
import { useAuth } from "../auth/useAuth";
import { DiffList } from "./DiffList";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { emptyText, mutedHint, panelHeading, panelSection } from "@/lib/chrome";
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
    <section className={panelSection} aria-labelledby="review-history">
      <h3 id="review-history" className={panelHeading}>
        Review history
      </h3>
      <ol className="list-none p-0">
        {changeRequest.reviews.map((review) => (
          <li
            key={review.id}
            className={
              review.decision === "approved"
                ? "mt-2 rounded-lg border border-border border-l-4 border-l-green bg-card p-3 first:mt-0"
                : "mt-2 rounded-lg border border-border border-l-4 border-l-emphasis bg-card p-3 first:mt-0"
            }
          >
            <div className="flex flex-wrap items-baseline gap-2.5">
              <span className="font-extrabold">{decisionLabel(review.decision)}</span>
              <span className="text-muted-foreground text-[0.85rem]">
                by {review.reviewer_email} on {formatTimestamp(review.created)}
              </span>
            </div>
            {review.note !== "" && (
              <p className="mt-1.5 mb-0 whitespace-pre-wrap">{review.note}</p>
            )}
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

  const approveNoteId = useId();
  const rejectNoteId = useId();
  const [approveNote, setApproveNote] = useState("");
  const [rejectNote, setRejectNote] = useState("");

  const error = writeErrorMessage(approve.error) ?? writeErrorMessage(reject.error);

  function showOnMap(questionId: string) {
    navigate(`/versions/${versionId}?question=${questionId}`);
  }

  if (review.isPending) {
    return (
      <main className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-15">
        <Banner tone="info">Working out what changed…</Banner>
      </main>
    );
  }

  if (review.isError || review.data === undefined) {
    return (
      <main className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-15">
        <Banner tone="error" role="alert">
          {review.error instanceof ApiError && review.error.isConflict
            ? review.error.message
            : review.error instanceof Error
              ? review.error.message
              : "Could not work out what changed."}
        </Banner>
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
  // say who has to look at it instead.
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

  // Which of the two slots *this* identity occupies, if either -- and
  // whether they've already used it. `editing.approve` refuses a second
  // approval from the same reviewer (`reviewer_1_approved_at`/`_2_` set
  // once and never cleared except by `withdraw`/`reject`), so the form
  // has to know not to offer it again, not just rely on the server 403.
  const myApprovalTimestamp =
    changeRequest === null || identity === null
      ? null
      : changeRequest.reviewer_1_email === identity.email
        ? changeRequest.reviewer_1_approved_at
        : changeRequest.reviewer_2_email === identity.email
          ? changeRequest.reviewer_2_approved_at
          : null;

  // Callable from `submitted` *or* `approved` now, not just `submitted` --
  // the first reviewer's own approval moves status to `approved`, and the
  // *second* reviewer's approve call has to still reach the form from
  // there (their own `myApprovalTimestamp` is what actually gates it, not
  // status alone: `approved` alone doesn't say whether *this* identity is
  // the one still owed an approval). There is no separate `canPublish`
  // any more -- the moment both have approved, `editing.approve` publishes
  // in the same call, so there is never a distinct "approved, waiting for
  // publish" state for a human to act on.
  const canApprove =
    (status === "submitted" || status === "approved") && myApprovalTimestamp === null;
  // Reject reaches an approved proposal too, not just a submitted one --
  // it is a reviewer's own way to reverse an approval (their own or the
  // other reviewer's) they've changed their mind about, mirroring
  // `editing.reject`'s widened guard on the server. `withdraw` is the
  // other route back to open, but that one is author-only, so without
  // this a reviewer had no way to undo a decision at all.
  const canReject = status === "submitted" || status === "approved";
  // Distinguishes the reject button's own wording ("send back" vs. "undo
  // the approval") -- whether *anyone* has approved yet, not whether
  // *this* reviewer specifically has (that's `myApprovalTimestamp`,
  // `canApprove`'s own concern). `status === "approved"` already means at
  // least one of the two has cleared it.
  const somebodyHasApproved = status === "approved";

  const items: Record<DiffKind, ItemDiff[]> = {
    section: diff.sections,
    question: diff.questions,
    option: diff.options,
    edge: diff.edges,
  };

  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-15">
      <header className="mb-4">
        <h2 className="mb-1 text-[1.3rem] font-extrabold tracking-tight">
          {version.is_draft ? "Review" : "What this version changed"}
        </h2>
        <p className="text-muted-foreground m-0 max-w-[72ch]">
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
        <div className="mb-3.5 rounded-lg border border-border bg-card p-3.5">
          <p className="m-0 mb-1">
            <strong>{statusLabel(changeRequest.status)}</strong> —{" "}
            {statusMeaning(changeRequest.status)}
          </p>
          <p className="text-muted-foreground m-0 text-[0.88rem]">
            Proposed by {changeRequest.created_by_email}
            {changeRequest.summary !== "" && ` — ${changeRequest.summary}`}
            {changeRequest.submitted_at !== null &&
              `. Submitted ${formatTimestamp(changeRequest.submitted_at)}`}
            {changeRequest.published_at !== null &&
              `. Published ${formatTimestamp(changeRequest.published_at)}`}
          </p>
          {changeRequest.reviewer_1_email !== null &&
            changeRequest.reviewer_2_email !== null && (
              <p className="text-muted-foreground m-0 text-[0.88rem]">
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
        <Banner tone="warn" role="alert">
          Somebody published underneath this draft: the version it was copied from is no
          longer the latest one. Publishing is refused rather than silently reinstating
          whatever landed in between. Open a new draft from the latest version and
          re-apply these changes.
        </Banner>
      )}

      {publish_blocker !== null && (
        <Banner tone="error" role="alert">
          <strong>This cannot be published as it stands.</strong> {publish_blocker}
        </Banner>
      )}

      <section className={panelSection} aria-labelledby="diff-summary">
        <h3 id="diff-summary" className={panelHeading}>
          Summary
        </h3>
        {diff.is_empty ? (
          // Said plainly, because opening a draft and changing nothing is
          // a thing people do, and an empty list otherwise reads as "the
          // diff failed to load".
          <p className={emptyText}>
            Nothing has changed. This version still says exactly what the one it was
            copied from says.
          </p>
        ) : (
          <ul className="text-muted-foreground m-0 flex list-none gap-[22px] p-0">
            <li>
              <span className="mr-1.5 text-[1.4rem] font-extrabold text-foreground">
                {summary.added}
              </span>{" "}
              added
            </li>
            <li>
              <span className="mr-1.5 text-[1.4rem] font-extrabold text-foreground">
                {summary.removed}
              </span>{" "}
              removed
            </li>
            <li>
              <span className="mr-1.5 text-[1.4rem] font-extrabold text-foreground">
                {summary.changed}
              </span>{" "}
              changed
            </li>
          </ul>
        )}
      </section>

      <div className="grid gap-4.5">
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
        <section className={panelSection} aria-labelledby="review-actions">
          <h3 id="review-actions" className={panelHeading}>
            Decision
          </h3>

          {reviewRefused && (
            <Banner tone="warn">
              Your account can read this diff but not act on it. Approving, sending back
              and publishing need the flow-tool publish grant, which is separate from
              the edit one.
            </Banner>
          )}

          {status === "open" && (
            <p className={emptyText}>
              This proposal has not been submitted yet, so there is nothing to decide.
              Its author submits it when it is ready to be read.
            </p>
          )}

          {status === "published" && (
            <p className={emptyText}>
              This proposal has been published. Nothing is left to do.
            </p>
          )}

          {canApprove && isAuthor && (
            <Banner tone="warn">
              This is your own proposal, so you cannot approve or send it back. Somebody
              else has to read it — that independent check is the whole point of the
              workflow. It publishes on its own the moment both reviewers have approved.
            </Banner>
          )}

          {/* somebodyHasApproved here -- the banner above only fires while
              this identity itself could still approve, so once at least one
              approval exists (whether by this identity or not, for an
              author it's always "not") this is the one that applies. */}
          {canReject && somebodyHasApproved && isAuthor && (
            <Banner tone="warn">
              This is your own proposal, so you cannot send it back either, even now
              that it is approved. Withdrawing it is yours to do instead, from the map
              -- that also drops the approval.
            </Banner>
          )}

          {canReject && !isAuthor && !isNamedReviewer && changeRequest !== null && (
            <Banner tone="warn">
              You hold the publish grant, but this proposal named two other people as
              its reviewers: {changeRequest.reviewer_1_email ?? "someone"} and{" "}
              {changeRequest.reviewer_2_email ?? "someone"}. Only they can approve or
              send it back.
            </Banner>
          )}

          {canReject && !isAuthor && isNamedReviewer && (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
              {canApprove && (
                <form
                  className="rounded-lg border border-border bg-card p-3.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    approve.mutate(approveNote, {
                      onError: onReviewError,
                      onSuccess: () => setApproveNote(""),
                    });
                  }}
                >
                  <Field label="Note (optional)" htmlFor={approveNoteId}>
                    <Textarea
                      id={approveNoteId}
                      rows={2}
                      value={approveNote}
                      placeholder="Anything worth saying alongside an approval"
                      {...(approve.isPending || reviewRefused
                        ? { disabled: true }
                        : {})}
                      onChange={(event) => setApproveNote(event.target.value)}
                    />
                  </Field>
                  <Button
                    variant="primary"
                    type="submit"
                    disabled={approve.isPending || reviewRefused}
                  >
                    {approve.isPending ? "Approving…" : "Approve"}
                  </Button>
                  <p className={mutedHint}>
                    Approving freezes the draft as it stands. What gets published is
                    what you read.
                  </p>
                </form>
              )}

              <form
                className="rounded-lg border border-border bg-card p-3.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  reject.mutate(rejectNote, {
                    onError: onReviewError,
                    onSuccess: () => setRejectNote(""),
                  });
                }}
              >
                <Field label="Why it is going back" htmlFor={rejectNoteId}>
                  <Textarea
                    id={rejectNoteId}
                    rows={2}
                    required
                    value={rejectNote}
                    placeholder="What the author has to change"
                    {...(reject.isPending || reviewRefused ? { disabled: true } : {})}
                    onChange={(event) => setRejectNote(event.target.value)}
                  />
                </Field>
                <Button
                  type="submit"
                  disabled={
                    reject.isPending || reviewRefused || rejectNote.trim() === ""
                  }
                >
                  {reject.isPending
                    ? "Sending back…"
                    : somebodyHasApproved
                      ? "Undo the approval"
                      : "Send back"}
                </Button>
                {/* A rejection with nothing to say makes the author guess,
                    which is why the note is required here and on the
                    server. There is no "rejected" state: this returns the
                    proposal to open, and your reasons are kept with it. */}
                <p className={mutedHint}>
                  This returns the proposal to open so its author can work on it again.
                  {somebodyHasApproved &&
                    " It also withdraws the approval you're reversing."}{" "}
                  Your note is kept with it and cannot be overwritten by a resubmission.
                </p>
              </form>
            </div>
          )}

          {canReject && !isAuthor && isNamedReviewer && !canApprove && (
            <p className={emptyText}>
              You have approved this. It publishes on its own the moment the other
              reviewer approves too.
            </p>
          )}

          {error !== null && (
            <Banner tone="error" role="alert">
              {error}
            </Banner>
          )}
        </section>
      )}
    </main>
  );
}
