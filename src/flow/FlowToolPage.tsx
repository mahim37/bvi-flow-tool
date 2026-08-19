import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ApiError } from "../api/client";
import { useGraph, useVersions } from "../api/queries";
import type { UUID } from "../api/types";
import { useAuth } from "../auth/useAuth";
import { Canvas } from "./Canvas";
import { DetailPanel } from "./DetailPanel";
import { DraftBar } from "./DraftBar";
import { Sidebar } from "./Sidebar";
import { buildElements, isSyntheticNode } from "./graphElements";

export function FlowToolPage() {
  const { versionId } = useParams<{ versionId: string }>();
  const navigate = useNavigate();
  const { identity, signOut, noteApiError } = useAuth();

  const versions = useVersions();
  const graph = useGraph(versionId ?? null);

  const [selectedQuestionId, setSelectedQuestionId] = useState<UUID | null>(null);
  const [highlightedIds, setHighlightedIds] = useState<readonly string[]>([]);

  useEffect(() => {
    if (versions.error) noteApiError(versions.error);
  }, [versions.error, noteApiError]);
  useEffect(() => {
    if (graph.error) noteApiError(graph.error);
  }, [graph.error, noteApiError]);

  // Land somewhere useful rather than on an empty frame. The list is
  // ordered active first, so the first row is the version somebody is
  // almost always looking for.
  const firstVersionId = versions.data?.[0]?.id;
  useEffect(() => {
    if (versionId === undefined && firstVersionId !== undefined) {
      navigate(`/versions/${firstVersionId}`, { replace: true });
    }
  }, [versionId, firstVersionId, navigate]);

  useEffect(() => {
    setSelectedQuestionId(null);
    setHighlightedIds([]);
  }, [versionId]);

  const elements = useMemo(
    () => (graph.data ? buildElements(graph.data) : []),
    [graph.data],
  );

  const selectedQuestion = useMemo(() => {
    if (graph.data === undefined || selectedQuestionId === null) return null;
    return (
      graph.data.questions.find((question) => question.id === selectedQuestionId) ??
      null
    );
  }, [graph.data, selectedQuestionId]);

  const versionsError = versions.error;
  if (versionsError instanceof ApiError && versionsError.isForbidden) {
    // Signing in again will not help: the account is authenticated and
    // simply does not hold `view_flow_tool`, which is granted per user and
    // never through a role. Saying so beats an endless login loop.
    return (
      <main className="gate">
        <h1>No access to the flow tool</h1>
        <p>
          {identity?.email ?? "This account"} is signed in but does not have the
          questionnaire flow-tool permission. It is granted per user, so holding an
          administrator role does not confer it.
        </p>
        <button className="button" type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </main>
    );
  }

  const selectedVersion = versions.data?.find((item) => item.id === versionId);

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="topbar__title">Questionnaire flow tool</h1>

        <label className="topbar__picker">
          <span className="sr-only">Version</span>
          <select
            value={versionId ?? ""}
            onChange={(event) => navigate(`/versions/${event.target.value}`)}
            disabled={versions.isPending}
          >
            {versions.data?.map((version) => (
              <option key={version.id} value={version.id}>
                {version.label || version.name}
                {version.is_active ? " (live)" : version.is_draft ? " (draft)" : ""}
                {` — ${version.question_count} questions`}
              </option>
            ))}
          </select>
        </label>

        <div className="topbar__identity">
          <span>{identity?.email}</span>
          <button
            className="button button--quiet"
            type="button"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      </header>

      {versions.isError &&
        !(versionsError instanceof ApiError && versionsError.isForbidden) && (
          <p className="banner banner--error" role="alert">
            {versionsError instanceof Error
              ? versionsError.message
              : "Could not load versions."}
          </p>
        )}

      {graph.isPending && versionId !== undefined && (
        <p className="banner banner--info">Loading the map…</p>
      )}

      {graph.isError && (
        <p className="banner banner--error" role="alert">
          {graph.error instanceof ApiError && graph.error.isConflict
            ? // A sequence-routed version has no edges at all, so there is
              // nothing to draw. The API refuses rather than serving an
              // empty map, and repeating its reasoning here is more use
              // than a bare "409".
              graph.error.message
            : graph.error instanceof Error
              ? graph.error.message
              : "Could not load this version."}
        </p>
      )}

      {graph.data !== undefined && (
        <>
          <DraftBar
            graph={graph.data}
            onOpenVersion={(next) => navigate(`/versions/${next}`)}
          />
          <div className="layout">
            <Sidebar
              graph={graph.data}
              selectedId={selectedQuestionId}
              onSelectQuestion={setSelectedQuestionId}
              onHighlight={setHighlightedIds}
            />
            <Canvas
              elements={elements}
              selectedId={selectedQuestionId}
              highlightedIds={highlightedIds}
              onSelectNode={(id) =>
                // Synthetic nodes -- the shared end-of-flow tag, a target
                // this version does not contain -- are not questions, so
                // there is no detail to show for them.
                setSelectedQuestionId(id !== null && !isSyntheticNode(id) ? id : null)
              }
              onSelectEdge={(edgeId) => {
                const edge = graph.data.edges.find(
                  (candidate) => candidate.id === edgeId,
                );
                if (edge) setSelectedQuestionId(edge.from_question);
              }}
            />
            <DetailPanel
              graph={graph.data}
              question={selectedQuestion}
              editable={
                graph.data.version.is_draft &&
                graph.data.change_request?.status === "open"
              }
              onSelectQuestion={setSelectedQuestionId}
            />
          </div>
        </>
      )}

      {selectedVersion !== undefined &&
        selectedVersion.routing_model === "sequence" && (
          <p className="banner banner--warn">
            This version routes by question order, not by edges, so it has no map. Only
            graph-routed versions can be shown here.
          </p>
        )}
    </div>
  );
}
