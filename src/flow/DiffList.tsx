import { useMemo } from "react";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { Accordion as AccordionPrimitive } from "radix-ui";

import type { DiffChange, Graph, ItemDiff, UUID } from "../api/types";
import { Accordion, AccordionContent, AccordionItem } from "@/components/ui/accordion";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { subCount, subHeading } from "@/lib/chrome";
import { cn } from "@/lib/utils";
import { groupDiffByNode } from "./diffGroups";
import { diffPieces } from "./diffSentence";

interface DiffListProps {
  items: ItemDiff[];
  graph: Graph;
  /** Jump to this change's node on the map. Absent for a section, which
   * hangs off no question, and for a removed item whose question the draft
   * no longer contains -- `question_id` is null in both cases. */
  onShowOnMap: (questionId: string) => void;
}

const MARKER: Record<Exclude<DiffChange, "changed">, string> = {
  added: "+",
  removed: "−",
};

const MARKER_TONE: Record<Exclude<DiffChange, "changed">, string> = {
  added: "text-green",
  removed: "text-destructive",
};

const CHANGE_BG: Record<DiffChange, string> = {
  added: "bg-green/10",
  removed: "bg-destructive/10",
  changed: "bg-gold/10",
};

/** Caps only the human label so "Added edge" / "from" / "to" stay visible. */
function TruncLabel({ text }: { text: string }) {
  return (
    <span className="inline-block max-w-[24ch] truncate align-bottom" title={text}>
      {text}
    </span>
  );
}

function MapRef({
  prefix,
  label,
  questionId,
  onShowOnMap,
}: {
  prefix: string;
  label: string;
  questionId: UUID | null;
  onShowOnMap: (questionId: string) => void;
}) {
  const body = (
    <>
      {prefix}
      <TruncLabel text={label} />
    </>
  );

  if (questionId === null) {
    return <span className="font-medium">{body}</span>;
  }

  return (
    <button
      type="button"
      className="text-foreground inline-flex max-w-full items-baseline gap-0.5 text-left font-medium underline decoration-foreground/40 underline-offset-2"
      aria-label={`${prefix}${label}. Open on the map`}
      onClick={() => onShowOnMap(questionId)}
    >
      {body}
      <ArrowUpRight
        className="mb-px inline size-3.5 shrink-0 stroke-[2.25] align-text-bottom"
        aria-hidden="true"
      />
    </button>
  );
}

function DiffItem({
  item,
  graph,
  onShowOnMap,
}: {
  item: ItemDiff;
  graph: Graph;
  onShowOnMap: (questionId: string) => void;
}) {
  const pieces = diffPieces(item, graph);

  return (
    <li className="min-w-0">
      <article
        className={cn(
          "flex w-full min-w-0 flex-col text-left",
          CHANGE_BG[item.change],
        )}
      >
        <header className="flex min-w-0 flex-row items-start gap-2 px-2 py-1.5">
          {item.change !== "changed" && (
            <span
              className={cn(
                "w-3 shrink-0 font-mono text-sm font-bold",
                MARKER_TONE[item.change],
              )}
              aria-hidden="true"
            >
              {MARKER[item.change]}
            </span>
          )}
          <span className="min-w-0 flex-1 text-[0.85rem] leading-snug">
            {pieces.map((piece, index) =>
              piece.type === "text" ? (
                <span key={index}>{piece.text}</span>
              ) : (
                <MapRef
                  key={index}
                  prefix={piece.prefix}
                  label={piece.label}
                  questionId={piece.questionId}
                  onShowOnMap={onShowOnMap}
                />
              ),
            )}
          </span>
        </header>
      </article>
    </li>
  );
}

/**
 * Every change in this proposal, grouped under the node it belongs to.
 *
 * A question, its answers, and the edges that leave it share one
 * expandable section. Edges always hang off the from-question, not the
 * destination. Sections have no node, so each one is its own group.
 */
export function DiffList({ items, graph, onShowOnMap }: DiffListProps) {
  const groups = useMemo(() => groupDiffByNode(items, graph), [items, graph]);

  if (groups.length === 0) return null;

  return (
    <Card size="sm" className="gap-0 py-0" aria-labelledby="diff-changes">
      <CardHeader className="border-b px-3 py-2 [.border-b]:pb-2">
        <h3 id="diff-changes" className={cn(subHeading, "mb-0")}>
          Changes <span className={subCount}>{groups.length}</span>
        </h3>
      </CardHeader>
      <CardContent className="p-0">
        <Accordion type="multiple" className="w-full px-3">
          {groups.map((group) => (
            <AccordionItem key={group.key} value={group.key} className="border-border">
              <AccordionPrimitive.Header className="flex min-w-0">
                <AccordionPrimitive.Trigger className="group/diff flex w-full min-w-0 flex-row items-center gap-2 rounded-md py-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                  <span
                    className="border-border bg-muted/70 text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-md border"
                    aria-hidden="true"
                  >
                    <ChevronDown className="size-3.5 transition-transform duration-200 group-data-[state=open]/diff:rotate-180" />
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate text-[0.9rem] leading-snug font-medium"
                    title={group.title}
                  >
                    {group.title}
                  </span>
                </AccordionPrimitive.Trigger>
              </AccordionPrimitive.Header>
              <AccordionContent className="pb-2 [&_p:not(:last-child)]:mb-0">
                <ul className="m-0 flex list-none flex-col overflow-hidden p-0">
                  {group.items.map((item) => (
                    <DiffItem
                      key={`${item.kind}:${item.change}:${item.key}`}
                      item={item}
                      graph={graph}
                      onShowOnMap={onShowOnMap}
                    />
                  ))}
                </ul>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}
