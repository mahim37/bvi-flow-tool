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
const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export const CANVAS_STYLE: StylesheetCSS[] = [
  {
    selector: "node",
    css: {
      shape: "round-rectangle",
      "corner-radius": "14",
      "background-color": "#ffffff",
      "border-color": "#d6c6a0",
      "border-width": 2,
      label: "data(label)",
      color: "#1a1a1a",
      "font-family": FONT,
      "font-size": 14,
      "font-weight": 700,
      "text-valign": "center",
      "text-halign": "center",
      width: "label",
      height: 38,
      padding: "14px",
      "text-wrap": "none",
    },
  },
  {
    // The entry is the one node nothing has to point at for it to run, so
    // it gets the one shape nothing else uses.
    selector: "node[?isEntry]",
    css: {
      shape: "ellipse",
      "background-color": "#e2ece4",
      "border-color": "#166534",
      "border-width": 3,
    },
  },
  {
    selector: "node[?isDecision]",
    css: {
      shape: "diamond",
      "background-color": "#f3e0d2",
      "border-color": "#9a5209",
      height: 50,
      padding: "20px",
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
      "background-color": "#f3e0d2",
      "border-color": "#9a3412",
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
      width: 2.5,
      "line-color": "#6f93f2",
      "target-arrow-color": "#6f93f2",
      "target-arrow-shape": "triangle",
      // Bowed apart by geometry, not by priority. Cytoscape spreads
      // parallel edges by how many share the same pair of endpoints, so
      // two arrows between the same questions stay legible; deriving the
      // bow from `priority` instead would move an arrow across the canvas
      // for a reorder that did not change where it goes.
      "curve-style": "bezier",
      "control-point-step-size": 48,
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
    selector: "edge[?isBack]",
    css: {
      "line-style": "solid",
      "line-color": "#c99568",
      "target-arrow-color": "#c99568",
    },
  },
  {
    // Guarded by an option the question does not offer, so it can never
    // fire. Dashed: present in the data, absent from the behaviour.
    selector: "edge[?isDead]",
    css: {
      "line-style": "dashed",
      "line-color": "#9a3412",
      "target-arrow-color": "#9a3412",
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
    // The one thick, warm border on the canvas: it should read as "this is
    // the thing you are looking at" from across the room, not just up
    // close.
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
  {
    selector: ".highlighted",
    css: { "overlay-color": "#9a5209", "overlay-opacity": 0.3, "overlay-padding": 6 },
  },
];
