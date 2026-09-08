import { NavLink, type NavLinkProps } from "react-router-dom";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Segmented view switcher. Real links rather than local tab state, so
 * each view is a URL. Sizes to its labels — the parent centers this
 * cluster in the sidebar column. Chrome, not a CTA. */
export function TabsNav({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <nav
      className={cn(
        "inline-flex w-fit items-center justify-center gap-1 rounded-xl bg-secondary p-1",
        className,
      )}
      aria-label={label}
      data-slot="tabs"
    >
      {children}
    </nav>
  );
}

export function TabsLink({ className, ...props }: NavLinkProps) {
  return (
    <NavLink
      {...props}
      className={(state) =>
        cn(
          "inline-flex items-center justify-center rounded-lg border border-transparent px-5 py-2 text-center text-[10.5px] leading-none font-semibold whitespace-nowrap text-muted-foreground no-underline transition-colors hover:bg-background/70 hover:text-foreground",
          state.isActive && "border-border bg-card text-foreground shadow-sm",
          typeof className === "function" ? className(state) : className,
        )
      }
    />
  );
}
