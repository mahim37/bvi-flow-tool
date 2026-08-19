import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import * as api from "./endpoints";
import type { NewEdge } from "./endpoints";
import { ApiError } from "./client";
import type { Edge, UUID } from "./types";

export const versionsKey = ["versions"] as const;
export const graphKey = (versionId: UUID) => ["graph", versionId] as const;

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

export function useVersions() {
  return useQuery({
    queryKey: versionsKey,
    queryFn: ({ signal }) => api.listVersions(signal),
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
    client.invalidateQueries({ queryKey: versionsKey }),
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
        client.invalidateQueries({ queryKey: versionsKey }),
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
      client.removeQueries({ queryKey: graphKey(versionId) });
      return client.invalidateQueries({ queryKey: versionsKey });
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

export function useSubmitDraft(versionId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.submitDraft(versionId),
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
