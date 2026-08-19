import type { StylesheetCSS } from "cytoscape";

/**
 * Nothing on this canvas is signalled by colour alone (spec 4.11).
 *
 * Every state that matters carries a second, non-colour channel: the entry
 * is the only ellipse, a decision point is the only diamond, a terminal
 * node is the only one with a doubled border, an archived placeholder and
 * an unreachable node are the only dashed ones, and a broken edge is the
 * only dotted one. Colour is there to make the same distinction faster for
 * people who can use it, never to be the distinction.
 *
 * The full legend is rendered as text in the sidebar, because a shape
 * vocabulary nobody can look up is not much better than colour alone.
 */
export const CANVAS_STYLE: StylesheetCSS[] = [
  {
    selector: "node",
    css: {
      shape: "round-rectangle",
      "background-color": "#f8fafc",
      "border-color": "#64748b",
      "border-width": 2,
      label: "data(label)",
      color: "#0f172a",
      "font-size": 13,
      "font-weight": 600,
      "text-valign": "center",
      "text-halign": "center",
      width: "label",
      height: 34,
      padding: "10px",
      "text-wrap": "none",
    },
  },
  {
    // The entry is the one node nothing has to point at for it to run, so
    // it gets the one shape nothing else uses.
    selector: "node[?isEntry]",
    css: {
      shape: "ellipse",
      "background-color": "#dbeafe",
      "border-color": "#1d4ed8",
      "border-width": 3,
    },
  },
  {
    selector: "node[?isDecision]",
    css: {
      shape: "diamond",
      "background-color": "#ede9fe",
      "border-color": "#6d28d9",
      height: 46,
      padding: "18px",
    },
  },
  {
    selector: "node[?isTerminal]",
    css: { "border-style": "double", "border-width": 5 },
  },
  {
    // Unreachable: nothing routes here, so the questionnaire never serves
    // it. Drawn faint and dashed rather than hidden -- it is a fault to
    // fix, not a node to tidy away.
    selector: "node[?isUnreachable]",
    css: {
      "border-style": "dashed",
      "background-color": "#fff7ed",
      "border-color": "#c2410c",
      opacity: 0.85,
    },
  },
  {
    selector: "node[?hasFault]",
    css: { "border-color": "#b91c1c" },
  },
  {
    selector: 'node[kind = "archived"]',
    css: {
      shape: "round-rectangle",
      "background-color": "#f1f5f9",
      "border-style": "dashed",
      "border-color": "#94a3b8",
      color: "#475569",
      "font-style": "italic",
    },
  },
  {
    selector: 'node[kind = "end"]',
    css: {
      shape: "round-tag",
      "background-color": "#e2e8f0",
      "border-color": "#475569",
      "border-style": "solid",
      "border-width": 2,
    },
  },
  {
    selector: 'node[kind = "missing"]',
    css: {
      shape: "octagon",
      "background-color": "#fee2e2",
      "border-color": "#b91c1c",
      "border-style": "dashed",
      "border-width": 3,
    },
  },
  {
    selector: "edge",
    css: {
      width: 2,
      "line-color": "#94a3b8",
      "target-arrow-color": "#94a3b8",
      "target-arrow-shape": "triangle",
      // Bowed apart by geometry, not by priority. Cytoscape spreads
      // parallel edges by how many share the same pair of endpoints, so
      // two arrows between the same questions stay legible; deriving the
      // bow from `priority` instead would move an arrow across the canvas
      // for a reorder that did not change where it goes.
      "curve-style": "bezier",
      "control-point-step-size": 48,
      label: "data(guard)",
      "font-size": 11,
      color: "#334155",
      "text-background-color": "#ffffff",
      "text-background-opacity": 0.9,
      "text-background-padding": "2px",
      "text-rotation": "autorotate",
    },
  },
  {
    selector: "edge[?isBack]",
    css: {
      "line-style": "solid",
      "line-color": "#7c3aed",
      "target-arrow-color": "#7c3aed",
    },
  },
  {
    // Guarded by an option the question does not offer, so it can never
    // fire. Dashed: present in the data, absent from the behaviour.
    selector: "edge[?isDead]",
    css: {
      "line-style": "dashed",
      "line-color": "#ea580c",
      "target-arrow-color": "#ea580c",
      opacity: 0.9,
    },
  },
  {
    // Points at something the resolver cannot serve. `_resolve_id` raises
    // on this, so it is a 500 waiting for the first respondent to pick
    // that answer -- the loudest thing on the canvas.
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
    css: { "border-color": "#0f172a", "border-width": 4, "overlay-opacity": 0.08 },
  },
  {
    selector: "edge:selected",
    css: { width: 4, "line-color": "#0f172a", "target-arrow-color": "#0f172a" },
  },
  {
    selector: ".dimmed",
    css: { opacity: 0.15 },
  },
  {
    selector: ".highlighted",
    css: { "overlay-color": "#facc15", "overlay-opacity": 0.25, "overlay-padding": 6 },
  },
];
