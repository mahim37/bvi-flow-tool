import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { publicCode } from "./labels";

/** Public code and human name as two lines, not `(id: …, label: …)`.
 * Id stays muted and small; the label is the thing you actually read. */
export function NamedRef({
  code,
  label,
  className,
  size = "sm",
}: {
  code: string | null | undefined;
  label: ReactNode;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <span className={cn("flex min-w-0 flex-col gap-0.5 text-left", className)}>
      <span className="text-muted-foreground font-mono text-[11px] leading-none">
        id: {publicCode(code)}
      </span>
      <span
        className={cn(
          "leading-snug font-medium",
          size === "md" ? "text-base" : "text-sm",
        )}
      >
        {label}
      </span>
    </span>
  );
}
