import { NavLink, type NavLinkProps } from "react-router-dom";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Segmented view switcher. Real links rather than local tab state, so
 * each view is a URL. Track is pill-shaped group chrome, not a CTA. */
export function TabsNav({ label, children }: { label: string; children: ReactNode }) {
  return (
    <nav
      className="inline-flex h-9 shrink-0 items-center gap-0.5 rounded-md bg-secondary p-[3px]"
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
          "inline-flex h-full items-center rounded-md px-3.5 text-[0.85rem] font-semibold text-muted-foreground no-underline transition-colors hover:text-foreground",
          state.isActive && "bg-card text-foreground shadow-sm",
          typeof className === "function" ? className(state) : className,
        )
      }
    />
  );
}
