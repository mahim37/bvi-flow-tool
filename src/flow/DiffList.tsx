import type { DiffKind, ItemDiff } from "../api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { panelHeading } from "@/lib/chrome";
import { diffChangeLabel, diffKindLabel, diffValue, fieldLabel } from "./labels";

interface DiffListProps {
  kind: DiffKind;
  items: ItemDiff[];
  /** Jump to this change's node on the map. Absent for a section, which
   * hangs off no question, and for a removed item whose question the draft
   * no longer contains -- `question_id` is null in both cases. */
  onShowOnMap: (questionId: string) => void;
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
 */
export function DiffList({ kind, items, onShowOnMap }: DiffListProps) {
  if (items.length === 0) return null;

  return (
    <Card
      size="sm"
      className="gap-3 rounded-lg p-4 ring-border"
      aria-labelledby={`diff-${kind}`}
    >
      <h3 id={`diff-${kind}`} className={panelHeading}>
        {diffKindLabel(kind)}
        <span className="bg-secondary text-foreground/80 ml-2 rounded-full px-2 py-px text-[0.75rem] font-bold">
          {items.length}
        </span>
      </h3>
      <ul className="list-none p-0">
        {items.map((item) => (
          <li
            key={`${item.change}:${item.key}`}
            className="border-t border-border pt-2.5 mt-2.5 first:mt-0 first:border-t-0 first:pt-0"
          >
            <div className="flex flex-wrap items-center gap-2.5">
              <Badge tone={item.change}>{diffChangeLabel(item.change)}</Badge>
              <code className="font-mono text-[0.85rem] font-bold">{item.key}</code>
              {item.question_id !== null && (
                <Button
                  variant="link"
                  onClick={() => onShowOnMap(item.question_id as string)}
                >
                  Show on map
                </Button>
              )}
            </div>

            {item.fields.length > 0 && (
              // Only rendered for a change: an added or removed item has
              // no pair to show, and listing every one of its fields
              // against "not set" would bury the four that a reviewer
              // actually has to read.
              <dl className="mt-2 grid gap-1">
                {item.fields.map((field) => (
                  <div
                    key={field.field}
                    className="grid grid-cols-[130px_minmax(0,1fr)] gap-2.5 text-[0.88rem]"
                  >
                    <dt className="text-muted-foreground">{fieldLabel(field.field)}</dt>
                    <dd className="m-0">
                      <span className="text-muted-foreground line-through">
                        {diffValue(field.base)}
                      </span>
                      <span aria-hidden="true"> → </span>
                      <span className="sr-only">changed to</span>
                      <span className="font-semibold">{diffValue(field.draft)}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
