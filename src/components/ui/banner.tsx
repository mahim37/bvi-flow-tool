import { type VariantProps } from "class-variance-authority";
import { type HTMLAttributes } from "react";

import { cn } from "@/lib/utils";
import { alertVariants } from "@/components/ui/alert";

const bannerTone = {
  error: "destructive",
  warn: "warn",
  info: "info",
} as const;

type BannerTag = "p" | "div";

export type BannerProps<T extends BannerTag = "div"> = {
  as?: T;
  tone?: keyof typeof bannerTone;
} & VariantProps<typeof alertVariants> &
  HTMLAttributes<HTMLElement>;

/** Callout, not a control: left stripe + white card. Colour is never the
 * only signal; the wording still names the problem. */
export function Banner<T extends BannerTag = "div">({
  as,
  tone = "info",
  variant,
  className,
  ...props
}: BannerProps<T>) {
  const Comp = as ?? "div";
  return (
    <Comp
      data-slot="alert"
      className={cn(
        alertVariants({ variant: variant ?? bannerTone[tone] }),
        "mt-2 px-3.5 py-2.5 text-[0.88rem] shadow-sm",
        className,
      )}
      {...props}
    />
  );
}
