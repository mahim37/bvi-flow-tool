import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";

import { Spinner } from "@/components/ui/loading";

/**
 * Rectangular actions. Radius stays modest so a control never reads as a
 * status pill (`Badge` is the capsule). `primary` is the filled ink CTA;
 * `default` is the outlined surface button the rest of the chrome uses.
 */
const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:not-aria-busy:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[pressed=true]:border-gold data-[pressed=true]:text-gold",
  {
    variants: {
      variant: {
        default:
          "border-border-strong bg-card text-foreground shadow-sm hover:bg-background hover:border-muted-foreground",
        primary: "bg-primary text-primary-foreground hover:bg-primary/80 shadow-sm",
        outline:
          "border-border bg-card text-foreground hover:bg-muted hover:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_srgb,var(--secondary),var(--foreground)_6%)]",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        destructive:
          "border-destructive bg-card text-destructive hover:bg-destructive/10",
        danger: "border-destructive bg-card text-destructive hover:bg-destructive/10",
        link: "h-auto min-h-0 rounded-none border-0 p-0 font-semibold text-primary underline underline-offset-2 hover:text-foreground",
      },
      size: {
        md: "h-9 gap-1.5 px-3.5",
        sm: "h-7 gap-1 rounded-md px-2.5 text-[0.8rem] [&_svg:not([class*='size-'])]:size-3.5",
        icon: "size-9 rounded-md",
        "icon-sm": "size-7 rounded-md",
        default: "h-9 gap-1.5 px-3.5",
      },
    },
    compoundVariants: [
      // Size padding/height otherwise wins over `variant: link`'s reset,
      // which indented destination prompts as if they were chrome buttons.
      { variant: "link", class: "h-auto min-h-0 gap-0 p-0 px-0 py-0" },
    ],
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /** Gold “this action is live” state (canvas retarget). Colour is not
     * the only signal: the label also changes at the call site. */
    pressed?: boolean;
    /** Spinner beside the idle label, so the control keeps its wording
     * while a write is in flight. */
    loading?: boolean;
  };

function Button({
  className,
  variant = "default",
  size = "md",
  asChild = false,
  pressed = false,
  loading = false,
  type = "button",
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  const showLoading = loading && !asChild;

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...(pressed ? { "data-pressed": "true" } : {})}
      {...(showLoading ? { "aria-busy": true } : {})}
      {...(asChild ? {} : { type, disabled: Boolean(disabled) || showLoading })}
      {...props}
    >
      {showLoading ? (
        <>
          <Spinner />
          {children}
        </>
      ) : (
        children
      )}
    </Comp>
  );
}

export { Button, buttonVariants, type ButtonProps };
