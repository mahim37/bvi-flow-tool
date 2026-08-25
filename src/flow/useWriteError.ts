import { useCallback } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/useAuth";

/**
 * What to do with a failed write, in one place.
 *
 * A dead session has to end at the sign-in screen, and a permission
 * refusal has to be remembered so the controls stop inviting it -- but a
 * failed CSRF check is neither, and mistaking it for "you may not edit"
 * would tell somebody their account lacks a permission it holds.
 */
export function useWriteErrorHandler(): (error: unknown) => void {
  const { noteApiError, noteEditRefused } = useAuth();
  return useCallback(
    (error: unknown) => {
      noteApiError(error);
      if (
        error instanceof ApiError &&
        error.isForbidden &&
        !error.isCsrfFailure &&
        !error.isUnauthenticated
      ) {
        noteEditRefused();
      }
    },
    [noteApiError, noteEditRefused],
  );
}

/** The message to show beside the control that failed. */
export function writeErrorMessage(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  if (error instanceof ApiError) {
    const holder = error.lockHolder;
    if (holder !== null) {
      // `DraftLockedError` already says who; repeating the email here
      // saves the reader a trip to the banner to find out who to ask.
      return `${error.message} (${holder.email})`;
    }
    return error.message;
  }
  return "Could not reach the server.";
}

/**
 * The same, for approve, reject and publish.
 *
 * A separate handler rather than a flag on the one above, because the
 * refusal it records is about a different grant. It is only ever wired to
 * a control the author is not shown -- `editing.approve` refuses a
 * self-review with a 403 of its own, and mistaking that for a missing
 * grant would tell somebody their account lacks a permission it holds.
 */
export function useReviewErrorHandler(): (error: unknown) => void {
  const { noteApiError, noteReviewRefused } = useAuth();
  return useCallback(
    (error: unknown) => {
      noteApiError(error);
      if (
        error instanceof ApiError &&
        error.isForbidden &&
        !error.isCsrfFailure &&
        !error.isUnauthenticated
      ) {
        noteReviewRefused();
      }
    },
    [noteApiError, noteReviewRefused],
  );
}
