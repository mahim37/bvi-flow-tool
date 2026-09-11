import type { ReactNode } from "react";
import { Loader2Icon } from "lucide-react";

import { cn } from "@/lib/utils";

/** In-flight spinner. Own element, no translate utilities — those share
 * `transform` with `animate-spin` and freeze the rotation. */
export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2Icon
      className={cn("size-4 origin-center shrink-0 animate-spin", className)}
      aria-hidden="true"
    />
  );
}

/** In-flight fetch: spinner above the caption, not covering it.
 *
 * `centered` fills the parent pane so a page-level fetch sits in the
 * middle of the remaining viewport, not glued under the toolbar. */
export function LoadingStatus({
  children,
  className,
  centered = false,
}: {
  children: ReactNode;
  className?: string;
  centered?: boolean;
}) {
  return (
    <span
      role="status"
      className={cn(
        "inline-flex flex-col items-center justify-center gap-2",
        centered && "flex min-h-0 w-full flex-1 self-stretch",
        className,
      )}
    >
      {centered ? <Spinner className="size-5" /> : <Spinner />}
      <span>{children}</span>
    </span>
  );
}
