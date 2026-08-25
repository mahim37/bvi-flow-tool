import type { StylesheetCSS } from "cytoscape";

/**
 * Ported from break-backend's question_graph_editor
 * (static/question_graph_editor/app.js, the STYLE array and the
 * badge-related BADGE_ICON/BADGE_BG helpers) for visual parity -- node
 * typography/sizing, the section-color border, the corner-badge system
 * for structural facts, and the edge palette are copied value-for-value
 * from that source, not approximated.
 *
 * Two things are still not signalled by colour alone (spec 4.11), same
 * principle break itself states, just carried by a different mechanism
 * here: a badge icon (not a border colour, which is section's alone) for
 * entry/terminal/branch/unreachable, and a shape/line-style change for
 * archived/end/missing/dead/broken. The full legend is rendered as text
 * in the sidebar, because a vocabulary nobody can look up is not much
 * better than colour alone.
 *
 * One deliberate deviation: `hasFault`/dead/broken edges are this app's
 * own diagnostics (`dead_edge_ids`/`broken_edge_ids`), which break's own
 * model has no equivalent for -- so unlike everything else here, their
 * styling isn't a port, it's this app's pre-existing treatment, left
 * alone rather than invented a break equivalent for.
 */
const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// ---------------------------------------------------------------------------
// Corner badges: a small circular icon rendered as a Cytoscape
// background-image, pinned to the node's top-right corner. Icon paths,
// colors and the exact positioning/sizing below are break's own --
// getting a badge to render as a circle (not squashed) and to stay
// visible at all (not silently dropped) took real, undocumented-quirk
// iteration on their end; copied rather than re-derived.
// ---------------------------------------------------------------------------

const BADGE_ICON: Record<string, string> = {
  entry: '<path d="M5 21V3"/><path d="M5 4h13l-3 5 3 5H5"/>',
  terminal: '<rect x="7" y="7" width="10" height="10" rx="1.5"/>',
  branch:
    '<circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M6 9v1a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V9"/>',
  unreachable: '<path d="M12 3L2 21h20L12 3z"/><path d="M12 10v4"/>',
};
const BADGE_BG = "#4a473f";

