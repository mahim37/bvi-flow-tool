import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import * as api from "./endpoints";
import type {
  NewEdge,
  NewOption,
  NewQuestion,
  NewSection,
  QuestionChanges,
} from "./endpoints";
import { ApiError } from "./client";
import type { Edge, PreviewAnswer, QuestionOption, SectionRecord, UUID } from "./types";

/** Keyed on the questionnaire filter, because the server applies it -- two
 * filters are two different lists, not one list read twice. */
export const versionsKey = (questionnaireId?: UUID | null) =>
  ["versions", questionnaireId ?? "all"] as const;
export const graphKey = (versionId: UUID) => ["graph", versionId] as const;
export const reviewKey = (versionId: UUID) => ["review", versionId] as const;

/**
 * A refusal is an answer, not a network blip.
 *
 * 400/403/404/409 all mean the server considered the request and declined
 * it; retrying sends the identical request and gets the identical refusal,
 * so the only thing a retry buys is a slower error message. Anything else
 * (a 500, a dropped connection) is worth one more go.
 */
function retryUnlessRefused(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 2;
}

export function useVersions(questionnaireId?: UUID | null) {
  return useQuery({
    queryKey: versionsKey(questionnaireId),
    queryFn: ({ signal }) => api.listVersions(questionnaireId, signal),
    retry: retryUnlessRefused,
  });
}

/**
 * The diff, in its own query rather than folded into the map.
 *
 * Same split the server makes, for the same reason: `graph/` is read on
 * every click of the editor, and diffing two whole versions to answer a
 * question nobody asked would make the common case pay for the rare one.
 * So this is fetched only while the review screen is open.
 */
export function useReview(versionId: UUID | null) {
  return useQuery({
    queryKey: reviewKey(versionId ?? "none"),
    queryFn: ({ signal }) => api.fetchReview(versionId as UUID, signal),
    enabled: versionId !== null,
    retry: retryUnlessRefused,
  });
}

export function useGraph(versionId: UUID | null) {
  return useQuery({
    queryKey: graphKey(versionId ?? "none"),
    queryFn: ({ signal }) => api.fetchGraph(versionId as UUID, signal),
    enabled: versionId !== null,
    retry: retryUnlessRefused,
  });
}

/** How many proposals are waiting on somebody -- the topbar's "N pending"
 * count. Scoped to a questionnaire the same way the version picker is, so
 * switching products doesn't leave yesterday's count on screen. Disabled
 * with no questionnaire given rather than defaulting to "every product",
 * which the topbar has no use for and would just waste the round trip. */
export function useProposals(filters: api.ProposalFilters) {
  return useQuery({
    queryKey: ["proposals", filters] as const,
    queryFn: ({ signal }) => api.listProposals(filters, signal),
    enabled: filters.questionnaire !== null && filters.questionnaire !== undefined,
    retry: retryUnlessRefused,
  });
}

/** The activity trail behind the sidebar's History disclosure. Same table
 * the compliance audit log reads, through the flow tool's own permission --
 * see `listHistory`'s docstring in endpoints.ts. */
export function useHistory(filters: api.HistoryFilters) {
  return useQuery({
    queryKey: ["history", filters] as const,
    queryFn: ({ signal }) => api.listHistory(filters, signal),
    retry: retryUnlessRefused,
  });
}

/**
 * Every write refetches the map instead of patching it in place.
 *
 * This app must never hold a second opinion about routing. The server
 * renumbers priorities on reorder, refuses a per-option edge that sits
 * below the question-level fallback, and recomputes reachability, entry,
 * terminals and every dead/broken-edge list from the new edge set -- so an
 * optimistic update would have to reimplement `routing` and `diagnostics`
 * in TypeScript to stay honest, which is the second implementation the
 * spec's critical instruction (1.3) exists to forbid. A refetch costs one
 * round trip and cannot drift.
 *
 * The lock is the other reason: the first successful write takes it, so
 * the change request that comes back with the map is how this app learns
 * it is now the holder.
 */
function invalidateGraph(client: QueryClient, versionId: UUID) {
  return Promise.all([
    client.invalidateQueries({ queryKey: graphKey(versionId) }),
    // The diff is a function of the same edge and content rows the map is,
    // so a write that leaves one stale leaves the other stale too. A
    // review screen open beside the editor must not keep showing the diff
    // from before the edit.
    client.invalidateQueries({ queryKey: reviewKey(versionId) }),
    // Prefix, not an exact key: the picker may be filtered to one
    // questionnaire, and every cached filtering of the list is equally
    // out of date once a version is created, published or discarded.
    client.invalidateQueries({ queryKey: ["versions"] }),
  ]);
}

export function useCreateDraft() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      versionId,
      label,
      summary,
    }: {
      versionId: UUID;
      label: string;
      summary: string;
    }) => api.createDraft(versionId, label, summary),
    onSuccess: (changeRequest) =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["versions"] }),
        client.invalidateQueries({ queryKey: graphKey(changeRequest.draft_version) }),
      ]),
  });
}

