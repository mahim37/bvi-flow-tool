/** Hover cards that replace a canvas label with the full wording at a
 * larger size. Geometry is in the cytoscape container's rendered pixels
 * so the card sits on the box or the arrow it belongs to. */

export const NODE_TIP_MAX_WIDTH = 400;
export const EDGE_TIP_MAX_WIDTH = 280;
/** Gap between hover cards that would otherwise sit on the same arrow. */
export const EDGE_TIP_STAGGER = 28;

export function guardIsTruncated(guard: unknown, fullGuard: unknown): boolean {
  return (
    typeof fullGuard === "string" &&
    typeof guard === "string" &&
    guard !== "" &&
    guard !== fullGuard
  );
}

export interface LabelTip {
  id: string;
  left: number;
  top: number;
  minWidth: number;
  maxWidth: number;
  text: string;
  color: string;
  role: "node" | "edge";
}

export interface ViewSize {
  width: number;
  height: number;
}

interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function clampTipPosition(
  left: number,
  top: number,
  width: number,
  view: ViewSize,
  margin = 8,
): { left: number; top: number } {
  const usable = Math.max(margin, view.width - 2 * margin);
  const clampedWidth = Math.min(width, usable);
  const maxLeft = Math.max(margin, view.width - clampedWidth - margin);
  const maxTop = Math.max(margin, view.height - 40 - margin);
  return {
    left: Math.min(Math.max(margin, left), maxLeft),
    top: Math.min(Math.max(margin, top), maxTop),
  };
}

export function labelTipForNodeData(
  node: {
    id: string;
    kind: string;
    collapsed?: boolean;
    isParent?: boolean;
    fullLabel: unknown;
    sectionColor: unknown;
    box: Rect;
  },
  view: ViewSize,
): LabelTip | null {
  if (node.kind === "section") return null;
  if (typeof node.fullLabel !== "string" || node.fullLabel === "") return null;
  const boxWidth = Math.max(0, node.box.x2 - node.box.x1);
  const minWidth = Math.max(boxWidth, 180);
  const pos = clampTipPosition(node.box.x1, node.box.y1, minWidth, view);
  return {
    id: node.id,
    left: pos.left,
    top: pos.top,
    minWidth,
    maxWidth: NODE_TIP_MAX_WIDTH,
    text: node.fullLabel,
    color: String(node.sectionColor ?? "#6b6355"),
    role: "node",
  };
}

export function labelTipForEdgeData(
  edge: {
    id: string;
    guard?: unknown;
    fullGuard: unknown;
    color?: string;
    mid: { x: number; y: number };
  },
  view: ViewSize,
): LabelTip | null {
  if (typeof edge.fullGuard !== "string" || edge.fullGuard === "") return null;
  const compact = typeof edge.guard === "string" ? edge.guard : "";
  // Short option pills ("Yes", "Both") already fit. Only replace the
  // native label when truncation cut the wording.
  if (!guardIsTruncated(compact, edge.fullGuard)) return null;
  const minWidth = Math.min(
    Math.max(72, Math.ceil(edge.fullGuard.length * 7.2) + 24),
    EDGE_TIP_MAX_WIDTH,
  );
  const pos = clampTipPosition(
    edge.mid.x - minWidth / 2,
    edge.mid.y - 14,
    minWidth,
    view,
  );
  return {
    id: edge.id,
    left: pos.left,
    top: pos.top,
    minWidth,
    maxWidth: EDGE_TIP_MAX_WIDTH,
    text: edge.fullGuard,
    color: edge.color ?? "#2f6fd6",
    role: "edge",
  };
}

function tipHeight(tip: LabelTip): number {
  if (tip.role === "node") return 72;
  const charsPerLine = Math.max(8, tip.minWidth / 7.2);
  const lines = Math.max(1, Math.ceil(tip.text.length / charsPerLine));
  return Math.max(28, lines * 18 + 14);
}

function tipRect(tip: LabelTip): Rect {
  return {
    x1: tip.left,
    y1: tip.top,
    x2: tip.left + tip.minWidth,
    y2: tip.top + tipHeight(tip),
  };
}

function rectsOverlap(a: Rect, b: Rect, pad: number): boolean {
  return !(
    a.x2 + pad <= b.x1 ||
    b.x2 + pad <= a.x1 ||
    a.y2 + pad <= b.y1 ||
    b.y2 + pad <= a.y1
  );
}

function laneOffset(lane: number, count: number, spacing: number): number {
  if (count < 2) return 0;
  return (lane - (count - 1) / 2) * spacing;
}

/** Fan a pile of edge cards off the same midpoint so "Both" / "Other"
 * do not stack. Horizontal first (typical downward bundle), then push
 * remaining collisions down. Node cards stay put. */
export function staggerEdgeTips(tips: LabelTip[], view: ViewSize): LabelTip[] {
  const nodeTips = tips.filter((tip) => tip.role === "node");
  const edgeTips = tips.filter((tip) => tip.role === "edge");
  if (edgeTips.length < 2) return tips;

  const sorted = [...edgeTips].sort((a, b) => a.top - b.top || a.left - b.left);
  const clusters: LabelTip[][] = [];
  const clusterPx = 48;
  for (const tip of sorted) {
    const cx = tip.left + tip.minWidth / 2;
    const cy = tip.top + tipHeight(tip) / 2;
    const last = clusters[clusters.length - 1];
    const seed = last?.[0];
    if (seed !== undefined && last !== undefined) {
      const sx = seed.left + seed.minWidth / 2;
      const sy = seed.top + tipHeight(seed) / 2;
      if (Math.hypot(cx - sx, cy - sy) < clusterPx) {
        last.push(tip);
        continue;
      }
    }
    clusters.push([tip]);
  }

  const fanned: LabelTip[] = [];
  for (const cluster of clusters) {
    if (cluster.length === 1) {
      const only = cluster[0];
      if (only !== undefined) fanned.push(only);
      continue;
    }
    const spacing = Math.max(
      EDGE_TIP_STAGGER,
      Math.max(...cluster.map((tip) => tip.minWidth)) + 10,
    );
    cluster.forEach((tip, index) => {
      const shift = laneOffset(index, cluster.length, spacing);
      const pos = clampTipPosition(tip.left + shift, tip.top, tip.minWidth, view);
      fanned.push({ ...tip, ...pos });
    });
  }

  const resolved: LabelTip[] = [];
  const blockers = () => [...resolved, ...nodeTips];
  const byTop = [...fanned].sort((a, b) => a.top - b.top || a.left - b.left);
  for (const tip of byTop) {
    let current = tip;
    let steps = 0;
    while (
      steps < 24 &&
      blockers().some((other) => rectsOverlap(tipRect(current), tipRect(other), 8))
    ) {
      steps += 1;
      const pos = clampTipPosition(
        current.left,
        current.top + EDGE_TIP_STAGGER,
        current.minWidth,
        view,
      );
      current = { ...current, ...pos };
    }
    resolved.push(current);
  }
  return [...nodeTips, ...resolved];
}
