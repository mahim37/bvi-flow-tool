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
      if (error instanceof ApiError && error.isForbidden && !error.isCsrfFailure) {
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
