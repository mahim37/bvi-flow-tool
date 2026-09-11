/** Repeated layout classes so screens share one cream-chrome vocabulary. */

export const emptyText = "text-muted-foreground my-1 text-[0.85rem]";

export const mutedHint = "text-muted-foreground m-0 mb-2 text-[0.8rem]";

export const warnHint = "text-emphasis m-0 mb-2 text-[0.8rem] font-semibold";

export const panelSection = "mt-[22px] border-t border-border pt-4";

export const panelHeading =
  "text-muted-foreground mb-2.5 text-[0.75rem] font-bold tracking-[0.06em] uppercase";

export const subHeading =
  "text-muted-foreground mb-2.5 flex items-center gap-2 text-[11px] font-semibold tracking-[0.7px] uppercase";

export const subCount = "rounded-full bg-background px-2 text-[11px] tracking-normal";

export const editorBox =
  "mt-2.5 flex flex-col gap-3 rounded-lg border border-border bg-background p-3";

export const editorActions = "mt-2.5 flex flex-wrap items-center gap-2";

export const checkRow = "mb-2.5 flex items-center gap-2";

export const optCard = "gap-0 rounded-[10px] p-3 ring-border [--card-spacing:0.75rem]";

/** Destination / source question links in the detail sheet: wrap instead of
 * ellipsizing, and start flush left (no section swatch indent). A trailing
 * arrow marks them as navigation, not static text. `inline` so that arrow
 * sits after the last word when the prompt wraps. Overrides the link
 * button's nowrap and its own underline so the glyph isn't scored through. */
export const questionLink =
  "inline h-auto min-h-0 max-w-full p-0 px-0 py-0 whitespace-normal text-left no-underline hover:text-foreground [&>svg]:pointer-events-none [&>svg]:ml-1 [&>svg]:inline [&>svg]:size-3.5 [&>svg]:stroke-[2.25] [&>svg]:align-text-bottom";
