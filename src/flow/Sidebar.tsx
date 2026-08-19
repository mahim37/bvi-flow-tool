import { useId, useMemo, useState } from "react";

import type { Graph, Question, UUID } from "../api/types";

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

      <section className="sidebar__block" aria-labelledby="diagnostics-nav-heading">
        <h2 id="diagnostics-nav-heading" className="sidebar__heading">
          Diagnostics
        </h2>
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
                        (question): question is Question => question !== undefined,
                      )
                      .map(questionButton)}
                  </ul>
                )}
              </details>
            </li>
          ))}
        </ul>
      </section>

      <section className="sidebar__block" aria-labelledby="sections-heading">
        <h2 id="sections-heading" className="sidebar__heading">
          Sections
        </h2>
        {sections.length === 0 && unsectioned.length === 0 && (
          <p className="empty">This version has no questions.</p>
        )}
        <ul className="sections">
          {sections.map((section) => {
            const questions = bySection.get(section.id) ?? [];
            return (
              <li key={section.id}>
                {/* A section with no live questions is still listed. It is
                    a fact about the version -- one that usually means
                    every question in it was archived -- and hiding it
                    would make that disappearance invisible. */}
                <details>
                  <summary>
                    <span className="sections__name">{section.name}</span>
                    <span className="sections__count">
                      {section.live_question_count}
                    </span>
                  </summary>
                  {questions.length === 0 ? (
                    <p className="empty">No questions in this section.</p>
                  ) : (
                    <ul className="list">{questions.map(questionButton)}</ul>
                  )}
                </details>
              </li>
            );
          })}
          {unsectioned.length > 0 && (
            <li>
              <details>
                <summary>
                  <span className="sections__name">No section</span>
                  <span className="sections__count">{unsectioned.length}</span>
                </summary>
                <ul className="list">{unsectioned.map(questionButton)}</ul>
              </details>
            </li>
          )}
        </ul>
      </section>

      <section className="sidebar__block" aria-labelledby="legend-heading">
        <h2 id="legend-heading" className="sidebar__heading">
          Legend
        </h2>
        {/* Spelled out because the canvas signals state by shape as well as
            colour, and a shape vocabulary nobody can look up is not much
            better than colour alone. */}
        <ul className="legend">
          <li>Circle — entry point</li>
          <li>Diamond — decision point</li>
          <li>Double border — can end the flow</li>
          <li>Dashed border — unreachable, or an archived placeholder</li>
          <li>Octagon — target this version does not contain</li>
          <li>Dashed arrow — dead edge, the guard can never match</li>
          <li>Dotted arrow — broken edge, the resolver raises on it</li>
        </ul>
      </section>
    </nav>
  );
}
