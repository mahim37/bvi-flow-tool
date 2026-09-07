import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/** Mutually exclusive pair (preview mode, etc.). Options are rectangular
 * toggles on a shared track — the track is group chrome, not a CTA. */
export function Segment({
  label,
  className,
  value,
  onValueChange,
  children,
}: {
  label: string;
  className?: string;
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next !== "") onValueChange(next);
      }}
      aria-label={label}
      spacing={0}
      className={cn("rounded-lg border border-border bg-background p-[3px]", className)}
    >
      {children}
    </ToggleGroup>
  );
}

export function SegmentOption({
  value,
  children,
}: {
  value: string;
  children: ReactNode;
}) {
  return (
    <ToggleGroupItem
      value={value}
      size="sm"
      className="flex-1 rounded-md px-3.5 py-1.5 text-[12.5px] font-medium data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm"
    >
      {children}
    </ToggleGroupItem>
  );
}
