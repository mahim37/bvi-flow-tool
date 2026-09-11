import { ArrowUpRight } from "lucide-react";

import type { DiffChange, DiffKind, FieldChange, ItemDiff } from "../api/types";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { subCount, subHeading } from "@/lib/chrome";
import { cn } from "@/lib/utils";
import { diffChangeLabel, diffKindLabel, diffValue, fieldLabel } from "./labels";

interface DiffListProps {
  kind: DiffKind;
  items: ItemDiff[];
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

/** One side of a unified diff. `<ins>`/`<del>` carry the meaning; colour
 * and the +/- gutter are the same signal GitHub uses, not a second one. */
function DiffLine({ side, children }: { side: "added" | "removed"; children: string }) {
  const Comp = side === "added" ? "ins" : "del";
  return (
    <Comp
      className={cn(
        "flex gap-2 px-2.5 py-1 font-mono text-[13px] leading-snug no-underline",
        side === "added"
          ? "bg-green/10 text-green"
          : "bg-destructive/10 text-destructive",
      )}
    >
      <span className="w-3 shrink-0 select-none" aria-hidden="true">
        {side === "added" ? "+" : "−"}
      </span>
      <span className="min-w-0 whitespace-pre-wrap">{children}</span>
    </Comp>
  );
}

function FieldHunk({ field }: { field: FieldChange }) {
  return (
    <div className="overflow-hidden rounded-md ring-1 ring-border">
      <p className="bg-muted text-muted-foreground m-0 px-2.5 py-1 font-mono text-[11px] tracking-wide">
        {fieldLabel(field.field)}
      </p>
      <DiffLine side="removed">{diffValue(field.base)}</DiffLine>
      <DiffLine side="added">{diffValue(field.draft)}</DiffLine>
    </div>
  );
}

/**
 * One kind of change, listed.
 *
 * Grouped by kind rather than flattened, matching how `diffing` serves it
 * and how a reviewer reads it: added and removed questions are skimmed,
 * and the edge changes are read carefully, because those are the ones
 * that alter what a respondent is asked next.
 *
 * Every row is keyed by `code`, never by id -- the server matched them
 * that way, because a draft is a whole copy and an id comparison would
 * report the entire questionnaire as removed and re-added.
 *
 * Field pairs render as a unified diff (`−` then `+`) so a reviewer can
 * read them the same way they already read git. A row that hangs off a
 * question is itself the map link: the key carries the underline and
 * arrow that used to live on a separate "Show on map" control.
 */
export function DiffList({ kind, items, onShowOnMap }: DiffListProps) {
  if (items.length === 0) return null;

  return (
    <Card size="sm" className="gap-0 py-0" aria-labelledby={`diff-${kind}`}>
      <CardHeader className="border-b px-3 py-2 [.border-b]:pb-2">
        <h3 id={`diff-${kind}`} className={cn(subHeading, "mb-0")}>
          {diffKindLabel(kind)} <span className={subCount}>{items.length}</span>
        </h3>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-border m-0 list-none divide-y p-0">
          {items.map((item) => {
            const questionId = item.question_id;
            const clickable = questionId !== null;
            const label = clickable
              ? `${diffChangeLabel(item.change)} ${item.key}. Open on the map`
              : `${diffChangeLabel(item.change)} ${item.key}`;
            const body = (
              <>
                <header className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  {item.change !== "changed" && (
                    <span
                      className={cn(
                        "w-3 font-mono text-sm font-bold",
                        MARKER_TONE[item.change],
                      )}
                      aria-hidden="true"
                    >
                      {MARKER[item.change]}
                    </span>
                  )}
                  <span className="inline-flex min-w-0 items-baseline gap-1">
                    <code
                      className={cn(
                        "font-mono text-[0.85rem] font-bold",
                        clickable &&
                          "underline decoration-foreground/40 underline-offset-2",
                      )}
                    >
                      {item.key}
                    </code>
                    {clickable && (
                      <ArrowUpRight
                        className="mb-px inline size-3.5 shrink-0 stroke-[2.25] align-text-bottom"
                        aria-hidden="true"
                      />
                    )}
                  </span>
                </header>

                {item.fields.length > 0 && (
                  // Only rendered for a change: an added or removed item has
                  // no pair to show, and listing every one of its fields
                  // against "not set" would bury the four that a reviewer
                  // actually has to read.
                  <div className="flex flex-col gap-1.5">
                    {item.fields.map((field) => (
                      <FieldHunk key={field.field} field={field} />
                    ))}
                  </div>
                )}
              </>
            );

            return (
              <li key={`${item.change}:${item.key}`}>
                {clickable ? (
                  <button
                    type="button"
                    className="hover:bg-muted/50 flex w-full cursor-pointer flex-col gap-1.5 px-3 py-2 text-left"
                    aria-label={label}
                    onClick={() => onShowOnMap(questionId)}
                  >
                    {body}
                  </button>
                ) : (
                  <article
                    className="flex flex-col gap-1.5 px-3 py-2"
                    aria-label={label}
                  >
                    {body}
                  </article>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
