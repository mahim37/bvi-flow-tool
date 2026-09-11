import { cn } from "@/lib/utils";
import { panelHeading } from "@/lib/chrome";

/** Same four icon paths canvasStyle.ts draws as corner badges, so the
 * index shows the exact mark a node carries. */
export function BadgeIcon({
  kind,
}: {
  kind: "entry" | "terminal" | "branch" | "unreachable" | "added" | "changed";
}) {
  return (
    <svg
      className={cn(
        "size-[13px] shrink-0",
        kind === "added"
          ? "text-green"
          : kind === "changed"
            ? "text-gold"
            : "text-foreground/80",
      )}
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "entry" && (
        <>
          <path d="M5 21V3" />
          <path d="M5 4h13l-3 5 3 5H5" />
        </>
      )}
      {kind === "terminal" && <rect x="7" y="7" width="10" height="10" rx="1.5" />}
      {kind === "branch" && (
        <>
          <circle cx="12" cy="18" r="3" />
          <circle cx="6" cy="6" r="3" />
          <circle cx="18" cy="6" r="3" />
          <path d="M6 9v1a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V9" />
        </>
      )}
      {kind === "unreachable" && (
        <>
          <path d="M12 3L2 21h20L12 3z" />
          <path d="M12 10v4" />
        </>
      )}
      {kind === "added" && <path d="M12 6v12M6 12h12" strokeWidth={4} />}
      {kind === "changed" && (
        <>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </>
      )}
    </svg>
  );
}

export function KeySwatch({
  kind,
}: {
  kind: "archived" | "end" | "missing" | "fault" | "dead" | "broken";
}) {
  if (kind === "dead" || kind === "broken") {
    return (
      <span
        className={
          kind === "dead"
            ? "h-0 w-4 shrink-0 border-t-2 border-dashed border-[#9a3412]"
            : "h-0 w-4 shrink-0 border-t-[3px] border-dotted border-destructive"
        }
        aria-hidden="true"
      />
    );
  }
  return (
    <span
      className={cn(
        "size-4 shrink-0 rounded-[4px]",
        kind === "archived" &&
          "border-border-strong border-2 border-dashed bg-[#f1e7d2]",
        kind === "end" && "border-muted-foreground border-2 bg-[#f1e7d2]",
        kind === "missing" && "border-2 border-dashed border-destructive bg-[#fbe2dc]",
        kind === "fault" && "border-2 border-destructive bg-card",
      )}
      aria-hidden="true"
    />
  );
}

const row = "flex items-center gap-2.5 text-[0.78rem] leading-snug text-foreground/80";

export function MapHelpList() {
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      <li>
        <strong>Click</strong> a question for details
      </li>
      <li>
        <strong>The section chevron</strong> collapses it
      </li>
      <li>
        <strong>Hover</strong> to trace its paths
      </li>
      <li>
        <strong>Drag the canvas</strong> to pan
      </li>
      <li>
        <strong>Drag a question</strong> to move it
      </li>
      <li>
        <strong>Scroll</strong> to zoom
      </li>
    </ul>
  );
}

export function MapLegendList() {
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
      <li className={row}>
        <b>Border color</b>: the question's section
      </li>
      <li className={row}>
        <BadgeIcon kind="added" />
        Added by this draft, not yet published (corner badge, green tint)
      </li>
      <li className={row}>
        <BadgeIcon kind="changed" />
        Changed by this draft, not yet published (corner badge, gold tint)
      </li>
      <li className={row}>
        <BadgeIcon kind="entry" />
        Entry point (corner badge)
      </li>
      <li className={row}>
        <BadgeIcon kind="terminal" />
        Can end the flow (corner badge)
      </li>
      <li className={row}>
        <BadgeIcon kind="branch" />
        Decision point: different next question per answer (corner badge)
      </li>
      <li className={row}>
        <BadgeIcon kind="unreachable" />
        Unreachable: no path currently leads here (corner badge)
      </li>
      <li className={row}>
        <KeySwatch kind="archived" />
        Archived: kept on the map only because something still points at it
      </li>
      <li className={row}>
        <KeySwatch kind="end" />
        End of flow: the shared destination every "flow ends here" edge points at
      </li>
      <li className={row}>
        <KeySwatch kind="missing" />
        Missing: an edge points at a question this version does not contain
      </li>
      <li className={row}>
        <KeySwatch kind="fault" />
        Red border: this question has a dead or broken route leaving it
      </li>
      <li className={row}>
        <KeySwatch kind="dead" />
        Dashed arrow: dead route, tied to an answer this question doesn't offer anymore
      </li>
      <li className={row}>
        <KeySwatch kind="broken" />
        Dotted arrow: broken route, leads to a question that's archived or removed
      </li>
    </ul>
  );
}

export function MapIndexBody() {
  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="map-index-controls">
        <h3 id="map-index-controls" className={panelHeading}>
          Using the map
        </h3>
        <MapHelpList />
      </section>
      <section aria-labelledby="map-index-legend">
        <h3 id="map-index-legend" className={panelHeading}>
          What do the colors mean?
        </h3>
        <MapLegendList />
      </section>
    </div>
  );
}