export function useDiscardDraft() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (versionId: UUID) => api.discardDraft(versionId),
    onSuccess: (_result, versionId) => {
      // Removed rather than invalidated: the version it keyed on no longer
      // exists, so refetching it would only produce a 404 to render.
      //
      // Not returned/awaited, unlike every other mutation's cache work
      // here: the caller's own `onSuccess` navigates away from this
      // version next (`DraftBar`'s `onOpenVersion`), and this hook's
      // `onSuccess` runs *before* that one -- TanStack Query awaits
      // whatever a hook-level `onSuccess` returns before moving on to the
      // one passed to `mutate()`. Returning the `invalidateQueries` promise
      // would hold navigation hostage to a versions-list network round
      // trip, during which `VersionLayout`/`ReviewView` are still
      // subscribed to the two queries just removed above and would refetch
      // them -- a real request for a version that no longer exists,
      // rendering exactly the 404 this was meant to avoid. Firing it
      // without awaiting lets the navigation happen essentially
      // immediately, so nothing is left observing the removed queries by
      // the time that refetch would have landed.
      client.removeQueries({ queryKey: graphKey(versionId) });
      client.removeQueries({ queryKey: reviewKey(versionId) });
      void client.invalidateQueries({ queryKey: ["versions"] });
    },
  });
}

export function useAddEdge(versionId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (edge: NewEdge) => api.addEdge(versionId, edge),
    onSuccess: () => invalidateGraph(client, versionId),
  });
}

export function useUpdateEdge(versionId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      edgeId,
      changes,
    }: {
      edgeId: UUID;
      changes: Partial<Pick<Edge, "from_option" | "to_question">>;
    }) => api.updateEdge(versionId, edgeId, changes),
    onSuccess: () => invalidateGraph(client, versionId),
  });
}

export function useRemoveEdge(versionId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (edgeId: UUID) => api.removeEdge(versionId, edgeId),
    onSuccess: () => invalidateGraph(client, versionId),
  });
}

export function useReorderEdges(versionId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ questionId, edgeIds }: { questionId: UUID; edgeIds: UUID[] }) =>
      api.reorderEdges(versionId, questionId, edgeIds),
    onSuccess: () => invalidateGraph(client, versionId),
  });
}

/** Populates the "Submit for review" form's two reviewer pickers.
 * Unpaginated, like `useVersions`: the eligible group is a handful of
 * people, not a list that grows without bound. */
export function useReviewers() {
  return useQuery({
    queryKey: ["reviewers"] as const,
    queryFn: ({ signal }) => api.listReviewers(signal),
    retry: retryUnlessRefused,
  });
}

export function useSubmitDraft(versionId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      reviewer1Id,
      reviewer2Id,
    }: {
      reviewer1Id: UUID;
      reviewer2Id: UUID;
    }) => api.submitDraft(versionId, reviewer1Id, reviewer2Id),
    onSuccess: () => invalidateGraph(client, versionId),
  });
}

export function useWithdrawDraft(versionId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.withdrawDraft(versionId),
    onSuccess: () => invalidateGraph(client, versionId),
  });
}

export function useReleaseLock(versionId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.releaseLock(versionId),
    onSuccess: () => invalidateGraph(client, versionId),
  });
}

/* ------------------------------------------------------------------ */
/* Review and publish (phase 4).                                       */
/*                                                                     */
/* All three verbs invalidate the map as well as the diff. A review is  */
/* a state change on the proposal, and the proposal is served with the  */
/* map -- so a screen that only refreshed the diff would keep offering  */
/* "Submit for review" on something already approved.                   */
/* ------------------------------------------------------------------ */

export function useApproveDraft(versionId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (note: string) => api.approveDraft(versionId, note),
    onSuccess: () => invalidateGraph(client, versionId),
  });
}

export function useRejectDraft(versionId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (note: string) => api.rejectDraft(versionId, note),
    onSuccess: () => invalidateGraph(client, versionId),
  });
}

/**
 * Publishing invalidates every version, not just this one.
 *
 * It is the one call in the tool that changes what a respondent is asked:
 * the draft becomes live and whatever was live stops being so, which
 * re-answers `is_stale` for every other open sandbox on the same
 * questionnaire. `invalidateGraph` already drops the whole `versions`
 * prefix, and the previously-live version's own map is dropped here
 * because its `is_active` has just changed underneath it.
 */
export function usePublishDraft(versionId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.publishDraft(versionId),
    onSuccess: async () => {
      await invalidateGraph(client, versionId);
      await client.invalidateQueries({ queryKey: ["graph"] });
    },
  });
}

/**
 * Rollback, same invalidation shape as publishing above.
 *
 * It is the other call that changes what a respondent is asked -- this
 * version's `is_active` flips true and whatever was live flips false, so
 * every other open sandbox's `is_stale` has to be re-read too, not just
 * this one's graph.
 */
