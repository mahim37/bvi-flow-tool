import { useId, useState } from "react";

import { useEligibleSubstituteReviewers, useSubmitDraft } from "../api/queries";
import type { SubstituteReviewer, UUID } from "../api/types";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field, nativeSelectClassName } from "@/components/ui/field";
import { emptyText } from "@/lib/chrome";
import { ConfirmAction } from "./ConfirmAction";
import { EditorDialog } from "./EditorDialog";
import { REQUIRED_REVIEWER_EMAILS } from "./labels";
import { useWriteErrorHandler, writeErrorMessage } from "./useWriteError";

type SubmitDraftMutation = ReturnType<typeof useSubmitDraft>;

interface SubmitForReviewProps {
  versionId: UUID;
  /** The draft's own author -- `DraftBar` already knows this is the
   * signed-in identity, since the button is only ever shown to them. */
  authorEmail: string;
  disabled: boolean;
  /** `DraftBar`'s own mutation instance, not a fresh one of this
   * component's own -- its `isPending` feeds `DraftBar`'s cross-button
   * `busy` gate (Discard/Withdraw/release-lock all disable while a
   * submit is in flight), which a second, unrelated mutation instance
   * here would leave blind to. */
  submitDraft: SubmitDraftMutation;
}

/**
 * "Submit for review". A plain confirm for almost every author, since
 * `editing.submit` always resolves the same two required reviewers
 * itself (`REQUIRED_REVIEWER_EMAILS`) with nothing left to ask.
 *
 * The one exception: an author who *is* one of those two required
 * reviewers cannot review their own proposal, so submitting becomes a
 * short form asking them to name someone to stand in on that one slot --
 * the other required reviewer is untouched either way. Which shape
 * renders is decided once, from `authorEmail`, not from a click, so the
 * button never changes behavior out from under the person about to press
 * it.
 */
export function SubmitForReview({
  versionId,
  authorEmail,
  disabled,
  submitDraft,
}: SubmitForReviewProps) {
  const onWriteError = useWriteErrorHandler();

  // `.find` alone (without this membership check first) would always
  // return a value -- an author who is neither required reviewer still
  // has one array entry "not equal to authorEmail" (in fact both), so
  // the substitute form would wrongly render for every author instead of
  // only the two it's meant for.
  const isRequiredReviewer = (REQUIRED_REVIEWER_EMAILS as readonly string[]).includes(
    authorEmail,
  );
  const otherReviewerEmail = isRequiredReviewer
    ? REQUIRED_REVIEWER_EMAILS.find((email) => email !== authorEmail)
    : undefined;

  // `authorEmail` isn't one of the two required reviewers -- true of
  // almost every author, and the only case where nothing is left to ask.
  if (otherReviewerEmail === undefined) {
    return (
      <ConfirmAction
        message={`Submit for review? ${REQUIRED_REVIEWER_EMAILS.join(" and ")} will both need to approve before this publishes.`}
        confirmLabel="Submit for review"
        onConfirm={() => submitDraft.mutate(undefined, { onError: onWriteError })}
      >
        {(open) => (
          <Button
            variant="primary"
            loading={submitDraft.isPending}
            disabled={disabled}
            onClick={open}
          >
            Submit for review
          </Button>
        )}
      </ConfirmAction>
    );
  }

  return (
    <SubstituteReviewerDialog
      versionId={versionId}
      otherReviewerEmail={otherReviewerEmail}
      disabled={disabled}
      submitDraft={submitDraft}
    />
  );
}

function SubstituteReviewerDialog({
  versionId,
  otherReviewerEmail,
  disabled,
  submitDraft,
}: {
  versionId: UUID;
  otherReviewerEmail: string;
  disabled: boolean;
  submitDraft: SubmitDraftMutation;
}) {
  const onWriteError = useWriteErrorHandler();
  const selectId = useId();
  const [open, setOpen] = useState(false);
  const [substituteId, setSubstituteId] = useState<UUID | "">("");
  // Fetched only while the dialog is actually open -- every other author
  // never needs this list, and this one only needs it from the moment
  // they're about to fill in the form.
  const eligible = useEligibleSubstituteReviewers(versionId, open);
  const reviewers: SubstituteReviewer[] = eligible.data ?? [];
  const error = writeErrorMessage(submitDraft.error);

  return (
    <EditorDialog
      title="Submit for review"
      description={`You're one of the two required reviewers, so you can't review your own proposal. Name someone to stand in for you here -- ${otherReviewerEmail} still reviews as themselves.`}
      trigger={
        <Button variant="primary" disabled={disabled}>
          Submit for review
        </Button>
      }
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSubstituteId("");
      }}
    >
      {(close) => {
        if (eligible.isLoading) {
          return <p className={emptyText}>Loading who could stand in for you…</p>;
        }

        if (reviewers.length === 0) {
          return (
            <Banner tone="warn">
              Nobody else holds the publish grant to stand in for you. Ask an admin to
              grant it to someone before you can submit this.
            </Banner>
          );
        }

        return (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (substituteId === "") return;
              submitDraft.mutate(substituteId, {
                onError: onWriteError,
                onSuccess: close,
              });
            }}
          >
            {error !== null && (
              <Banner tone="error" role="alert" className="mt-0">
                {error}
              </Banner>
            )}

            <Field label="Who reviews in your place?" htmlFor={selectId}>
              <select
                id={selectId}
                className={nativeSelectClassName}
                value={substituteId}
                required
                {...(submitDraft.isPending ? { disabled: true } : {})}
                onChange={(event) => setSubstituteId(event.target.value)}
              >
                <option value="" disabled>
                  Choose a reviewer
                </option>
                {reviewers.map((reviewer) => (
                  <option key={reviewer.id} value={reviewer.id}>
                    {reviewer.email}
                  </option>
                ))}
              </select>
            </Field>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                loading={submitDraft.isPending}
                disabled={substituteId === ""}
              >
                Submit for review
              </Button>
            </div>
          </form>
        );
      }}
    </EditorDialog>
  );
}
