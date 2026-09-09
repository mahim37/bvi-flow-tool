import type { StylesheetCSS } from "cytoscape";

import {
  edgeLabelScreenOffset,
  sourceEndpointSpec,
  targetEndpointSpec,
} from "./canvasLayout";

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
  // "added"/"changed" icon paths ported from break's own BADGE_ICON
  // (a plus, and a pencil) -- see `changeKind`'s doc comment in
  // graphElements.ts for what these mean.
  added: '<path d="M12 6v12M6 12h12" stroke-width="4"/>',
  changed:
    '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>',
};
// Structural badges share one neutral background; "added"/"changed" get
// this app's own green/gold tokens instead (`--green`/`--gold` in
// app.css) -- the same two colors `ReviewView`'s diff badges already use
// for "added"/"changed", not a fresh pair of hues.
const BADGE_BG: Record<string, string> = {
  entry: "#4a473f",
  terminal: "#4a473f",
  branch: "#4a473f",
  unreachable: "#4a473f",
  added: "#166534",
  changed: "#9a5209",
};

function badgeDataUri(kind: string): string {
  // width/height MUST be explicit -- without them an <img> defaults an
  // SVG's intrinsic size to 300x150 (the CSS replaced-element default),
  // which squishes a forced render into a distorted, non-circular badge.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
    `<circle cx="12" cy="12" r="11" fill="${BADGE_BG[kind] ?? BADGE_BG.entry}"/>` +
    // Icon paths nearly fill the 24x24 viewBox on their own -- scaled
    // down and re-centered so the badge circle stays dominant instead of
    // looking like the icon overflows it.
    `<g fill="none" stroke="#ffffff" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round" transform="translate(12 12) scale(0.55) translate(-12 -12)">${BADGE_ICON[kind]}</g>` +
    `</svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function toggleButtonUri(collapsed: boolean, fill: string): string {
  // Down chevron = expanded (click to collapse); right = collapsed.
  const icon = collapsed ? '<path d="M10 6l6 6-6 6"/>' : '<path d="M6 9l6 6 6-6"/>';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
    `<rect x="1" y="1" width="22" height="22" rx="5" fill="${fill}"/>` +
    `<g fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${icon}</g>` +
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
      "z-index": 10,
      "z-index-compare": "manual",
    },
  },
  {
    // Questions inside a section must paint above the compound fill.
    // z-index-compare: manual so a child at 20 wins over the parent at 0.
    // Do not use z-compound-depth: bottom — that layer steals mouse
    // events from the questions, which is why hover looked broken.
    selector: "$node > node",
    css: {
      "z-index": 20,
      "z-index-compare": "manual",
    },
  },
  {
    // Section chrome shared by the expanded compound and the collapsed
    // stand-in. Fill is tinted enough to tell sections apart, not a slab
    // over the questions. The chevron is a real control (see Canvas tap
    // hit-test); clicking the rest of the box does nothing.
    selector: 'node[kind = "section"]',
    css: {
      shape: "round-rectangle",
      "background-color": "data(sectionColor)",
      "background-opacity": 0.08,
      "border-color": "data(sectionColor)",
      "border-width": 1.5,
      "border-style": "solid",
      "border-opacity": 0.5,
      "text-valign": "top",
      "text-halign": "center",
      "text-margin-y": 28,
      "font-size": 15,
      "font-weight": 700,
      color: "data(sectionColor)",
      "text-wrap": "wrap",
      "text-max-width": "280px",
      "overlay-opacity": 0,
      "background-image": ((ele: { data: (name: string) => unknown }) =>
        toggleButtonUri(
          ele.data("collapsed") === true,
          String(ele.data("sectionColor") ?? "#6b6355"),
        )) as unknown as string,
      "background-fit": "none",
      "background-clip": "none",
      "background-width": "20px",
      "background-height": "20px",
      "background-position-x": "0%",
      "background-position-y": "0%",
      "background-offset-x": "10px",
      "background-offset-y": "10px",
      "background-repeat": "no-repeat",
    } as unknown as Record<string, string>,
  },
  {
    // Expanded section box. Must override the generic node's width/height
    // `label` sizing or the compound cannot grow around its children.
    // Padding is larger than a parallel-edge fan so option arrows stay
    // inside the box (compound bounds include nodes, not edges).
    selector: ":parent",
    css: {
      padding: "96px",
      "compound-sizing-wrt-labels": "include",
      "z-index": 0,
      "z-index-compare": "manual",
      "background-opacity": 0.08,
      "overlay-opacity": 0,
    },
  },
  {
    selector: 'node[kind = "section"][?collapsed]',
    css: {
      "background-opacity": 0.1,
      "border-opacity": 0.55,
      padding: "22px",
      "text-valign": "center",
      "text-margin-y": 0,
      width: 210,
      height: 88,
      "z-index": 20,
      "z-index-compare": "manual",
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
    selector: "node[badgeKind = 'added']",
    css: badgeStyle("added"),
  },
  {
    selector: "node[badgeKind = 'changed']",
    css: badgeStyle("changed"),
  },
  {
    // An open draft's own pending changes -- ported in spirit from
    // break's node.pending-new/.modified (a light tint fill plus a
    // coloured underlay glow, border left alone rather than fighting
    // section's own use of border-color). Archived questions never reach
    // this (see `buildElements`), so there's no clash with that state's
    // own tan/dashed treatment.
    selector: "node[changeKind = 'added']",
    css: {
      "border-style": "dashed",
      "background-color": "#e8f2e8",
      "underlay-color": "#166534",
      "underlay-opacity": 0.3,
      "underlay-padding": 8,
      "underlay-shape": "round-rectangle",
    } as unknown as Record<string, string>,
  },
  {
    selector: "node[changeKind = 'changed']",
    css: {
      "border-style": "dashed",
      "background-color": "#fbf0dd",
      "underlay-color": "#9a5209",
      "underlay-opacity": 0.3,
      "underlay-padding": 8,
      "underlay-shape": "round-rectangle",
    } as unknown as Record<string, string>,
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
      "control-point-step-size": 24,
      "edge-distances": "node-position",
      "z-index": 5,
      "z-index-compare": "manual",
      // Split from the old single `opacity: 0.6`: that dimmed the label
      // and its background right along with the line, capping how
      // opaque a white pill could ever look regardless of
      // text-background-opacity. `line-opacity` fades just the line;
      // `opacity` stays at 1 so the label renders at full strength.
      opacity: 1,
      "line-opacity": 0.6,
      label: "data(guard)",
      "font-family": FONT,
      "font-size": 11,
      "font-weight": 600,
      color: "#4a473f",
      // Solid white, rounded, rather than the cream canvas colour at
      // partial opacity: a label sitting on top of several crossing
      // edges and the dotted canvas background needs real contrast, not
      // a tint the same family as what's behind it.
      "text-background-color": "#ffffff",
      "text-background-opacity": 1,
      "text-background-shape": "roundrectangle",
      "text-background-padding": "3px",
      "text-rotation": "autorotate",
      // So hovering the truncated pill, not just the stroke, can select it.
      "text-events": "yes",
    },
  },
  {
    // Both ends live in the same expanded section. A wide bezier is what
    // leaked out of the category pad; keep the fan tight so the compound
    // AABB still contains the stroke.
    selector: "edge[?internal]",
    css: {
      "curve-style": "bezier",
      "control-point-step-size": 12,
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
    selector: "edge[?internal][?isBack]",
    css: {
      "control-point-distances": [16],
    },
  },
  {
    // Several arrows leaving or entering one node. Cytoscape percents on
    // `source-endpoint` are from the *centre* (`50%` y = bottom edge). A
    // CSS-like `20% 100%` sat a full height below the box, so four
    // options shared one origin, crossed, and stacked arrowheads inside
    // the target. Split at the nodes: one dock per edge along the facing
    // side, then a straight stroke to that dock (no mid-path bow).
    // Labels keep `autorotate` so they run along the stroke, same as a
    // lone option; `text-rotation: none` was what parked a fan of guards
    // as a horizontal stack beside the arrows.
    selector: "edge[outLaneCount > 1][!isBack], edge[inLaneCount > 1][!isBack]",
    css: {
      "curve-style": "straight",
      "source-endpoint": ((ele: { data: (name: string) => unknown }) =>
        sourceEndpointSpec(ele)) as unknown as string,
      "target-endpoint": ((ele: { data: (name: string) => unknown }) =>
        targetEndpointSpec(ele)) as unknown as string,
    } as unknown as Record<string, string>,
  },
  {
    // Autorotated pills sit on the path midpoint. Extra screen-Y stagger
    // was what dragged a diagonal bundle's labels onto neighbouring arrows.
    selector: "edge[laneCount > 1], edge[outLaneCount > 1], edge[inLaneCount > 1]",
    css: {
      "text-margin-x": ((ele: { data: (name: string) => unknown }) =>
        edgeLabelScreenOffset(ele).x) as unknown as number,
      "text-margin-y": ((ele: { data: (name: string) => unknown }) =>
        edgeLabelScreenOffset(ele).y) as unknown as number,
    } as unknown as Record<string, string>,
  },
  {
    // An open draft's own added/retargeted route -- break's single
    // dashed-gold "edge.pending" split into this app's own two-colour
    // added/changed language instead of one, matching the node treatment
    // above. Placed ahead of isDead/isBroken below so those diagnostics
    // (real problems, not just "not live yet") still win when both apply
    // to the same edge.
    selector: "edge[changeKind = 'added']",
    css: {
      "line-style": "dashed",
      "line-color": "#166534",
      "target-arrow-color": "#166534",
      opacity: 0.95,
    },
  },
  {
    selector: "edge[changeKind = 'changed']",
    css: {
      "line-style": "dashed",
      "line-color": "#9a5209",
      "target-arrow-color": "#9a5209",
      opacity: 0.95,
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
    // Hover must not change border-width or font-weight: nodes size to
    // their label, so a thicker border or bolder type grows the box and
    // shoves the wrapped prompt. Underlay is paint-only.
    selector: "node.hl[kind != 'section']",
    css: {
      "underlay-color": "#1c1a16",
      "underlay-opacity": 0.16,
      "underlay-padding": 5,
      "underlay-shape": "round-rectangle",
      "z-index": 30,
      "z-index-compare": "manual",
    } as unknown as Record<string, string>,
  },
  {
    selector: "node.hl[kind = 'section']",
    css: {
      "background-opacity": 0.14,
      "border-opacity": 0.75,
    },
  },
  {
    selector: "edge.hl",
    css: { opacity: 1, width: 2.6, "z-index": 35 },
  },
  {
    // Truncated option wording, same size and rotation as the resting
    // pill. Not a hover card — the label just stops using the ellipsis.
    selector: "edge.full-guard",
    css: {
      label: "data(fullGuard)",
    },
  },
  {
    // Hover HTML cards replace these; leaving the native text visible
    // would double the wording under the larger overlay.
    selector: ".expanded-label",
    css: {
      "text-opacity": 0,
      "text-background-opacity": 0,
    },
  },
];
