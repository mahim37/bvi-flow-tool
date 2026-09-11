import { useMemo } from "react";

import { CHOICE_ANSWER_TYPES, type Edge, type Graph } from "../api/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { emptyText, optCard, subCount, subHeading } from "@/lib/chrome";
import { optionsCoveredByFallback } from "./graphElements";

interface RouteChoicesPanelProps {
  graph: Graph;
  edge: Edge;
  onClose: () => void;
}

export function RouteChoicesPanel({ graph, edge, onClose }: RouteChoicesPanelProps) {
  const question = graph.questions.find((item) => item.id === edge.from_question);
  const outgoing = useMemo(
    () =>
      graph.edges.filter((candidate) => candidate.from_question === edge.from_question),
    [graph.edges, edge.from_question],
  );
  const isChoice =
    question !== undefined && CHOICE_ANSWER_TYPES.has(question.answer_type);
  const choices =
    question !== undefined && isChoice
      ? optionsCoveredByFallback(question, outgoing, edge)
      : [];

  return (
    <aside
      className="panel relative h-full min-h-0 min-w-0 overflow-y-auto bg-background p-5"
      aria-label="Choices on this route"
    >
      <Button
        size="icon"
        className="absolute top-3 right-3 z-3"
        title="Close"
        aria-label="Close route choices"
        onClick={onClose}
      >
        ✕
      </Button>
      <h2 id="route-choices-heading" className={`${subHeading} pr-8`}>
        Answers <span className={subCount}>{choices.length}</span>
      </h2>
      {!isChoice || choices.length === 0 ? (
        <p className={emptyText}>
          {isChoice
            ? "Nothing in the answer list takes this arrow."
            : "There is no answer list on this question."}
        </p>
      ) : (
        <ul
          className="m-0 flex list-none flex-col gap-2 p-0"
          aria-labelledby="route-choices-heading"
        >
          {choices.map((option) => (
            <li key={option.id}>
              <Card className={`${optCard} p-2.5`}>
                <div className="text-[12.5px] leading-snug font-medium">
                  {option.label}
                </div>
                <div className="text-muted-foreground mt-1 text-[11px]">
                  {option.code}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
