import { useEffect, useMemo } from "react";
import {
  NavLink,
  Outlet,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";

import { ApiError } from "../api/client";
import { useGraph, useVersions } from "../api/queries";
import type { UUID, VersionListItem } from "../api/types";
import { useAuth } from "../auth/useAuth";
import { DraftBar } from "./DraftBar";
import { versionLabel } from "./labels";
import type { VersionContext } from "./versionContext";

/** Versions arrive grouped by questionnaire, so the picker keeps the
 * grouping rather than flattening it: with more than one product in the
 * table, a flat list puts one questionnaire's live version between two of
 * another's drafts. */
function groupByQuestionnaire(versions: VersionListItem[]) {
  const groups = new Map<UUID, { name: string; versions: VersionListItem[] }>();
  for (const version of versions) {
    const group = groups.get(version.questionnaire);
    if (group) group.versions.push(version);
    else
      groups.set(version.questionnaire, {
        name: version.questionnaire_name,
        versions: [version],
      });
  }
  return [...groups.entries()];
}

function versionOptionLabel(version: VersionListItem): string {
  const state = version.is_active
    ? " (live)"
    : version.is_draft
      ? version.is_stale
        ? " (draft — behind live)"
        : " (draft)"
      : "";
  return `${versionLabel(version)}${state} — ${version.question_count} questions`;
}

export function VersionLayout() {
  const { versionId } = useParams<{ versionId: string }>();
  const navigate = useNavigate();
  const { identity, signOut, noteApiError } = useAuth();

  // The filter lives in the URL rather than in state, so a link to a
  // narrowed picker survives a reload and can be shared. Empty means every
  // questionnaire, which is what the server does with the parameter absent.
  const [searchParams, setSearchParams] = useSearchParams();
  const questionnaireId = searchParams.get("questionnaire");

  const versions = useVersions(questionnaireId);
  const graph = useGraph(versionId ?? null);

  useEffect(() => {
    if (versions.error) noteApiError(versions.error);
  }, [versions.error, noteApiError]);
  useEffect(() => {
    if (graph.error) noteApiError(graph.error);
  }, [graph.error, noteApiError]);

  // Every questionnaire, taken from the unfiltered list only. Deriving the
  // options from a filtered response would leave the filter unable to be
  // widened again -- the one questionnaire left would be the only one on
  // offer.
  const allVersions = useVersions(null);
  const questionnaires = useMemo(() => {
    const seen = new Map<UUID, string>();
    for (const version of allVersions.data ?? []) {
      seen.set(version.questionnaire, version.questionnaire_name);
    }
    return [...seen.entries()].sort((left, right) => left[1].localeCompare(right[1]));
  }, [allVersions.data]);

  const grouped = useMemo(
    () => groupByQuestionnaire(versions.data ?? []),
    [versions.data],
  );

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

  const editable =
    graph.data !== undefined &&
    graph.data.version.is_draft &&
    graph.data.change_request?.status === "open";

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="topbar__title">Questionnaire flow tool</h1>

        {questionnaires.length > 1 && (
          <label className="topbar__picker">
            <span className="sr-only">Questionnaire</span>
            <select
              value={questionnaireId ?? ""}
              onChange={(event) => {
                const next = event.target.value;
                setSearchParams(next === "" ? {} : { questionnaire: next });
              }}
            >
              <option value="">All questionnaires</option>
              {questionnaires.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="topbar__picker topbar__picker--wide">
          <span className="sr-only">Version</span>
          <select
            value={versionId ?? ""}
            onChange={(event) => navigate(`/versions/${event.target.value}`)}
            disabled={versions.isPending}
          >
            {grouped.map(([id, group]) => (
              <optgroup key={id} label={group.name}>
                {group.versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {versionOptionLabel(version)}
                  </option>
                ))}
              </optgroup>
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

      {graph.data !== undefined && (
        <nav className="tabs" aria-label="Version views">
          <NavLink end to={`/versions/${versionId}`} className="tabs__tab">
            Map
          </NavLink>
          {/* Shown for a published version too, where the same diff
              answers "what did this release change" against the version
              it superseded. That is the history half of spec 4.10, and it
              needs no endpoint the review screen does not already call. */}
          <NavLink to={`/versions/${versionId}/review`} className="tabs__tab">
            {graph.data.version.is_draft ? "Review" : "What changed"}
          </NavLink>
          <NavLink to={`/versions/${versionId}/preview`} className="tabs__tab">
            Preview
          </NavLink>
        </nav>
      )}

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
          <Outlet
            context={
              {
                graph: graph.data,
                versions: versions.data ?? [],
                editable,
              } satisfies VersionContext
            }
          />
        </>
      )}
    </div>
  );
}

/**
 * Land somewhere useful rather than on an empty frame.
 *
 * The list is ordered by questionnaire, then active first, so the first
 * row is the version somebody is almost always looking for.
 */
export function VersionLanding() {
  const navigate = useNavigate();
  const versions = useVersions(null);
  const { noteApiError } = useAuth();

  useEffect(() => {
    if (versions.error) noteApiError(versions.error);
  }, [versions.error, noteApiError]);

  const firstVersionId = versions.data?.[0]?.id;
  useEffect(() => {
    if (firstVersionId !== undefined) {
      navigate(`/versions/${firstVersionId}`, { replace: true });
    }
  }, [firstVersionId, navigate]);

  const error = versions.error;
  if (error instanceof ApiError && error.isForbidden) {
    return (
      <main className="gate">
        <h1>No access to the flow tool</h1>
        <p>
          This account is signed in but does not have the questionnaire flow-tool
          permission. It is granted per user, so holding an administrator role does not
          confer it.
        </p>
      </main>
    );
  }

  return (
    <main className="gate">
      {versions.isPending ? (
        <p>Loading versions…</p>
      ) : versions.data?.length === 0 ? (
        <>
          <h1>No questionnaire versions</h1>
          <p>
            Nothing has been seeded yet, so there is no map to draw. Seed a
            questionnaire and reload.
          </p>
        </>
      ) : (
        <p role="alert">
          {error instanceof Error ? error.message : "Could not load versions."}
        </p>
      )}
    </main>
  );
}
