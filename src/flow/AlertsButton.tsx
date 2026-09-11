import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

import { Alert, AlertDescription, alertVariants } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type ChromeAlert = {
  id: string;
  tone: "error" | "warn" | "info";
  children: ReactNode;
  /** Jump to the question this alert names. Absent for chrome that has
   * no place on the map (a lock, a missing entry, a server sentence). */
  onSelect?: () => void;
  actionLabel?: string;
};

export type ChromeAlertKind = "Alerts" | "Issues";

const ALERT_VARIANT = {
  error: "destructive",
  warn: "warn",
  info: "info",
} as const;

const KIND_COPY: Record<
  ChromeAlertKind,
  { title: string; one: string; many: (count: number) => string }
> = {
  Alerts: {
    title: "Alerts",
    one: "1 alert",
    many: (count) => `${count} alerts`,
  },
  Issues: {
    title: "Issues",
    one: "1 issue",
    many: (count) => `${count} issues`,
  },
};

/**
 * Draft (or published-version) problems, collapsed to a red control so
 * the bar stays one row. The banners that used to stack under the chrome
 * live in the panel this opens.
 */
export function AlertsButton({
  items,
  kind = "Alerts",
}: {
  items: ChromeAlert[];
  kind?: ChromeAlertKind;
}) {
  if (items.length === 0) return null;

  const copy = KIND_COPY[kind];
  const label = items.length === 1 ? copy.one : copy.many(items.length);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="danger" aria-label={label} title={label}>
          <TriangleAlert />
          {copy.title}
          <span className="tabular-nums opacity-80">{items.length}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(calc(100vw-2rem),24rem)] gap-2 p-3">
        <PopoverHeader>
          <PopoverTitle>{copy.title}</PopoverTitle>
        </PopoverHeader>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {items.map((item) => (
            <li key={item.id}>
              {item.onSelect === undefined ? (
                <Alert variant={ALERT_VARIANT[item.tone]} className="shadow-none">
                  <AlertDescription>{item.children}</AlertDescription>
                </Alert>
              ) : (
                <button
                  type="button"
                  className={cn(
                    alertVariants({ variant: ALERT_VARIANT[item.tone] }),
                    "w-full cursor-pointer shadow-none",
                  )}
                  aria-label={item.actionLabel}
                  onClick={item.onSelect}
                >
                  <span data-slot="alert-description" className="min-w-0 text-sm">
                    {item.children}
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