export function useActivateVersion(versionId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.activateVersion(versionId),
    onSuccess: async () => {
      await invalidateGraph(client, versionId);
      await client.invalidateQueries({ queryKey: ["graph"] });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Preview (phase 6).                                                  */
/* ------------------------------------------------------------------ */

/**
 * A mutation rather than a query, though it reads.
 *
 * `POST versions/<id>/preview/` stores nothing, so this is a read in every
 * sense that matters -- but the request body is the answers so far, and
 * caching a walk under a key built from a growing answer list would keep
 * every intermediate step of every branch anybody explored. The walk is
 * cheap to repeat and the answers are the state; holding them in the
 * component and re-posting is both simpler and always current, which
 * matters on a draft somebody is editing in the next tab.
 */
export function usePreviewWalk(versionId: UUID) {
  return useMutation({
    mutationFn: (answers: PreviewAnswer[]) => api.previewWalk(versionId, answers),
  });
}

/**
 * A mutation for the same reason `usePreviewWalk` is one: it reads, but
 * it is a one-off kicked off by clicking "Preview from here" and
 * consumed immediately (fed into a navigation), not state worth caching
 * under a query key.
 */
export function usePreviewPathTo(versionId: UUID) {
  return useMutation({
    mutationFn: (questionId: UUID) => api.previewPathTo(versionId, questionId),
  });
}

/* ------------------------------------------------------------------ */
/* Content editing (phase 7).                                          */
/*                                                                     */
/* Every one of these refetches the map for the reason `invalidateGraph` */
/* gives: adding a question makes it unreachable, archiving one breaks   */
/* every edge into it, and changing an answer type can kill every        */
/* per-option guard hanging off it. All three are recomputed by          */
/* `diagnostics` from the new rows, and none of them are derivable here. */
/* ------------------------------------------------------------------ */

export function useAddSection(versionId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (section: NewSection) => api.addSection(versionId, section),
    onSuccess: () => invalidateGraph(client, versionId),
  });
}

export function useUpdateSection(versionId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      sectionId,
      changes,
    }: {
      sectionId: UUID;
      changes: Partial<Omit<SectionRecord, "id">>;
    }) => api.updateSection(versionId, sectionId, changes),
    onSuccess: () => invalidateGraph(client, versionId),
  });
}

export function useRemoveSection(versionId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (sectionId: UUID) => api.removeSection(versionId, sectionId),
    onSuccess: () => invalidateGraph(client, versionId),
  });
}

export function useAddQuestion(versionId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (question: NewQuestion) => api.addQuestion(versionId, question),
    onSuccess: () => invalidateGraph(client, versionId),
  });
}

export function useUpdateQuestion(versionId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      questionId,
      changes,
    }: {
      questionId: UUID;
      changes: QuestionChanges;
    }) => api.updateQuestion(versionId, questionId, changes),
    onSuccess: () => invalidateGraph(client, versionId),
  });
}

export function useArchiveQuestion(versionId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (questionId: UUID) => api.archiveQuestion(versionId, questionId),
    onSuccess: () => invalidateGraph(client, versionId),
  });
}

export function useReorderQuestions(versionId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (questionIds: UUID[]) => api.reorderQuestions(versionId, questionIds),
    onSuccess: () => invalidateGraph(client, versionId),
  });
}

export function useAddOption(versionId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (option: NewOption) => api.addOption(versionId, option),
    onSuccess: () => invalidateGraph(client, versionId),
  });
}

export function useUpdateOption(versionId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      optionId,
      changes,
    }: {
      optionId: UUID;
      changes: Partial<Pick<QuestionOption, "code" | "label">>;
    }) => api.updateOption(versionId, optionId, changes),
    onSuccess: () => invalidateGraph(client, versionId),
  });
}

export function useRemoveOption(versionId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (optionId: UUID) => api.removeOption(versionId, optionId),
    onSuccess: () => invalidateGraph(client, versionId),
  });
}

export function useReorderOptions(versionId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ questionId, optionIds }: { questionId: UUID; optionIds: UUID[] }) =>
      api.reorderOptions(versionId, questionId, optionIds),
    onSuccess: () => invalidateGraph(client, versionId),
  });
}

/* ------------------------------------------------------------------ */
/* Product spawning (phase 10).                                        */
/* ------------------------------------------------------------------ */

/**
 * Invalidates the version list only, unlike every mutation above.
 *
 * A spawned product is a new questionnaire and a new version; it does
 * not touch the source's graph or diff, so there is nothing for
 * `invalidateGraph` to drop here -- just the picker, which now has one
 * more questionnaire to show.
 */
export function useSpawnProduct(versionId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ name, code }: { name: string; code: string }) =>
      api.spawnProduct(versionId, name, code),
    onSuccess: () => client.invalidateQueries({ queryKey: ["versions"] }),
  });
}
