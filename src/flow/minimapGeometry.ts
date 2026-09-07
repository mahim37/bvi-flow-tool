import type { Rect } from "./canvasLayout";

export const MINIMAP_WIDTH = 176;
export const MINIMAP_HEIGHT = 120;
export const MINIMAP_PAD = 10;

export interface MiniTransform {
  s: number;
  ox: number;
  oy: number;
  x1: number;
  y1: number;
}

/** Scale the graph AABB into the minimap, letterboxed, with a margin. */
export function minimapTransform(
  graph: Rect,
  width: number,
  height: number,
  pad: number,
): MiniTransform {
  const innerW = Math.max(width - pad * 2, 1);
  const innerH = Math.max(height - pad * 2, 1);
  const gw = Math.max(graph.x2 - graph.x1, 1);
  const gh = Math.max(graph.y2 - graph.y1, 1);
  const s = Math.min(innerW / gw, innerH / gh);
  return {
    s,
    ox: pad + (innerW - gw * s) / 2,
    oy: pad + (innerH - gh * s) / 2,
    x1: graph.x1,
    y1: graph.y1,
  };
}

export function modelToMini(
  x: number,
  y: number,
  t: MiniTransform,
): { x: number; y: number } {
  return { x: (x - t.x1) * t.s + t.ox, y: (y - t.y1) * t.s + t.oy };
}

export function miniToModel(
  x: number,
  y: number,
  t: MiniTransform,
): { x: number; y: number } {
  return { x: (x - t.ox) / t.s + t.x1, y: (y - t.oy) / t.s + t.y1 };
}

/** Pan values that put model point (x, y) at the viewport centre. */
export function panToCenterModel(
  x: number,
  y: number,
  zoom: number,
  viewWidth: number,
  viewHeight: number,
): { x: number; y: number } {
  return { x: viewWidth / 2 - x * zoom, y: viewHeight / 2 - y * zoom };
}
