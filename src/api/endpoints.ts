import { request } from "./client";
import type {
  ChangeRequest,
  Edge,
  Graph,
  StaffIdentity,
  UUID,
  VersionListItem,
} from "./types";

const FLOW_TOOL = "/api/staff/flow-tool";
const STAFF_AUTH = "/api/staff/auth";

/** Every write verb is nested under its version, matching
 * `questionnaires/api/flow_tool/urls.py` -- the version id is what the
 * "is this a draft, and may you edit it" check reads, so it is in the path
 * rather than re-derived. */
const version = (versionId: UUID) => `${FLOW_TOOL}/versions/${versionId}`;

export const login = (email: string, password: string) =>
  request<StaffIdentity>(`${STAFF_AUTH}/login/`, {
    method: "POST",
    body: { email, password },
  });

export const logout = () => request<void>(`${STAFF_AUTH}/logout/`, { method: "POST" });

export const listVersions = (signal?: AbortSignal) =>
  request<VersionListItem[]>(`${FLOW_TOOL}/versions/`, signal ? { signal } : {});

export const fetchGraph = (versionId: UUID, signal?: AbortSignal) =>
  request<Graph>(`${version(versionId)}/graph/`, signal ? { signal } : {});

export const createDraft = (versionId: UUID, label: string, summary: string) =>
  request<ChangeRequest>(`${version(versionId)}/draft/`, {
    method: "POST",
    body: { label, summary },
  });

export const discardDraft = (versionId: UUID) =>
  request<void>(`${version(versionId)}/`, { method: "DELETE" });

export interface NewEdge {
  from_question: UUID;
  from_option: UUID | null;
  to_question: UUID | null;
}

export const addEdge = (versionId: UUID, edge: NewEdge) =>
  request<Edge>(`${version(versionId)}/edges/`, { method: "POST", body: edge });

/**
 * Retarget one end of an existing arrow.
 *
 * `changes` is deliberately a partial: `FlowToolEdgeUpdateSerializer` has
 * no defaults, so an absent key means "leave this alone" while an explicit
 * `null` is a real edit -- clearing `from_option` promotes the edge to the
 * question-level fallback, clearing `to_question` makes it end the flow.
 * Spreading a full object with undefined values here would erase that
 * distinction before it ever reached the server.
 */
export const updateEdge = (
  versionId: UUID,
  edgeId: UUID,
  changes: Partial<Pick<Edge, "from_option" | "to_question">>,
) =>
  request<Edge>(`${version(versionId)}/edges/${edgeId}/`, {
    method: "PATCH",
    body: changes,
  });

export const removeEdge = (versionId: UUID, edgeId: UUID) =>
  request<void>(`${version(versionId)}/edges/${edgeId}/`, { method: "DELETE" });

/** The whole ordering at once. There is no per-edge priority write: a
 * single-edge change is a swap, and the unique index is checked per row, so
 * a client-orchestrated swap fails halfway. */
export const reorderEdges = (versionId: UUID, questionId: UUID, edgeIds: UUID[]) =>
  request<Edge[]>(`${version(versionId)}/questions/${questionId}/edge-order/`, {
    method: "PUT",
    body: { edge_ids: edgeIds },
  });

export const submitDraft = (versionId: UUID) =>
  request<ChangeRequest>(`${version(versionId)}/submit/`, { method: "POST" });

export const withdrawDraft = (versionId: UUID) =>
  request<ChangeRequest>(`${version(versionId)}/withdraw/`, { method: "POST" });

/**
 * Give the draft back early.
 *
 * Release only, and that is the whole lock API. Nothing here *takes* the
 * lock: it is taken by the first edit and by nothing else, which is what
 * keeps spec 4.7's lock-on-first-edit from decaying into lock-on-open the
 * moment a client calls an acquire verb on mount. There is no endpoint to
 * call even if this app wanted to.
 */
export const releaseLock = (versionId: UUID) =>
  request<ChangeRequest>(`${version(versionId)}/lock/`, { method: "DELETE" });
