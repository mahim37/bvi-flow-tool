import { useId, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { ApiError } from "../api/client";
import { useApproveDraft, useRejectDraft, useReview } from "../api/queries";
import { bothReviewersApproved, type ChangeRequest, type UUID } from "../api/types";
import { useAuth } from "../auth/useAuth";
import { questionDiffCounts, visibleDiffItems } from "./diffCounts";
import { DiffList } from "./DiffList";
import { AlertsButton } from "./AlertsButton";
import type { ChromeAlert } from "./AlertsButton";
import { draftIssues } from "./draftIssues";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { LoadingStatus } from "@/components/ui/loading";
import { Textarea } from "@/components/ui/textarea";
import { emptyText, mutedHint, panelHeading, panelSection } from "@/lib/chrome";
import { cn } from "@/lib/utils";
import { useVersionContext } from "./versionContext";
import { decisionLabel, formatTimestamp } from "./labels";
import { useReviewErrorHandler, writeErrorMessage } from "./useWriteError";

function ReviewHistory({ changeRequest }: { changeRequest: ChangeRequest }) {
  if (changeRequest.reviews.length === 0) return null;
  return (
    <section className={panelSection} aria-labelledby="review-history">
      <h3 id="review-history" className={panelHeading}>
        Review history
      </h3>
      <ol className="flex list-none flex-col gap-2 p-0">
        {changeRequest.reviews.map((review) => (
          <li key={review.id}>
            <Card size="sm">
              <CardHeader>
                <CardTitle className="text-sm">
                  {decisionLabel(review.decision)}
                </CardTitle>
                <CardDescription>
                  by {review.reviewer_email} on {formatTimestamp(review.created)}
                </CardDescription>
              </CardHeader>
              {review.note !== "" && (
                <CardContent>
                  <p className="m-0 whitespace-pre-wrap">{review.note}</p>
                </CardContent>
              )}
            </Card>
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
      <main className="flex min-h-0 flex-1 flex-col">
        <LoadingStatus centered>Working out what changed…</LoadingStatus>
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

  const { diff, publish_blocker, change_request, base_version } = review.data;
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
  // the one still owed an approval). Publishing is not a separate button:
  // it is supposed to happen inside `editing.approve` only when *both*
  // `reviewer_*_approved_at` timestamps are set. One approval is never
  // enough, even if status has already become `approved`.
  const bothApproved = changeRequest !== null && bothReviewersApproved(changeRequest);
  const canApprove =
    !bothApproved &&
    (status === "submitted" || status === "approved") &&
    myApprovalTimestamp === null;
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
  // `canApprove`'s own concern). Status `approved` used to stand in for
  // this; the timestamps are the real fact, so a server that marks
  // `approved` after one of two does not look like a finished publish.
  const somebodyHasApproved =
    changeRequest !== null &&
    (changeRequest.reviewer_1_approved_at !== null ||
      changeRequest.reviewer_2_approved_at !== null);

  const canActOnDecision =
    version.is_draft &&
    !reviewRefused &&
    !isAuthor &&
    isNamedReviewer &&
    (canApprove || canReject);

  const items = visibleDiffItems(
    [...diff.questions, ...diff.options, ...diff.edges, ...diff.sections],
    graph,
  );
  const counts = questionDiffCounts(items, graph);

  const issueItems: ChromeAlert[] = version.is_draft
    ? draftIssues(graph, publish_blocker).map((issue) => {
        const questionId = issue.questionId;
        const body: ChromeAlert = {
          id: issue.id,
          tone: "error",
          children:
            issue.tags.length === 0 ? (
              issue.title
            ) : (
              <>
                <span className="text-destructive inline-flex items-baseline gap-1 font-medium">
                  <span className="underline decoration-current/40 underline-offset-2">
                    {issue.title}
                  </span>
                  <ArrowUpRight
                    className="mb-px inline size-3.5 shrink-0 stroke-[2.25] align-text-bottom"
                    aria-hidden="true"
                  />
                </span>
                <span className="mt-0.5 block">{issue.tags.join(" · ")}</span>
              </>
            ),
        };
        if (questionId !== null) {
          body.onSelect = () => showOnMap(questionId);
          body.actionLabel = `Open ${issue.title} on the map`;
        }
        return body;
      })
    : [];

  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-15">
      <header className="mb-5 flex flex-col gap-3">
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2.5">
            <h2 className="m-0 text-[1.3rem] font-extrabold tracking-tight">
              {version.is_draft ? "Review" : "What this version changed"}
            </h2>
            <AlertsButton kind="Issues" items={issueItems} />
          </div>
        </div>
        {diff.is_empty ? (
          <p className={cn(emptyText, "my-0")}>
            {base_version === null
              ? "There is no earlier version to diff this one against."
              : "Nothing has changed. This version still says exactly what the one it was copied from says."}
          </p>
        ) : (
          <ul
            className="m-0 flex list-none flex-wrap gap-2 p-0"
            aria-label="Change counts"
          >
            <li>
              <Badge tone="added" className="font-mono tracking-normal">
                +{counts.added} {counts.added === 1 ? "question" : "questions"}
              </Badge>
            </li>
            <li>
              <Badge tone="removed" className="font-mono tracking-normal">
                −{counts.removed} removed
              </Badge>
            </li>
            <li>
              <Badge tone="changed" className="font-mono tracking-normal">
                {counts.changed} changed
              </Badge>
            </li>
          </ul>
        )}
      </header>

      {isAuthor &&
        isNamedReviewer &&
        (status === "submitted" || status === "approved") && (
          <p className={cn(emptyText, "mt-0 mb-5")}>
            You cannot review your own proposal.
          </p>
        )}

      <DiffList items={items} graph={graph} onShowOnMap={showOnMap} />

      {changeRequest !== null && <ReviewHistory changeRequest={changeRequest} />}

      {canActOnDecision && (
        <section className={panelSection} aria-labelledby="review-actions">
          <h3 id="review-actions" className={panelHeading}>
            Decision
          </h3>

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
                    {...(approve.isPending ? { disabled: true } : {})}
                    onChange={(event) => setApproveNote(event.target.value)}
                  />
                </Field>
                <Button variant="primary" type="submit" loading={approve.isPending}>
                  Approve
                </Button>
                <p className={mutedHint}>
                  {somebodyHasApproved
                    ? "This is the second required approval, and it publishes the draft."
                    : "Records your approval. Publishing waits for the other required reviewer."}
                </p>
              </form>
            )}

            {canReject && (
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
                    {...(reject.isPending ? { disabled: true } : {})}
                    onChange={(event) => setRejectNote(event.target.value)}
                  />
                </Field>
                <Button
                  type="submit"
                  loading={reject.isPending}
                  disabled={rejectNote.trim() === ""}
                >
                  {somebodyHasApproved ? "Undo the approval" : "Send back"}
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
            )}
          </div>

          {canReject && !canApprove && !bothApproved && (
            <p className={emptyText}>
              You have approved this. It publishes on its own the moment the other
              reviewer approves too.
            </p>
          )}

          {bothApproved && version.is_draft && (
            <p className={emptyText}>Both required reviewers have approved.</p>
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
