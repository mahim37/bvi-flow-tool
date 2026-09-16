import {
  EDIT_FLOW_TOOL,
  type ChangeRequest,
  type ChangeRequestStatus,
} from "../api/types";

export type DraftChromeState = "open" | "locked" | "under_review" | "discarded";

export type CanvasCursorRole = "Editor" | "Reviewer" | "Viewer";

const STATUS_RANK: Record<ChangeRequestStatus, number> = {
  open: 1,
  submitted: 2,
  approved: 3,
  published: 4,
};

export function sameEmail(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return left != null && right != null && left.toLowerCase() === right.toLowerCase();
}

export function isNamedReviewer(
  proposal:
    | {
        reviewer_1_email: string | null;
        reviewer_2_email: string | null;
      }
    | null
    | undefined,
  email: string | null | undefined,
): boolean {
  if (proposal == null || email == null) return false;
  return (
    sameEmail(proposal.reviewer_1_email, email) ||
    sameEmail(proposal.reviewer_2_email, email)
  );
}

/** Frozen for review: `submit` sets `submitted`, first approval sets
 * `approved`. Both still `is_draft` until publish. `submitted_at` and a
 * named reviewer are the same round -- used when status alone still
 * reads `open`. Idle leftover locks do not count; `submit` clears the
 * lock. */
export function isUnderReview(
  status: ChangeRequestStatus | null | undefined,
  extras?: {
    submittedAt?: string | null | undefined;
    reviewerId?: string | null | undefined;
    reviewerEmail?: string | null | undefined;
  },
): boolean {
  if (status === "published") return false;
  if (status === "submitted" || status === "approved") return true;
  if (extras?.submittedAt) return true;
  if (extras?.reviewerId) return true;
  if (extras?.reviewerEmail) return true;
  return false;
}

/** Fields `submit` stamps on the proposal, for `isUnderReview` when
 * `status` still reads `open`. */
export function reviewRoundFrom(
  proposal:
    | {
        submitted_at: string | null;
        reviewer_1: string | null;
        reviewer_1_email: string | null;
      }
    | null
    | undefined,
): {
  submittedAt?: string;
  reviewerId?: string;
  reviewerEmail?: string;
} {
  if (proposal == null) return {};
  return {
    ...(proposal.submitted_at ? { submittedAt: proposal.submitted_at } : {}),
    ...(proposal.reviewer_1 ? { reviewerId: proposal.reviewer_1 } : {}),
    ...(proposal.reviewer_1_email ? { reviewerEmail: proposal.reviewer_1_email } : {}),
  };
}

function reviewProgress(proposal: ChangeRequest): number {
  if (isUnderReview(proposal.status, reviewRoundFrom(proposal))) {
    return Math.max(STATUS_RANK[proposal.status], STATUS_RANK.submitted);
  }
  return STATUS_RANK[proposal.status];
}

/** The live proposal for this version, from every endpoint that serializes
 * one. `graph/` and `review/` are the same row; `proposals/?status=` is
 * the list the topbar already has a reason to fetch. Prefer the furthest
 * along copy so a stale graph cannot keep the chrome on Open after
 * submit. */
export function latestChangeRequest(
  sources: Array<ChangeRequest | null | undefined>,
): ChangeRequest | null {
  const present = sources.filter((row): row is ChangeRequest => row != null);
  if (present.length === 0) return null;
  return present.reduce((best, next) => {
    const bestRank = reviewProgress(best);
    const nextRank = reviewProgress(next);
    if (nextRank !== bestRank) return nextRank > bestRank ? next : best;
    return next.modified >= best.modified ? next : best;
  });
}

export function proposalForVersion(
  listed: { results: Array<ChangeRequest & { version?: { id: string } }> } | undefined,
  versionId: string | undefined,
): ChangeRequest | undefined {
  if (listed === undefined || versionId === undefined) return undefined;
  return listed.results.find(
    (row) => row.draft_version === versionId || row.version?.id === versionId,
  );
}

