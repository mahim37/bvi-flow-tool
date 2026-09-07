import { useEffect, useId, useMemo, useState } from "react";

import { useHistory } from "../api/queries";
import type { Graph, Question, UUID } from "../api/types";
import { useAuth } from "../auth/useAuth";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { emptyText, panelHeading } from "@/lib/chrome";
import { cn } from "@/lib/utils";
import { NO_SECTION_COLOR, sectionColorMap } from "./graphElements";
import { activityEventLabel, formatTimestamp } from "./labels";

interface SidebarProps {
  graph: Graph;
  selectedId: UUID | null;
  onSelectQuestion: (id: UUID) => void;
  onHighlight: (ids: readonly string[]) => void;
}

interface DiagnosticGroup {
  key: string;
  label: string;
  /** What a non-zero count means, in one line. The counts are useless
   * without it: "3 dead routes" is only actionable next to "tied to an
   * answer that isn't one of this question's options anymore". */
  meaning: string;
  questionIds: UUID[];
  /** Ids to light up on the canvas. Usually the same as `questionIds`, but
   * the edge-shaped faults highlight the edges themselves. */
  highlightIds: string[];
}

function useDiagnosticGroups(graph: Graph): DiagnosticGroup[] {
  return useMemo(() => {
    const sourceOf = new Map(graph.edges.map((edge) => [edge.id, edge.from_question]));
    const sources = (edgeIds: UUID[]) => {
      const found: UUID[] = [];
      for (const edgeId of edgeIds) {
        const source = sourceOf.get(edgeId);
        if (source !== undefined && !found.includes(source)) found.push(source);
      }
      return found;
    };
    const audit = graph.diagnostics;

    return [
      {
        key: "entry",
        label: "Entry point",
        meaning: "The question the questionnaire opens with.",
        questionIds: audit.entry_question_id === null ? [] : [audit.entry_question_id],
        highlightIds: audit.entry_question_id === null ? [] : [audit.entry_question_id],
      },
      {
        key: "decision",
        label: "Decision points",
        meaning: "Questions whose answer changes where the flow goes next.",
        questionIds: audit.decision_point_question_ids,
        highlightIds: audit.decision_point_question_ids,
      },
      {
        key: "terminal",
        label: "Can end the flow",
        meaning: "Questions after which the questionnaire can finish.",
        questionIds: audit.terminal_question_ids,
        highlightIds: audit.terminal_question_ids,
      },
      {
        key: "unreachable",
        label: "Unreachable",
        meaning: "Nothing routes here, so a respondent never sees these.",
        questionIds: audit.unreachable_question_ids,
        highlightIds: audit.unreachable_question_ids,
      },
      {
        key: "uncovered",
        label: "Uncovered answers",
        meaning:
          "A choice with no edge and no question-level fallback: picking it silently ends the flow.",
        questionIds: audit.uncovered_option_question_ids,
        highlightIds: audit.uncovered_option_question_ids,
      },
      {
        key: "dead",
        label: "Dead routes",
        meaning:
          "Tied to an answer that isn't one of this question's options anymore, so it can never happen.",
        questionIds: sources(audit.dead_edge_ids),
        highlightIds: audit.dead_edge_ids,
      },
      {
        key: "broken",
        label: "Broken routes",
        meaning:
          "Leads to a question that has been archived or removed, so it would fail instead of continuing.",
        questionIds: sources(audit.broken_edge_ids),
        highlightIds: audit.broken_edge_ids,
      },
      {
        key: "loops",
        label: "Loops",
        meaning:
          "A route that goes back into a question already on the path. Blocks publishing.",
        questionIds: sources(audit.back_edge_ids),
        highlightIds: audit.back_edge_ids,
      },
    ];
  }, [graph]);
}

function matches(question: Question, needle: string): boolean {
  const haystack = `${question.code} ${question.prompt}`.toLowerCase();
  return haystack.includes(needle);
}

/** Ported from break-backend's `.node-key-icon` (index.html ~L307-330) --
 * same wrapper attributes, same four icon paths canvasStyle.ts already
 * draws as corner badges on the canvas (`BADGE_ICON`, copied from break
 * value-for-value there too), so the legend shows the exact mark a node
 * actually carries rather than a generic stand-in shape. */
