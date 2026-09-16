/** Repeated layout classes so screens share one cream-chrome vocabulary. */

export const emptyText = "text-muted-foreground my-1 text-[0.85rem]";

export const mutedHint = "text-muted-foreground m-0 mb-2 text-[0.8rem]";

export const warnHint = "text-emphasis m-0 mb-2 text-[0.8rem] font-semibold";

export const panelSection = "mt-[22px] border-t border-border pt-4";

export const panelHeading =
  "text-muted-foreground mb-2.5 text-[0.75rem] font-bold tracking-normal";

export const subHeading =
  "text-muted-foreground mb-2.5 flex items-center gap-2 text-[11px] font-semibold tracking-normal";

/** Default-route and specific-choice titles in the answers tree. */
export const routeHeading =
  "text-muted-foreground mb-0 text-[13px] font-semibold tracking-normal";

export const subCount = "rounded-full bg-background px-2 text-[11px] tracking-normal";

export const editorBox =
  "mt-2.5 flex flex-col gap-3 rounded-lg border border-border bg-background p-3";

export const editorActions = "mt-2.5 flex flex-wrap items-center gap-2";

export const checkRow = "mb-2.5 flex items-center gap-2";

export const optCard = "rounded-[10px] bg-card p-3 ring-1 ring-border";

/** Destination / source question links in the detail sheet: the prompt
 * ellipsizes, `To:` stays put, and a trailing arrow marks them as
 * navigation. Overrides the link button's nowrap so the glyph isn't
 * scored through. */
export const questionLink =
  "inline-flex h-auto min-h-0 min-w-0 max-w-full flex-1 shrink items-baseline overflow-hidden p-0 px-0 py-0 text-left no-underline hover:text-foreground [&>svg]:pointer-events-none [&>svg]:ml-1 [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:stroke-[2.25] [&>svg]:align-text-bottom";