/** What the version picker badge should say. Under-review beats a leftover
 * lock. Discarded wins everything (the version is gone). */
export function draftChromeState({
  discarded,
  isDraft,
  status,
  lockedByOther,
  submittedAt,
  reviewerId,
  reviewerEmail,
  hideOpen = false,
}: {
  discarded: boolean;
  isDraft: boolean;
  status: ChangeRequestStatus | null | undefined;
  lockedByOther: boolean;
  submittedAt?: string | null;
  reviewerId?: string | null;
  reviewerEmail?: string | null;
  /** Editors do not get an Open badge -- Unlock is the chrome they need. */
  hideOpen?: boolean;
}): DraftChromeState | null {
  if (discarded) return "discarded";
  if (!isDraft) return null;
  if (isUnderReview(status, { submittedAt, reviewerId, reviewerEmail })) {
    return "under_review";
  }
  if (lockedByOther) return "locked";
  if (status === "open" && hideOpen) return null;
  if (status === "open") return "open";
  return null;
}

export const REQUIRED_REVIEWER_COUNT = 2;

/** How many of the two named reviewers have actually approved. */
export function reviewApprovalProgress(
  proposal:
    | {
        reviewer_1_approved_at: string | null;
        reviewer_2_approved_at: string | null;
      }
    | null
    | undefined,
): { approved: number; required: number } {
  let approved = 0;
  if (proposal?.reviewer_1_approved_at) approved += 1;
  if (proposal?.reviewer_2_approved_at) approved += 1;
  return { approved, required: REQUIRED_REVIEWER_COUNT };
}

export function draftChromeLabel(
  state: DraftChromeState,
  progress?: { approved: number; required: number },
): string {
  if (state === "open") return "Open";
  if (state === "locked") return "Locked";
  if (state === "under_review") {
    return progress === undefined
      ? "Under review"
      : `Under review ${progress.approved}/${progress.required}`;
  }
  return "Discarded";
}

/** This account's role on this version, from session grants plus the
 * proposal `graph/` / `review/` / `proposals/` returned.
 *
 * Reviewer only while the draft is in review *and* this account is one of
 * the two named reviewers. Editor on an open draft this account can edit:
 * they hold the lock, or nobody does yet and they hold `edit_flow_tool`
 * (the lock is first-write). Everyone else is Viewer. */
export function canvasCursorRole({
  isDraft,
  status,
  lockEmail,
  identityEmail,
  permissionCodes,
  submittedAt,
  reviewerId,
  reviewerEmail,
  reviewer1Email,
  reviewer2Email,
}: {
  isDraft: boolean;
  status: ChangeRequestStatus | null | undefined;
  lockEmail: string | null | undefined;
  identityEmail: string | null | undefined;
  permissionCodes?: readonly string[] | undefined;
  submittedAt?: string | null | undefined;
  reviewerId?: string | null | undefined;
  reviewerEmail?: string | null | undefined;
  reviewer1Email?: string | null | undefined;
  reviewer2Email?: string | null | undefined;
}): CanvasCursorRole {
  if (isDraft && isUnderReview(status, { submittedAt, reviewerId, reviewerEmail })) {
    return isNamedReviewer(
      {
        reviewer_1_email: reviewer1Email ?? reviewerEmail ?? null,
        reviewer_2_email: reviewer2Email ?? null,
      },
      identityEmail,
    )
      ? "Reviewer"
      : "Viewer";
  }
  const holdsLock = sameEmail(lockEmail, identityEmail);
  if (isDraft && status === "open" && holdsLock) return "Editor";
  if (
    isDraft &&
    status === "open" &&
    lockEmail == null &&
    permissionCodes?.includes(EDIT_FLOW_TOOL) === true
  ) {
    return "Editor";
  }
  return "Viewer";
}