function badgeDataUri(kind: string): string {
  // width/height MUST be explicit -- without them an <img> defaults an
  // SVG's intrinsic size to 300x150 (the CSS replaced-element default),
  // which squishes a forced render into a distorted, non-circular badge.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
    `<circle cx="12" cy="12" r="11" fill="${BADGE_BG}"/>` +
    // Icon paths nearly fill the 24x24 viewBox on their own -- scaled
    // down and re-centered so the badge circle stays dominant instead of
    // looking like the icon overflows it.
    `<g fill="none" stroke="#ffffff" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round" transform="translate(12 12) scale(0.55) translate(-12 -12)">${BADGE_ICON[kind]}</g>` +
    `</svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function badgeStyle(kind: string): Record<string, string> {
  // Every larger offset (11px, 14px, 22px, all tried on break's end)
  // made their vendored Cytoscape build silently stop rendering the
  // badge entirely, rather than clip it -- a small nudge stayed visible,
  // so that's the room available to pull the badge in off the corner.
  return {
    "background-image": badgeDataUri(kind),
    "background-fit": "none",
    "background-width": "13px",
    "background-height": "13px",
    "background-position-x": "100%",
    "background-position-y": "0%",
    "background-offset-x": "-4px",
    "background-offset-y": "4px",
    "background-repeat": "no-repeat",
  } as unknown as Record<string, string>;
}

export const CANVAS_STYLE: StylesheetCSS[] = [
  {
    // Section is carried by border color alone -- every node gets the
    // same neutral white fill, so nothing on canvas double-encodes
    // section AND state as color at once.
    selector: "node",
    css: {
      shape: "round-rectangle",
      "background-color": "#ffffff",
      "border-color": "data(sectionColor)",
      "border-width": 2.5,
      "border-opacity": 0.9,
      label: "data(label)",
      color: "#1c1a16",
      "font-family": FONT,
      "font-size": 10.5,
      "font-weight": 500,
      "text-valign": "center",
      "text-halign": "center",
      "text-wrap": "wrap",
      "text-max-width": "150px",
      "line-height": 1.28,
      width: "label",
      height: "label",
      padding: "18px",
    },
  },
  {
    selector: "node[badgeKind = 'entry']",
    css: badgeStyle("entry"),
  },
  {
    selector: "node[badgeKind = 'terminal']",
    css: badgeStyle("terminal"),
  },
  {
    selector: "node[badgeKind = 'branch']",
    css: badgeStyle("branch"),
  },
  {
    selector: "node[badgeKind = 'unreachable']",
    css: badgeStyle("unreachable"),
  },
  {
    // This app's own fault diagnostic (dead/broken edges leaving this
    // question), no break equivalent -- see the file docstring.
    selector: "node[?hasFault]",
    css: { "border-color": "#b91c1c" },
  },
  {
    selector: 'node[kind = "archived"]',
    css: {
      shape: "round-rectangle",
      "background-color": "#f1e7d2",
      "border-style": "dashed",
      "border-color": "#d6c6a0",
      color: "#766c5c",
      "font-style": "italic",
    },
  },
  {
    selector: 'node[kind = "end"]',
    css: {
      shape: "round-tag",
      "background-color": "#f1e7d2",
      "border-color": "#766c5c",
      "border-style": "solid",
      "border-width": 2,
    },
  },
  {
    selector: 'node[kind = "missing"]',
    css: {
      shape: "octagon",
      "background-color": "#fbe2dc",
      "border-color": "#b91c1c",
      "border-style": "dashed",
      "border-width": 3,
    },
  },
  {
    selector: "edge",
    css: {
      width: 1.6,
      "line-color": "#2f6fd6",
      "target-arrow-color": "#2f6fd6",
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.95,
      "curve-style": "bezier",
      opacity: 0.6,
      label: "data(guard)",
      "font-family": FONT,
      "font-size": 11,
      "font-weight": 600,
      color: "#4a473f",
      "text-background-color": "#faf5ec",
      "text-background-opacity": 0.9,
      "text-background-padding": "2px",
      "text-rotation": "autorotate",
    },
  },
  {
    // Break's own stance, quoted in their comment: a back-edge stays
    // identifiable by its curved routing, not by hue -- color is not
    // spent on it.
    selector: "edge[?isBack]",
    css: {
      "curve-style": "unbundled-bezier",
      "control-point-distances": [40],
      "control-point-weights": [0.5],
    },
  },
  {
    // Guarded by an option the question does not offer, so it can never
    // fire. Dashed: present in the data, absent from the behaviour. This
    // app's own diagnostic -- see the file docstring.
    selector: "edge[?isDead]",
    css: {
      "line-style": "dashed",
      "line-color": "#9a3412",
      "target-arrow-color": "#9a3412",
      opacity: 0.9,
    },
  },
  {
    // Points at something the resolver cannot serve -- a 500 waiting for
    // the first respondent to pick that answer. The loudest thing on the
    // canvas. This app's own diagnostic -- see the file docstring.
    selector: "edge[?isBroken]",
    css: {
      "line-style": "dotted",
      width: 3,
      "line-color": "#b91c1c",
      "target-arrow-color": "#b91c1c",
    },
  },
  {
    selector: "node:selected",
    css: {
      "border-color": "#9a3412",
      "border-width": 5,
      "overlay-opacity": 0,
    },
  },
  {
    selector: "edge:selected",
    css: { width: 4, "line-color": "#1a1a1a", "target-arrow-color": "#1a1a1a" },
  },
  {
    selector: ".dimmed",
    css: { opacity: 0.15 },
  },
  // Hover-to-trace: not ported when the rest of this file was (see the
  // docstring above) -- added later to fade every edge/node except the
  // hovered node's own connected ones, matching break's own hover
  // behaviour value-for-value (app.js's ".faded"/".hl"/"edge.hl" rules).
  {
    selector: ".faded",
    css: { opacity: 0.32 },
  },
  {
    selector: "edge.faded",
    css: { opacity: 0.2 },
  },
  {
    selector: "node.hl",
    css: { "border-width": 3.5, "z-index": 30, "font-weight": 600 },
  },
  {
    selector: "edge.hl",
    css: { opacity: 1, width: 2.6, "z-index": 35 },
  },
];