function BadgeIcon({
  kind,
}: {
  kind: "entry" | "terminal" | "branch" | "unreachable" | "added" | "changed";
}) {
  return (
    <svg
      className={cn(
        "size-[13px] shrink-0",
        kind === "added"
          ? "text-green"
          : kind === "changed"
            ? "text-gold"
            : "text-foreground/80",
      )}
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
      {kind === "entry" && (
        <>
          <path d="M5 21V3" />
          <path d="M5 4h13l-3 5 3 5H5" />
        </>
      )}
      {kind === "terminal" && <rect x="7" y="7" width="10" height="10" rx="1.5" />}
      {kind === "branch" && (
        <>
          <circle cx="12" cy="18" r="3" />
          <circle cx="6" cy="6" r="3" />
          <circle cx="18" cy="6" r="3" />
          <path d="M6 9v1a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V9" />
        </>
      )}
      {kind === "unreachable" && (
        <>
          <path d="M12 3L2 21h20L12 3z" />
          <path d="M12 10v4" />
        </>
      )}
      {kind === "added" && <path d="M12 6v12M6 12h12" strokeWidth={4} />}
      {kind === "changed" && (
        <>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </>
      )}
    </svg>
  );
}

function KeySwatch({
  kind,
}: {
  kind: "archived" | "end" | "missing" | "fault" | "dead" | "broken";
}) {
  if (kind === "dead" || kind === "broken") {
    return (
      <span
        className={
          kind === "dead"
            ? "h-0 w-4 shrink-0 border-t-2 border-dashed border-[#9a3412]"
            : "h-0 w-4 shrink-0 border-t-[3px] border-dotted border-destructive"
        }
        aria-hidden="true"
      />
    );
  }
  return (
    <span
      className={cn(
        "size-4 shrink-0 rounded-[4px]",
        kind === "archived" &&
          "border-border-strong border-2 border-dashed bg-[#f1e7d2]",
        kind === "end" && "border-muted-foreground border-2 bg-[#f1e7d2]",
        kind === "missing" && "border-2 border-dashed border-destructive bg-[#fbe2dc]",
        kind === "fault" && "border-2 border-destructive bg-card",
      )}
      aria-hidden="true"
    />
  );
}

const accordionTrigger =
  "rounded-none border-0 px-2 py-3 text-[0.75rem] font-bold tracking-[0.06em] text-muted-foreground uppercase hover:bg-transparent hover:no-underline hover:text-foreground";

const countPill =
  "text-muted-foreground rounded-full border border-border bg-background px-2 py-px text-[0.78rem] font-bold tabular-nums";

const countPillSome =
  "rounded-full border border-emphasis bg-emphasis-soft px-2 py-px text-[0.78rem] font-bold text-emphasis tabular-nums";

const sectionRow =
  "flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-transparent px-2 py-2 text-left text-[13px] font-medium font-inherit hover:bg-card";

/** Ported from break-backend's "History & snapshots" disclosure
 * (question_graph_editor/index.html#L287-301) -- minus snapshots, which has
 * no equivalent here: break's named, restorable checkpoints are a distinct
 * backend feature (`GraphPublishEvent.source_snapshot` and friends) this
 * app's API has nothing like. What's ported is the trail this app already
 * has an endpoint for (`listHistory`, unused until now) -- every edit,
 * submit, review and publish, not just the current draft's own review
 * rounds (which `ReviewView`'s "Review history" already shows). */
