import { useMemo } from "react";

import type { Graph, Question, UUID } from "../api/types";
import { EdgeEditor } from "./EdgeEditor";
import { answerTypeLabel, formatTimestamp, optionLabel } from "./labels";

interface DetailPanelProps {
  graph: Graph;
  question: Question | null;
  editable: boolean;
  onSelectQuestion: (id: UUID) => void;
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="badge">{children}</span>;
}

export function DetailPanel({
  graph,
  question,
  editable,
  onSelectQuestion,
}: DetailPanelProps) {
  const questionsById = useMemo(
    () => new Map(graph.questions.map((item) => [item.id, item])),
    [graph.questions],
  );

  const incoming = useMemo(() => {
    if (question === null) return [];
    return graph.edges.filter((edge) => edge.to_question === question.id);
  }, [graph.edges, question]);

  if (question === null) {
    return (
      <aside className="panel" aria-label="Question detail">
        <p className="empty">Select a question to see where its answers lead.</p>
      </aside>
    );
  }

  const audit = question.diagnostics;
  const section = graph.sections.find((item) => item.id === question.section);
  const uncovered = new Set(audit?.uncovered_option_ids ?? []);

  return (
    <aside className="panel" aria-label={`Detail for ${question.code}`}>
      <header className="panel__header">
        <h2 className="panel__title">{question.code}</h2>
        <p className="panel__prompt">{question.prompt}</p>
      </header>

      <dl className="meta">
        <div>
          <dt>Answer type</dt>
          <dd>{answerTypeLabel(question.answer_type)}</dd>
        </div>
        <div>
          <dt>Required</dt>
          <dd>{question.is_required ? "Yes" : "No"}</dd>
        </div>
        <div>
          <dt>Section</dt>
          <dd>{section ? section.name : "None"}</dd>
        </div>
      </dl>

      {question.archived_at !== null ? (
        // No diagnostics for an archived question, and this says why
        // rather than showing an empty row of badges. The resolver never
        // serves one, so it has no routing behaviour to describe -- it is
        // drawn at all only because something still points at it.
        <p className="banner banner--warn">
          Archived on {formatTimestamp(question.archived_at)}. It is shown only because
          an edge still points at it, and the resolver raises rather than serving it.
          Nothing here describes routing behaviour, because it has none.
        </p>
      ) : (
        audit !== null && (
          <section className="panel__section" aria-labelledby="diagnostics-heading">
            <h3 id="diagnostics-heading" className="panel__heading">
              Diagnostics
            </h3>
            <div className="badges">
              {audit.is_entry && <Badge>Entry point</Badge>}
              {audit.is_decision_point && <Badge>Decision point</Badge>}
              {audit.is_terminal && <Badge>Can end the flow</Badge>}
              {!audit.is_reachable && <Badge>Unreachable</Badge>}
              {!audit.is_entry &&
                !audit.is_decision_point &&
                !audit.is_terminal &&
                audit.is_reachable && <Badge>Nothing to report</Badge>}
            </div>
          </section>
        )
      )}

      {question.options.length > 0 && (
        <section className="panel__section" aria-labelledby="options-heading">
          <h3 id="options-heading" className="panel__heading">
            Options
          </h3>
          <ul className="options">
            {question.options.map((option) => (
              <li key={option.id}>
                <span>{option.label}</span>
                <code className="options__code">{option.code}</code>
                {uncovered.has(option.id) && (
                  <span className="options__fault">
                    No edge covers this answer, so choosing it ends the flow.
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <EdgeEditor
        graph={graph}
        question={question}
        editable={editable && question.archived_at === null}
        onSelectQuestion={onSelectQuestion}
      />

      <section className="panel__section" aria-labelledby="incoming-heading">
        <h3 id="incoming-heading" className="panel__heading">
          Reached from
        </h3>
        {incoming.length === 0 ? (
          <p className="empty">
            {audit?.is_entry === true
              ? "Nothing routes here. It is the entry point, so it runs first anyway."
              : "Nothing routes here, so this question is never served."}
          </p>
        ) : (
          <ul className="incoming">
            {incoming.map((edge) => {
              const source = questionsById.get(edge.from_question);
              return (
                <li key={edge.id}>
                  <button
                    type="button"
                    className="link"
                    onClick={() => onSelectQuestion(edge.from_question)}
                  >
                    {source ? source.code : "Unknown question"}
                  </button>
                  <span className="incoming__guard">
                    {" when "}
                    {optionLabel(source, edge.from_option).toLowerCase()}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </aside>
  );
}
