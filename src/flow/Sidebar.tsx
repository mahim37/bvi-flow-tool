import { useEffect, useId, useMemo, useState } from "react";

import { useHistory } from "../api/queries";
import type { Graph, Question, UUID } from "../api/types";
import { useAuth } from "../auth/useAuth";
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
   * without it: "3 dead edges" is only actionable next to "guarded by an
   * option the question does not offer". */
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
        label: "Dead edges",
        meaning:
          "Guarded by an option the question does not offer, so the guard can never match.",
        questionIds: sources(audit.dead_edge_ids),
        highlightIds: audit.dead_edge_ids,
      },
      {
        key: "broken",
        label: "Broken edges",
        meaning:
          "Point at an archived or out-of-version question: the resolver raises rather than routing.",
        questionIds: sources(audit.broken_edge_ids),
        highlightIds: audit.broken_edge_ids,
      },
      {
        key: "loops",
        label: "Loops",
        meaning:
          "An edge that routes back into a question already on the path. Blocks publishing.",
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

/** Ported from break-backend's `.chevron` (index.html's disclosure-toggle
 * SVG, `<path d="M9 6l6 6-6 6" />`) in place of this app's previous
 * CSS-only `summary::before` (two rotated border edges): a real,
 * fixed-viewBox icon sits dead center in its box regardless of font
 * metrics, where the border-corner trick's visual weight drifted off the
 * cap-height of bold, uppercase summary text. */
function Chevron() {
  return (
    <svg
      className="chevron"
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** Ported from break-backend's `.node-key-icon` (index.html ~L307-330) --
 * same wrapper attributes, same four icon paths canvasStyle.ts already
 * draws as corner badges on the canvas (`BADGE_ICON`, copied from break
 * value-for-value there too), so the legend shows the exact mark a node
 * actually carries rather than a generic stand-in shape. */
function BadgeIcon({
  kind,
}: {
  kind: "entry" | "terminal" | "branch" | "unreachable";
}) {
  return (
    <svg
      className="node-key-icon"
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
    </svg>
  );
}

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

  if (history.isPending) return <p className="empty">Loading…</p>;
  if (history.isError)
    return <p className="empty">Could not load the activity trail.</p>;

  const events = history.data.results;
  if (events.length === 0) return <p className="empty">Nothing has happened yet.</p>;

  return (
    <ul className="history">
      {events.map((event) => (
        <li key={event.id}>
          <span className="history__what">{activityEventLabel(event.event_type)}</span>
          {event.detail !== "" && (
            <span className="history__detail">{event.detail}</span>
          )}
          <span className="history__by">
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
          className={
            question.id === selectedId ? "list__item list__item--active" : "list__item"
          }
          aria-current={question.id === selectedId ? "true" : undefined}
          onClick={() => onSelectQuestion(question.id)}
        >
          <span className="list__code">{question.code}</span>
          <span className="list__prompt">{question.prompt}</span>
          {question.archived_at !== null && <span className="list__tag">archived</span>}
        </button>
      </li>
    );
  }

  return (
    <nav className="sidebar" aria-label="Questionnaire navigation">
      <div className="sidebar__block">
        <label className="sidebar__label" htmlFor={searchId}>
          Search questions
        </label>
        <input
          id={searchId}
          type="search"
          value={search}
          placeholder="Code or prompt text"
          onChange={(event) => setSearch(event.target.value)}
        />
        {needle !== "" && (
          <>
            <p className="sidebar__count" role="status">
              {results.length} match{results.length === 1 ? "" : "es"}
            </p>
            <ul className="list">{results.map(questionButton)}</ul>
          </>
        )}
      </div>

      {/* `flex: 1` with its own scroll (see `.sidebar__block--sections` in
          app.css) rather than growing to fit every section: with a dozen
          or more sections this list alone can be taller than the sidebar,
          which would push Diagnostics/History/the colour key below it
          off-screen -- scrolling this block internally keeps them
          reachable without scrolling past the whole list first. */}
      <section
        className="sidebar__block sidebar__block--sections"
        aria-labelledby="sections-heading"
      >
        <h2 id="sections-heading" className="sidebar__heading">
          Sections
        </h2>
        {sections.length === 0 && unsectioned.length === 0 && (
          <p className="empty">This version has no questions.</p>
        )}
        <ul className="sections">
          {sections.map((section, index) => (
            // A section with no live questions is still listed. It is a
            // fact about the version -- one that usually means every
            // question in it was archived -- and hiding it would make that
            // disappearance invisible. Numbered by its position in this
            // already-`display_order`-sorted list, matching break-backend's
            // own "1. Getting Started" numbering (there is no stored
            // section number to read instead).
            <li key={section.id}>
              <button
                type="button"
                className={
                  highlightedSection === section.id
                    ? "sections__row sections__row--active"
                    : "sections__row"
                }
                aria-pressed={highlightedSection === section.id}
                onClick={() =>
                  toggleSectionHighlight(
                    section.id,
                    (bySection.get(section.id) ?? []).map((question) => question.id),
                  )
                }
              >
                <span className="sections__name">
                  {index + 1}. {section.name}
                </span>
                <span className="sections__count">{section.live_question_count}</span>
              </button>
            </li>
          ))}
          {unsectioned.length > 0 && (
            <li>
              <button
                type="button"
                className={
                  highlightedSection === "none"
                    ? "sections__row sections__row--active"
                    : "sections__row"
                }
                aria-pressed={highlightedSection === "none"}
                onClick={() =>
                  toggleSectionHighlight(
                    "none",
                    unsectioned.map((question) => question.id),
                  )
                }
              >
                <span className="sections__name">No section</span>
                <span className="sections__count">{unsectioned.length}</span>
              </button>
            </li>
          )}
        </ul>
      </section>

      {/* One block, not three: break's own `.disclosure-group` keeps these
          three snug against each other (a hairline border, no gap) and
          separated from Sections above as a group -- see
          `.sidebar__disclosure-group` in app.css. Fixed height (not
          `flex: 1` like Sections below), so it stays anchored at whatever
          it naturally needs rather than being pushed off the bottom of the
          sidebar's visible area. */}
      <div className="sidebar__block sidebar__block--disclosures">
        <div className="sidebar__disclosure-group">
          <details className="sidebar__disclosure">
            <summary>
              <Chevron />
              <span className="sidebar__heading">Diagnostics</span>
            </summary>
            {/* Capped and independently scrollable rather than growing with
                however many of the eight groups below are open -- eight
                disclosures each free to expand could otherwise push History
                and the colour key far enough down that reaching them means
                scrolling the whole sidebar past a wall of question buttons. */}
            <div className="disclosure-body">
              <ul className="diagnostics">
                {groups.map((group) => (
                  <li key={group.key}>
                    <details
                      onToggle={(event) => {
                        // Highlighting follows the disclosure rather than a
                        // separate control: opening a group is the moment
                        // somebody wants to see where its members are.
                        if (event.currentTarget.open) onHighlight(group.highlightIds);
                        else onHighlight([]);
                      }}
                    >
                      <summary>
                        <Chevron />
                        <span className="diagnostics__label">{group.label}</span>
                        <span
                          className={
                            group.questionIds.length > 0
                              ? "diagnostics__count diagnostics__count--some"
                              : "diagnostics__count"
                          }
                        >
                          {group.key === "dead" ||
                          group.key === "broken" ||
                          group.key === "loops"
                            ? group.highlightIds.length
                            : group.questionIds.length}
                        </span>
                      </summary>
                      <p className="diagnostics__meaning">{group.meaning}</p>
                      {group.questionIds.length === 0 ? (
                        <p className="empty">None.</p>
                      ) : (
                        <ul className="list">
                          {group.questionIds
                            .map((id) => questionsById.get(id))
                            .filter(
                              (question): question is Question =>
                                question !== undefined,
                            )
                            .map(questionButton)}
                        </ul>
                      )}
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          </details>

          <details className="sidebar__disclosure">
            <summary>
              <Chevron />
              <span className="sidebar__heading">History</span>
            </summary>
            <div className="disclosure-body">
              <HistoryPanel questionnaireId={graph.version.questionnaire} />
            </div>
          </details>

          <details className="sidebar__disclosure">
            <summary>
              <Chevron />
              <span className="sidebar__heading">What do the colors mean?</span>
            </summary>
            {/* Ported from break-backend's `.node-key` (index.html
                ~L307-330) -- same four badge icons (this canvas draws
                exactly these, not a circle/diamond stand-in), same
                "Border color" line first. What follows the fourth badge
                has no break equivalent: this app's own archived/missing/
                dead/broken diagnostics (see canvasStyle.ts's docstring),
                not something break's model has a mark for, so there is
                nothing to port for those beyond describing them
                accurately -- spelled out because the canvas signals state
                by shape as well as colour, and a shape vocabulary nobody
                can look up is not much better than colour alone. */}
            <div className="disclosure-body">
              <ul className="node-key">
                <li>
                  <b>Border color</b> — the question's section
                </li>
                <li>
                  <BadgeIcon kind="entry" />
                  Entry point (corner badge)
                </li>
                <li>
                  <BadgeIcon kind="terminal" />
                  Can end the flow (corner badge)
                </li>
                <li>
                  <BadgeIcon kind="branch" />
                  Decision point — different next question per answer (corner badge)
                </li>
                <li>
                  <BadgeIcon kind="unreachable" />
                  Unreachable — no path currently leads here (corner badge)
                </li>
                <li>
                  <span className="node-key-swatch node-key-swatch--archived" />
                  Archived — kept on the map only because something still points at it
                </li>
                <li>
                  <span className="node-key-swatch node-key-swatch--end" />
                  End of flow — the shared destination every "flow ends here" edge
                  points at
                </li>
                <li>
                  <span className="node-key-swatch node-key-swatch--missing" />
                  Missing — an edge points at a question this version does not contain
                </li>
                <li>
                  <span className="node-key-swatch node-key-swatch--fault" />
                  Red border — this question has a dead or broken edge leaving it
                </li>
                <li>
                  <span className="node-key-swatch node-key-swatch--dead" />
                  Dashed arrow — dead edge, the guard can never match
                </li>
                <li>
                  <span className="node-key-swatch node-key-swatch--broken" />
                  Dotted arrow — broken edge, the resolver raises on it
                </li>
              </ul>
            </div>
          </details>
        </div>
      </div>
    </nav>
  );
}