function HistoryPanel({ questionnaireId }: { questionnaireId: UUID }) {
  const { noteApiError } = useAuth();
  const history = useHistory({ questionnaire: questionnaireId, page_size: 20 });
  useEffect(() => {
    if (history.error) noteApiError(history.error);
  }, [history.error, noteApiError]);

  if (history.isPending) return <p className={emptyText}>Loading…</p>;
  if (history.isError)
    return <p className={emptyText}>Could not load the activity trail.</p>;

  const events = history.data.results;
  if (events.length === 0)
    return <p className={emptyText}>Nothing has happened yet.</p>;

  return (
    <ul className="mt-1 list-none p-0">
      {events.map((event) => (
        <li
          key={event.id}
          className="flex flex-col gap-0.5 border-t border-border py-1.5 first:border-t-0 first:pt-0"
        >
          <span className="font-semibold">{activityEventLabel(event.event_type)}</span>
          {event.detail !== "" && (
            <span className="text-[0.82rem] text-foreground/80">{event.detail}</span>
          )}
          <span className="text-muted-foreground text-[0.75rem]">
            {event.actor_email} · {event.version_name} ·{" "}
            {formatTimestamp(event.occurred_at)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Sidebar({
  graph,
  selectedId,
  onSelectQuestion,
  onHighlight,
}: SidebarProps) {
  const searchId = useId();
  const [search, setSearch] = useState("");
  const groups = useDiagnosticGroups(graph);

  const questionsById = useMemo(
    () => new Map(graph.questions.map((item) => [item.id, item])),
    [graph.questions],
  );

  const needle = search.trim().toLowerCase();
  const results = useMemo(
    () =>
      needle === ""
        ? []
        : graph.questions
            .filter((question) => matches(question, needle))
            .sort((left, right) => left.display_order - right.display_order),
    [graph.questions, needle],
  );

  const bySection = useMemo(() => {
    const grouped = new Map<UUID | "none", Question[]>();
    for (const question of [...graph.questions].sort(
      (left, right) => left.display_order - right.display_order,
    )) {
      const key = question.section ?? "none";
      const bucket = grouped.get(key);
      if (bucket) bucket.push(question);
      else grouped.set(key, [question]);
    }
    return grouped;
  }, [graph.questions]);

  const sections = useMemo(
    () =>
      [...graph.sections].sort(
        (left, right) => left.display_order - right.display_order,
      ),
    [graph.sections],
  );

  const unsectioned = bySection.get("none") ?? [];
  const sectionColors = useMemo(
    () => sectionColorMap(graph.sections),
    [graph.sections],
  );

  // Ported from break-backend's Sections legend (.legend/.legend-row,
  // question_graph_editor/styles.css ~L318-362) -- a flat, click-to-
  // highlight row per section rather than the per-question drill-down this
  // block used to be. Search above still reaches an arbitrary question by
  // code or text with a real focusable result list, and every Diagnostics
  // group below still drills into its own questions -- so keyboard
  // navigation to a specific question is not lost app-wide, just no longer
  // offered from this one block the way it used to be.
  const [highlightedSection, setHighlightedSection] = useState<UUID | "none" | null>(
    null,
  );
  function toggleSectionHighlight(key: UUID | "none", ids: UUID[]) {
    if (highlightedSection === key) {
      setHighlightedSection(null);
      onHighlight([]);
    } else {
      setHighlightedSection(key);
      onHighlight(ids);
    }
  }

  function questionButton(question: Question) {
    return (
      <li key={question.id}>
        <button
          type="button"
          className={cn(
            "flex w-full flex-wrap items-baseline rounded-md px-2.5 py-2 text-left text-sm",
            question.id === selectedId
              ? "bg-secondary shadow-[inset_3px_0_0_var(--primary)]"
              : "hover:bg-card",
          )}
          {...(question.id === selectedId ? { "aria-current": "true" } : {})}
          onClick={() => onSelectQuestion(question.id)}
        >
          <span className="mr-1.5 font-bold">{question.code}</span>
          <span className="text-muted-foreground text-[0.85rem]">
            {question.prompt}
          </span>
          {question.archived_at !== null && (
            <Badge tone="tag" className="ml-1.5">
              archived
            </Badge>
          )}
        </button>
      </li>
    );
  }

  return (
    <nav
      className="sidebar flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background px-3 py-4"
      aria-label="Questionnaire navigation"
    >
      <div className="shrink-0">
        <Label
          className="text-muted-foreground mb-1.5 text-[0.75rem] font-bold tracking-[0.06em] uppercase"
          htmlFor={searchId}
        >
          Search questions
        </Label>
        <Input
          id={searchId}
          type="search"
          value={search}
          placeholder="Code or prompt text"
          className="bg-card shadow-sm"
          onChange={(event) => setSearch(event.target.value)}
        />
        {needle !== "" && (
          <>
            <p className="text-muted-foreground my-1.5 text-[0.8rem]" role="status">
              {results.length} match{results.length === 1 ? "" : "es"}
            </p>
            <ul className="mt-1 list-none p-0">{results.map(questionButton)}</ul>
          </>
        )}
      </div>

      <Separator className="my-4 shrink-0" />

      {/* Sections and the three disclosures share this column. Sections
          scroll in leftover space; Diagnostics/History/legend grow in-flow
          below — not a white card and not an absolute overlay. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <section
          className="flex min-h-32 flex-1 flex-col overflow-hidden"
          aria-labelledby="sections-heading"
        >
          <h2 id="sections-heading" className={panelHeading}>
            Sections
          </h2>
          {sections.length === 0 && unsectioned.length === 0 && (
            <p className={emptyText}>This version has no questions.</p>
          )}
          <ul className="min-h-0 flex-1 list-none overflow-y-auto p-0 pr-1">
            {sections.map((section, index) => (
              <li key={section.id}>
                <button
                  type="button"
                  className={cn(
                    sectionRow,
                    highlightedSection === section.id &&
                      "border-border-strong bg-card shadow-sm",
                  )}
                  aria-pressed={highlightedSection === section.id}
                  onClick={() =>
                    toggleSectionHighlight(
                      section.id,
                      (bySection.get(section.id) ?? []).map((question) => question.id),
                    )
                  }
                >
                  <span className="flex min-w-0 flex-1 items-center text-left">
                    <span
                      className="mr-2.5 inline-block size-3 shrink-0 rounded-[4px] ring-1 ring-black/10"
                      style={{
                        background: sectionColors.get(section.id) ?? NO_SECTION_COLOR,
                      }}
                      aria-hidden="true"
                    />
                    <span className="truncate">
                      {index + 1}. {section.name}
                    </span>
                  </span>
                  <Badge tone="neutral" className="tabular-nums">
                    {section.live_question_count}
                  </Badge>
                </button>
              </li>
            ))}
            {unsectioned.length > 0 && (
              <li>
                <button
                  type="button"
                  className={cn(
                    sectionRow,
                    highlightedSection === "none" &&
                      "border-border-strong bg-card shadow-sm",
                  )}
                  aria-pressed={highlightedSection === "none"}
                  onClick={() =>
                    toggleSectionHighlight(
                      "none",
                      unsectioned.map((question) => question.id),
                    )
                  }
                >
                  <span className="flex min-w-0 flex-1 items-center text-left">
                    <span
                      className="mr-2.5 inline-block size-3 shrink-0 rounded-[4px] ring-1 ring-black/10"
                      style={{ background: NO_SECTION_COLOR }}
                      aria-hidden="true"
                    />
                    No section
                  </span>
                  <Badge tone="neutral" className="tabular-nums">
                    {unsectioned.length}
                  </Badge>
                </button>
              </li>
            )}
          </ul>
        </section>

        <Separator className="mt-1 shrink-0" />

        <Accordion
          type="multiple"
          className="min-h-0 max-h-[50%] shrink-0 overflow-y-auto"
        >
          <AccordionItem value="diagnostics">
            <AccordionTrigger className={accordionTrigger}>
              Diagnostics
            </AccordionTrigger>
            <AccordionContent className="pb-2">
              <Accordion
                type="multiple"
                onValueChange={(open) => {
                  const keys = Array.isArray(open) ? open : [open];
                  const last = keys.at(-1);
                  const group = groups.find((item) => item.key === last);
                  onHighlight(group?.highlightIds ?? []);
                }}
              >
                {groups.map((group) => {
                  const count =
                    group.key === "dead" ||
                    group.key === "broken" ||
                    group.key === "loops"
                      ? group.highlightIds.length
                      : group.questionIds.length;
                  return (
                    <AccordionItem key={group.key} value={group.key}>
                      <AccordionTrigger className="rounded-md border-0 py-1.5 text-sm font-semibold hover:bg-transparent hover:no-underline">
                        <span className="min-w-0 flex-1 text-left">{group.label}</span>
                        <span className={count > 0 ? countPillSome : countPill}>
                          {count}
                        </span>
                      </AccordionTrigger>
                      <AccordionContent>
                        <p className="text-muted-foreground mx-1 mb-2 text-[0.8rem]">
                          {group.meaning}
                        </p>
                        {group.questionIds.length === 0 ? (
                          <p className={emptyText}>None.</p>
                        ) : (
                          <ul className="mt-1 list-none p-0">
                            {group.questionIds
                              .map((id) => questionsById.get(id))
                              .filter(
                                (question): question is Question =>
                                  question !== undefined,
                              )
                              .map(questionButton)}
                          </ul>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="history">
            <AccordionTrigger className={accordionTrigger}>History</AccordionTrigger>
            <AccordionContent>
              <HistoryPanel questionnaireId={graph.version.questionnaire} />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="legend" className="border-b-0">
            <AccordionTrigger className={accordionTrigger}>
              What do the colors mean?
            </AccordionTrigger>
            <AccordionContent>
              <ul className="flex list-none flex-col gap-2.5 p-0">
                <li className="flex items-center gap-2.5 text-[0.78rem] leading-snug text-foreground/80">
                  <b>Border color</b> — the question's section
                </li>
                <li className="flex items-center gap-2.5 text-[0.78rem] leading-snug text-foreground/80">
                  <BadgeIcon kind="added" />
                  Added by this draft, not yet published (corner badge, green tint)
                </li>
                <li className="flex items-center gap-2.5 text-[0.78rem] leading-snug text-foreground/80">
                  <BadgeIcon kind="changed" />
                  Changed by this draft, not yet published (corner badge, gold tint)
                </li>
                <li className="flex items-center gap-2.5 text-[0.78rem] leading-snug text-foreground/80">
                  <BadgeIcon kind="entry" />
                  Entry point (corner badge)
                </li>
                <li className="flex items-center gap-2.5 text-[0.78rem] leading-snug text-foreground/80">
                  <BadgeIcon kind="terminal" />
                  Can end the flow (corner badge)
                </li>
                <li className="flex items-center gap-2.5 text-[0.78rem] leading-snug text-foreground/80">
                  <BadgeIcon kind="branch" />
                  Decision point — different next question per answer (corner badge)
                </li>
                <li className="flex items-center gap-2.5 text-[0.78rem] leading-snug text-foreground/80">
                  <BadgeIcon kind="unreachable" />
                  Unreachable — no path currently leads here (corner badge)
                </li>
                <li className="flex items-center gap-2.5 text-[0.78rem] leading-snug text-foreground/80">
                  <KeySwatch kind="archived" />
                  Archived — kept on the map only because something still points at it
                </li>
                <li className="flex items-center gap-2.5 text-[0.78rem] leading-snug text-foreground/80">
                  <KeySwatch kind="end" />
                  End of flow — the shared destination every "flow ends here" edge
                  points at
                </li>
                <li className="flex items-center gap-2.5 text-[0.78rem] leading-snug text-foreground/80">
                  <KeySwatch kind="missing" />
                  Missing — an edge points at a question this version does not contain
                </li>
                <li className="flex items-center gap-2.5 text-[0.78rem] leading-snug text-foreground/80">
                  <KeySwatch kind="fault" />
                  Red border — this question has a dead or broken route leaving it
                </li>
                <li className="flex items-center gap-2.5 text-[0.78rem] leading-snug text-foreground/80">
                  <KeySwatch kind="dead" />
                  Dashed arrow — dead route, tied to an answer this question doesn't
                  offer anymore
                </li>
                <li className="flex items-center gap-2.5 text-[0.78rem] leading-snug text-foreground/80">
                  <KeySwatch kind="broken" />
                  Dotted arrow — broken route, leads to a question that's archived or
                  removed
                </li>
              </ul>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </nav>
  );
}
