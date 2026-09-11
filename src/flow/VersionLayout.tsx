import { useEffect, useMemo } from "react";
import { LogOut } from "lucide-react";
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
import croppedLogo from "../assets/predmind-logo - cropped.webp";
import { useAuth } from "../auth/useAuth";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { LoadingStatus } from "@/components/ui/loading";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { AlertsButton } from "./AlertsButton";
import type { ChromeAlert } from "./AlertsButton";
import { CreateProductDialog } from "./CreateProductDialog";
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

/** Same wrapper attributes as Sidebar's `Chevron`/`BadgeIcon` -- a real
 * icon instead of a "↗" glyph, which renders at a different weight per
 * font/platform. */
function ExternalLinkIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </svg>
  );
}

function versionOptionLabel(version: VersionListItem): string {
  const state = version.is_active
    ? " (latest)"
    : version.is_draft
      ? version.is_stale
        ? " (draft, behind latest)"
        : " (draft)"
      : "";
  return `${versionLabel(version)}${state} · ${version.question_count} questions`;
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

const toolbarSelectTrigger =
  "h-9 min-w-0 bg-card font-semibold shadow-sm data-[size=default]:h-9";

export function VersionLayout() {
  const { versionId } = useParams<{ versionId: string }>();
  const navigate = useNavigate();
  const { identity, signOut, noteApiError, editRefused, reviewRefused } = useAuth();

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

  const publishedAlerts: ChromeAlert[] = [];
  if (graphData !== undefined && !graphData.version.is_draft) {
    if (editRefused) {
      publishedAlerts.push({
        id: "edit-refused",
        tone: "warn",
        children: "Your account can view the flow tool but not propose changes.",
      });
    }
    if (reviewRefused) {
      publishedAlerts.push({
        id: "review-refused",
        tone: "warn",
        children: graphData.version.is_active
          ? "Your account can view the flow tool but not create a product from it."
          : "Your account can view the flow tool but not create a product or activate a version.",
      });
    }
  }

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
      <main className="mx-auto flex min-h-svh max-w-[520px] flex-col items-center justify-center gap-2.5 bg-background p-6 text-center">
        <h1 className="m-0 text-xl font-extrabold tracking-tight">
          No access to the flow tool
        </h1>
        <p className="text-muted-foreground m-0">
          {identity?.email ?? "This account"} is signed in but does not have the
          questionnaire flow-tool permission. It is granted per user, so holding an
          administrator role does not confer it.
        </p>
        <Button onClick={() => void signOut()}>Sign out</Button>
      </main>
    );
  }

  return (
    <div className="flex h-svh min-h-0 flex-col overflow-hidden bg-background">
      <div className="shrink-0 border-b border-border bg-background">
        <header className="flex h-14 items-center gap-3 px-4">
          <div className="flex shrink-0 items-center gap-2.5">
            <img className="block h-7 w-auto" src={croppedLogo} alt="" />
            <h1 className="m-0 text-[15px] font-semibold tracking-[0.2px] whitespace-nowrap">
              Flow Tool
            </h1>
          </div>

          {questionnaires.length > 1 && effectiveQuestionnaireId !== null && (
            <Select
              value={effectiveQuestionnaireId}
              onValueChange={(next) => setSearchParams({ questionnaire: next })}
            >
              <SelectTrigger
                aria-label="Questionnaire"
                className={`${toolbarSelectTrigger} max-w-[220px]`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start" position="popper" className="min-w-56">
                {questionnaires.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select
            value={versionId ?? ""}
            onValueChange={(next) => navigate(`/versions/${next}`)}
            {...(versions.isPending ? { disabled: true } : {})}
          >
            <SelectTrigger
              aria-label="Version"
              className={`${toolbarSelectTrigger} max-w-[min(100%,420px)] flex-1`}
            >
              <SelectValue placeholder="Choose a version" />
            </SelectTrigger>
            <SelectContent align="start" position="popper" className="min-w-80">
              {grouped.map(([id, group]) => (
                <SelectGroup key={id}>
                  <SelectLabel>
                    {questionnaireGroupLabel(group, versionQuestionnaireName)}
                  </SelectLabel>
                  {group.versions.map((version) => (
                    <SelectItem key={version.id} value={version.id}>
                      {versionOptionLabel(version)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>

          {graphData !== undefined && graphData.version.is_draft === false && (
            <div className="flex shrink-0 items-center gap-2">
              <AlertsButton items={publishedAlerts} />
              <CreateProductDialog
                versionId={graphData.version.id}
                disabled={reviewRefused}
                onCreated={(next) => navigate(`/versions/${next}`)}
              />
              {graphData.version.is_active && (
                <Button
                  asChild
                  className="border-transparent bg-[var(--accent-2)] text-white hover:bg-[var(--accent-2)]/90"
                >
                  <a
                    href="https://bvi-product-preview.vercel.app/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Product preview
                    <ExternalLinkIcon />
                  </a>
                </Button>
              )}
            </div>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-2.5">
            <span className="text-muted-foreground text-[0.85rem] whitespace-nowrap">
              {identity?.email}
            </span>
            <Separator orientation="vertical" className="h-5" />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void signOut()}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut />
            </Button>
          </div>
        </header>

        {versions.isError &&
          !(versionsError instanceof ApiError && versionsError.isForbidden) && (
            <Banner tone="error" role="alert" className="mx-4 mt-0 mb-2">
              {versionsError instanceof Error
                ? versionsError.message
                : "Could not load versions."}
            </Banner>
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
            <Banner tone="error" role="alert" className="mx-4 mt-0 mb-2">
              This version no longer exists. It is most likely a draft that has since
              been discarded. <Link to="/">Go to the latest version</Link>.
            </Banner>
          ) : (
            <Banner tone="error" role="alert" className="mx-4 mt-0 mb-2">
              {graph.error instanceof ApiError && graph.error.isConflict
                ? // A sequence-routed version has no edges at all, so there is
                  // nothing to draw. The API refuses rather than serving an
                  // empty map, and repeating its reasoning here is more use
                  // than a bare "409".
                  graph.error.message
                : graph.error instanceof Error
                  ? graph.error.message
                  : "Could not load this version."}
            </Banner>
          ))}

        {graph.data !== undefined && (
          <DraftBar
            graph={graph.data}
            versions={versions.data ?? []}
            onOpenVersion={(next) =>
              navigate(next === null ? "/" : `/versions/${next}`)
            }
          />
        )}
      </div>

      {graph.isPending && versionId !== undefined && (
        <LoadingStatus centered>Loading the map…</LoadingStatus>
      )}

      {graph.data !== undefined && (
        <Outlet
          context={
            {
              graph: graph.data,
              versions: versions.data ?? [],
              editable,
            } satisfies VersionContext
          }
        />
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
      <main className="mx-auto flex min-h-svh max-w-[520px] flex-col items-center justify-center gap-2.5 bg-background p-6 text-center">
        <h1 className="m-0 text-xl font-extrabold tracking-tight">
          No access to the flow tool
        </h1>
        <p className="text-muted-foreground m-0">
          This account is signed in but does not have the questionnaire flow-tool
          permission. It is granted per user, so holding an administrator role does not
          confer it.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-[520px] flex-col items-center justify-center gap-2.5 bg-background p-6 text-center">
      {versions.isPending ? (
        <LoadingStatus>Loading versions…</LoadingStatus>
      ) : versions.data?.length === 0 ? (
        <>
          <h1 className="m-0 text-xl font-extrabold tracking-tight">
            No questionnaire versions
          </h1>
          <p className="text-muted-foreground m-0">
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
