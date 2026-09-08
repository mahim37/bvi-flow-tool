import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";

/**
 * Status / metadata chip. Fully rounded on purpose: that silhouette is
 * reserved for “this is a fact”, never for “click me”. Not a `<button>`.
 * Colour is never the only signal (spec 4.11) — the wording still names
 * the fact.
 */
const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border px-2.5 py-0.5 text-[10.5px] font-semibold tracking-wide whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-destructive/40 bg-destructive/10 text-destructive",
        outline: "border-border text-foreground",
        ghost: "border-transparent text-muted-foreground",
        link: "border-transparent text-primary underline-offset-4",
        entry:
          "uppercase tracking-wider text-green border-[rgba(87,211,140,0.4)] bg-[rgba(87,211,140,0.1)]",
        added:
          "uppercase tracking-wider text-green border-[rgba(87,211,140,0.4)] bg-[rgba(87,211,140,0.1)]",
        term: "uppercase tracking-wider text-destructive border-[rgba(240,114,107,0.4)] bg-[rgba(240,114,107,0.1)]",
        removed:
          "uppercase tracking-wider text-destructive border-[rgba(240,114,107,0.4)] bg-[rgba(240,114,107,0.1)]",
        branch:
          "uppercase tracking-wider text-gold border-[rgba(242,193,78,0.4)] bg-[rgba(242,193,78,0.1)]",
        changed:
          "uppercase tracking-wider text-gold border-[rgba(242,193,78,0.4)] bg-[rgba(242,193,78,0.1)]",
        unreach:
          "uppercase tracking-wider text-emphasis border-[rgba(240,148,77,0.4)] bg-[rgba(240,148,77,0.1)]",
        neutral:
          "uppercase tracking-wider text-muted-foreground border-border-strong bg-background",
        meta: "rounded-md tracking-normal text-foreground/80 border-border bg-card",
        tag: "uppercase tracking-wider text-[0.68rem] font-bold text-muted-foreground border-border-strong px-1.5 py-px",
        section:
          "rounded-full border-0 text-xs font-semibold tracking-normal px-2.5 py-1",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

type BadgeProps = React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    asChild?: boolean;
    /** Product name for the same axis as `variant`. */
    tone?: BadgeTone;
  };

function Badge({ className, variant, tone, asChild = false, ...props }: BadgeProps) {
  const Comp = asChild ? Slot.Root : "span";
  const resolved = tone ?? variant ?? "neutral";

  return (
    <Comp
      data-slot="badge"
      data-variant={resolved}
      className={cn(badgeVariants({ variant: resolved }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants, type BadgeProps };
