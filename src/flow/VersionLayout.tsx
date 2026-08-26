import { useEffect, useMemo } from "react";
import {
  Link,
  Outlet,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";

import { ApiError } from "../api/client";
import { useGraph, useVersions } from "../api/queries";
import type { UUID, VersionListItem } from "../api/types";
import { useAuth } from "../auth/useAuth";
import { AddQuestion } from "./AddQuestion";
import { DraftBar } from "./DraftBar";
import { versionLabel } from "./labels";
import { SectionEditor } from "./SectionEditor";
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

/** The picker's only view of a spawned product's lineage (phase 10):
 * every version in a group carries the same
 * `questionnaire_spawned_from_version`, so the first one answers for the
 * whole group. `versionQuestionnaireName` is keyed by version id because
 * that is the unit `questionnaire_spawned_from_version` names -- the
 * questionnaire itself carries no separate list to look it up in. */
function questionnaireGroupLabel(
  group: { name: string; versions: VersionListItem[] },
  versionQuestionnaireName: ReadonlyMap<UUID, string>,
): string {
  const spawnedFrom = group.versions[0]?.questionnaire_spawned_from_version;
  if (spawnedFrom === null || spawnedFrom === undefined) return group.name;
  const parentName = versionQuestionnaireName.get(spawnedFrom);
  return parentName === undefined ? group.name : `${group.name} (from ${parentName})`;
}

export function VersionLayout() {
  const { versionId } = useParams<{ versionId: string }>();
  const navigate = useNavigate();
  const { identity, signOut, noteApiError } = useAuth();

  // The filter lives in the URL rather than in state, so a link to a
  // narrowed picker survives a reload and can be shared.
  const [searchParams, setSearchParams] = useSearchParams();
  const questionnaireId = searchParams.get("questionnaire");

  const graph = useGraph(versionId ?? null);
  // A plain local rather than repeated `graph.data` reads: TypeScript
  // narrows a `const` across the closures below, which it will not do for
  // a query object's property, re-evaluated on every access. Computed
  // here (rather than where it used to sit, further down) because the
  // questionnaire filter below needs it too.
  const graphData = graph.data;

  // No explicit `?questionnaire=` is not "show every product merged
  // together" -- it defaults to whichever product the version actually
  // open right now belongs to, so the picker and the version list always
  // agree on one product. Seeing a different product's versions takes an
  // explicit pick, never an "All questionnaires" fallback.
  const effectiveQuestionnaireId =
    questionnaireId ?? graphData?.version.questionnaire ?? null;

  const versions = useVersions(effectiveQuestionnaireId);

  // Picking a questionnaire in `topbar__picker` only ever changed which
  // product the *version* select's own options belonged to -- the page
  // itself stayed on whatever version was already loaded, which wasn't
  // even one of those options anymore, so the picker looked like it did
  // nothing. Land on that product's own top version, same "active first"
  // ordering `VersionLanding` already relies on, the moment the fetched
  // list stops containing the version currently on screen.
  const firstOfFilteredVersionId = versions.data?.[0]?.id;
  useEffect(() => {
    if (versions.data === undefined) return;
    if (versions.data.some((version) => version.id === versionId)) return;
    if (firstOfFilteredVersionId !== undefined) {
      navigate(`/versions/${firstOfFilteredVersionId}`, { replace: true });
    }
  }, [versions.data, firstOfFilteredVersionId, versionId, navigate]);

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

  // Keyed by version id, not questionnaire id: `questionnaire_spawned_from_version`
  // names the specific version a product forked from, and that is the
  // only handle this payload gives it.
  const versionQuestionnaireName = useMemo(() => {
    const map = new Map<UUID, string>();
    for (const version of allVersions.data ?? []) {
      map.set(version.id, version.questionnaire_name);
    }
    return map;
  }, [allVersions.data]);

  const grouped = useMemo(
    () => groupByQuestionnaire(versions.data ?? []),
    [versions.data],
  );

  const editable =
    graphData !== undefined &&
    graphData.version.is_draft &&
    graphData.change_request?.status === "open";

  const versionsError = versions.error;
  // `!isUnauthenticated`: an expired/invalid session answers this same
  // 403, and showing "you don't have permission" for that would be
  // actively misleading -- the fix is signing in again, not asking an
  // admin for a grant. `noteApiError` above (called on every render via
  // the earlier effect) already clears identity for that case, which
  // swaps the whole tree to the sign-in screen; this just avoids painting
  // the wrong message for the one render in between.
  if (
    versionsError instanceof ApiError &&
    versionsError.isForbidden &&
    !versionsError.isUnauthenticated
  ) {
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

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <h1 className="topbar__title">Questionnaire flow tool</h1>
          {/* Ported from break-backend's #viewSub subtitle line -- named
              from the version actually loaded rather than a fixed string,
              since (unlike break) this tool serves more than one product. */}
          {graphData !== undefined && (
            <p className="topbar__subtitle">
              {graphData.version.questionnaire_name} ·{" "}
              {graphData.version.is_draft ? "draft" : "live"}
            </p>
          )}
        </div>

        {graphData !== undefined && (
          // Ported from break-backend's .stats pills (#stats) -- question
          // count at a glance without opening the sidebar or a tab. The
          // "N pending" pill that used to sit beside this counted
          // proposals across the whole product, not this version, which
          // read as "stuck" once the one open here was dealt with --
          // dropped rather than relabelled.
          <div className="topbar__stats">
            <div className="stat">
              <b>{graphData.questions.length}</b>
              <span>Questions</span>
            </div>
          </div>
        )}

        {/* No "All questionnaires" option -- every render of this select
            has a real product selected (`effectiveQuestionnaireId`), so
            there's nothing to render until that resolves (a beat, while
            the graph for the version in the URL is still loading). */}
        {questionnaires.length > 1 && effectiveQuestionnaireId !== null && (
          <label className="topbar__picker">
            <span className="sr-only">Questionnaire</span>
            <select
              value={effectiveQuestionnaireId}
              onChange={(event) =>
                setSearchParams({ questionnaire: event.target.value })
              }
            >
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
              <optgroup
                key={id}
                label={questionnaireGroupLabel(group, versionQuestionnaireName)}
              >
                {group.versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {versionOptionLabel(version)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        {graphData !== undefined && editable && (
          // Always reachable rather than buried in a collapsed sidebar
          // section: the version this bar names is exactly the draft these
          // verbs write to, so this is the one place both belong regardless
          // of which tab (Map/Review/Preview) is open. A jump to the new or
          // refiled question goes through `?question=`, the same URL param
          // the review screen already uses to point the map at a question --
          // no local selection state to thread down from here.
          <div className="topbar__editors">
            <AddQuestion
              graph={graphData}
              onAdded={(id) =>
                navigate(`/versions/${graphData.version.id}?question=${id}`)
              }
            />
            <SectionEditor
              graph={graphData}
              onSelectQuestion={(id) =>
                navigate(`/versions/${graphData.version.id}?question=${id}`)
              }
            />
          </div>
        )}

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

      {graph.isError &&
        (graph.error instanceof ApiError && graph.error.isNotFound ? (
          // The one case where a URL that worked a moment ago stops
          // working without anybody mistyping anything: a draft is a hard
          // delete (`editing.discard_draft`), so a tab left open on it, a
          // stale bookmark, or a link sent before somebody discarded it
          // all land here. The raw "No QuestionnaireVersion matches the
          // given query." is accurate but offers nowhere to go next --
          // this does, the same way `StaleDraftError`'s banner names an
          // actual version rather than just saying "stale."
          <p className="banner banner--error" role="alert">
            This version no longer exists — most likely a draft that has since been
            discarded. <Link to="/">Go to the latest version</Link>.
          </p>
        ) : (
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
        ))}

      {graph.data !== undefined && (
        <>
          <DraftBar
            graph={graph.data}
            versions={versions.data ?? []}
            onOpenVersion={(next) =>
              navigate(next === null ? "/" : `/versions/${next}`)
            }
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
  if (error instanceof ApiError && error.isForbidden && !error.isUnauthenticated) {
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
