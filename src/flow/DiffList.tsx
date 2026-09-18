import { useMemo } from "react";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { Accordion as AccordionPrimitive } from "radix-ui";

import type { DiffChange, Graph, ItemDiff, UUID } from "../api/types";
import { Accordion, AccordionContent, AccordionItem } from "@/components/ui/accordion";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { subCount, subHeading } from "@/lib/chrome";
import { cn } from "@/lib/utils";
import { groupDiffByNode } from "./diffGroups";
import { effectiveChange } from "./diffItem";
import { diffPieces } from "./diffSentence";

interface DiffListProps {
  items: ItemDiff[];
  graph: Graph;
  /** The version the diff was taken against. It names what the draft
   * graph cannot: every removed option, edge and section, and a retired
   * question `graph/` no longer serves. Rows fall back to their kind alone
   * while it is absent. */
  baseGraph?: Graph | undefined;
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

/** Caps only the human label so "connection" / "from" / "to" stay visible. */
function TruncLabel({ text, className }: { text: string; className?: string }) {
  return (
    <span
      className={cn("inline-block max-w-[24ch] truncate align-bottom", className)}
      title={text}
    >
      {text}
    </span>
  );
}

const LINK_UNDERLINE = "underline decoration-foreground/40 underline-offset-2";

function MapRef({
  prefix,
  label,
  questionId,
  quoted = false,
  onShowOnMap,
}: {
  prefix: string;
  label: string;
  questionId: UUID | null;
  quoted?: boolean;
  onShowOnMap: (questionId: string) => void;
}) {
  // Underline starts at connection/question/option and runs through the
  // closing quote. The verb ("Added") is a separate text piece so it
  // stays plain. TruncLabel is inline-block, so it needs the underline
  // class of its own or the quoted words would skip the decoration.
  const body = (
    <span className={LINK_UNDERLINE}>
      {prefix}
      {quoted ? (
        <>
          "
          <TruncLabel text={label} className={cn("font-bold", LINK_UNDERLINE)} />"
        </>
      ) : (
        <TruncLabel text={label} className={LINK_UNDERLINE} />
      )}
    </span>
  );

  const spoken = quoted ? `${prefix}"${label}"` : `${prefix}${label}`;

  if (questionId === null) {
    return <span className="font-medium">{body}</span>;
  }

  return (
    <button
      type="button"
      className="text-foreground inline-flex max-w-full cursor-pointer items-baseline gap-0.5 text-left font-medium opacity-100 transition-opacity duration-150 hover:opacity-90"
      aria-label={`${spoken}. Open on the map`}
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
  baseGraph,
  onShowOnMap,
}: {
  item: ItemDiff;
  graph: Graph;
  baseGraph: Graph | undefined;
  onShowOnMap: (questionId: string) => void;
}) {
  const change = effectiveChange(item);
  const pieces = diffPieces(item, graph, baseGraph);

  return (
    <li className="min-w-0">
      <article
        className={cn("flex w-full min-w-0 flex-col text-left", CHANGE_BG[change])}
      >
        <header className="flex min-w-0 flex-row items-start gap-2 px-2 py-1.5">
          {change !== "changed" && (
            <span
              className={cn(
                "w-3 shrink-0 font-mono text-sm font-bold",
                MARKER_TONE[change],
              )}
              aria-hidden="true"
            >
              {MARKER[change]}
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
                  quoted={piece.quoted === true}
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
export function DiffList({ items, graph, baseGraph, onShowOnMap }: DiffListProps) {
  const groups = useMemo(
    () => groupDiffByNode(items, graph, baseGraph),
    [items, graph, baseGraph],
  );

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
                      baseGraph={baseGraph}
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
