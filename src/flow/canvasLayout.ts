import type { Core, EdgeSingular, NodeSingular } from "cytoscape";

import { isSectionNode, isSyntheticNode } from "./graphElements";

/**
 * Dagre options for the map. rankSep has to be larger than a node's own
 * height or consecutive questions sit on top of each other; nodeSep is
 * the gap between siblings in one rank. edgeSep is for arrows that share
 * a rank with a node they skip past.
 *
 * `nodeDimensionsIncludeLabels` is the other half of the spacing: without
 * it dagre sizes a node by its unwrapped box and packs a two-line prompt
 * as if it were a square. Long skips that would still run through a
 * neighbour are handled after layout by sliding that neighbour off the
 * chord (`separateNodesFromEdges`) rather than bowing the arrow around
 * the canvas.
 */
export const LAYOUT = {
  name: "dagre",
  rankDir: "TB",
  nodeSep: 100,
  edgeSep: 140,
  rankSep: 200,
  nodeDimensionsIncludeLabels: true,
  animate: false,
  // Framing the opening view is done by hand (`fitToChainStart`), not
  // dagre's own fit-to-everything — a large questionnaire would otherwise
  // open shrunk down to unreadable text.
  fit: false,
  padding: 40,
} as const;

/** Cytoscape `fit()` and `width: "label"` measurement against a 0×0 box
 * crush the graph into a vertical sliver (minimap) and an empty viewport.
 * Anything under 8px is treated as "not laid out yet". */
export function containerHasUsableSize(width: number, height: number): boolean {
  return width >= 8 && height >= 8;
}

/** After a 0-size `fit()`, zoom/extent stay degenerate even once the
 * container has a real box — `cy.resize()` alone does not recover. */
export function cameraNeedsReframe(
  zoom: number,
  extent: { x1: number; y1: number; x2: number; y2: number },
): boolean {
  if (!Number.isFinite(zoom) || zoom <= 0) return true;
  const width = extent.x2 - extent.x1;
  const height = extent.y2 - extent.y1;
  return !Number.isFinite(width) || !Number.isFinite(height) || width < 8 || height < 8;
}

export interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Whether the open segment (x1,y1)→(x2,y2) crosses `rect`, grown by
 * `padding`. Liang–Barsky: a skip edge in a vertical chain is exactly
 * "the line between two nodes that are not neighbours, through the boxes
 * in between."
 */
export function segmentHitsRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rect: Rect,
  padding = 0,
): boolean {
  const left = rect.x1 - padding;
  const right = rect.x2 + padding;
  const top = rect.y1 - padding;
  const bottom = rect.y2 + padding;
  if (right < left || bottom < top) return false;

  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;

  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };

  return (
    clip(-dx, x1 - left) &&
    clip(dx, right - x1) &&
    clip(-dy, y1 - top) &&
    clip(dy, bottom - y1) &&
    t0 <= t1
  );
}

/**
 * Signed distance of `rect`'s farthest corner from the directed line
 * (x1,y1)→(x2,y2). Positive is to the right of the direction of travel.
 */
export function lineSideExtents(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rect: Rect,
): { left: number; right: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  let left = 0;
  let right = 0;
  const corners: [number, number][] = [
    [rect.x1, rect.y1],
    [rect.x2, rect.y1],
    [rect.x1, rect.y2],
    [rect.x2, rect.y2],
  ];
  for (const [px, py] of corners) {
    const perp = (dx * (py - y1) - dy * (px - x1)) / len;
    if (perp > 0) right = Math.max(right, perp);
    else left = Math.max(left, -perp);
  }
  return { left, right };
}

/**
 * `repositionNewSiblings` exists so a *newly added* question lands beside
 * its section rather than in dagre's disconnected-component pile. It is
 * wrong to run when the whole id set has been replaced — opening a draft
 * copies every question under a new UUID, Canvas stays mounted, and every
 * real node then looks "new". Expanding a collapsed section also adds
 * many question ids at once; those must get a real dagre layout, not the
 * one-new-question park-beside-anchor treatment.
 */
const MAX_INCREMENTAL_ADDS = 2;

export function shouldRepositionNewSiblings(
  previousIds: ReadonlySet<string>,
  currentIds: ReadonlySet<string>,
): boolean {
  if (previousIds.size === 0) return false;
  const added: string[] = [];
  let retainedReal = false;
  for (const id of currentIds) {
    if (isSyntheticNode(id) || isSectionNode(id)) continue;
    if (previousIds.has(id)) retainedReal = true;
    else added.push(id);
  }
  return retainedReal && added.length > 0 && added.length <= MAX_INCREMENTAL_ADDS;
}

function isSubsetOf(small: ReadonlySet<string>, large: ReadonlySet<string>): boolean {
  for (const id of small) {
    if (!large.has(id)) return false;
  }
  return true;
}

/** Collapse/expand hides or restores a section's questions; the boxes
 * stay. Layout still re-runs so leftover rank gaps close, but the camera
 * keeps its zoom — fitting the chain start again is what feels like a reset. */
export function isSectionCollapseToggle(
  previousIds: ReadonlySet<string>,
  currentIds: ReadonlySet<string>,
): boolean {
  if (previousIds.size === 0 || currentIds.size === 0) return false;

  const prevQuestions = new Set<string>();
  const currQuestions = new Set<string>();
  const prevSections = new Set<string>();
  const currSections = new Set<string>();
  for (const id of previousIds) {
    if (isSectionNode(id)) prevSections.add(id);
    else if (!isSyntheticNode(id)) prevQuestions.add(id);
  }
  for (const id of currentIds) {
    if (isSectionNode(id)) currSections.add(id);
    else if (!isSyntheticNode(id)) currQuestions.add(id);
  }
  if (prevSections.size === 0 || prevSections.size !== currSections.size) return false;
  for (const id of prevSections) {
    if (!currSections.has(id)) return false;
  }
  if (prevQuestions.size === currQuestions.size) return false;
  const [smaller, larger] =
    prevQuestions.size < currQuestions.size
      ? [prevQuestions, currQuestions]
      : [currQuestions, prevQuestions];
  if (!isSubsetOf(smaller, larger)) return false;
  // A single new question is an edit, not a collapse — that path still
  // gets `shouldRepositionNewSiblings` and a camera fit.
  return !shouldRepositionNewSiblings(previousIds, currentIds);
}

/** Ids that appeared in a `|`-joined key (collapsed section uuids). */
export function idsAddedToJoinedKey(previous: string, next: string): string[] {
  const prev = new Set(previous === "" ? [] : previous.split("|"));
  if (next === "") return [];
  return next.split("|").filter((id) => id !== "" && !prev.has(id));
}

/** Whether `rect` sits fully inside `extent`, with `padding` in the same
 * coordinate space (model units when used with `cy.extent()`). */
export function rectFullyInView(rect: Rect, extent: Rect, padding: number): boolean {
  return (
    rect.x1 >= extent.x1 + padding &&
    rect.y1 >= extent.y1 + padding &&
    rect.x2 <= extent.x2 - padding &&
    rect.y2 <= extent.y2 - padding
  );
}

const CLEARANCE = 16;
const MAX_SEPARATION_PASSES = 10;

/** Signed offset from the chord for a parallel bundle (`0` when there is
 * only one edge). Lane 0 is the leftmost (or topmost) in a 0..count-1
 * pack centered on the straight path. */
export function parallelLaneOffset(
  lane: number,
  count: number,
  spacing: number,
): number {
  if (count < 2) return 0;
  return (lane - (count - 1) / 2) * spacing;
}

export const PARALLEL_LABEL_STAGGER = 22;

/**
 * Screen-space nudge for an autorotated edge label.
 *
 * `text-margin-x/y` are unrotated pixels, then the pill spins around that
 * point. A vertical stagger on a diagonal bundle therefore slides every
 * label onto a neighbour's stroke. Docked fans already have distinct
 * path midpoints, so they get no extra margin. Undocked same-pair
 * beziers still share a chord — those get a perpendicular offset.
 */
export function edgeLabelScreenOffset(ele: {
  data: (name: string) => unknown;
  source?: () => { position: () => Point };
  target?: () => { position: () => Point };
}): Point {
  const outCount = ele.data("outLaneCount");
  const inCount = ele.data("inLaneCount");
  if (
    (typeof outCount === "number" && outCount > 1) ||
    (typeof inCount === "number" && inCount > 1)
  ) {
    return { x: 0, y: 0 };
  }

  const laneCount = ele.data("laneCount");
  const lane = ele.data("lane");
  if (typeof laneCount !== "number" || laneCount < 2 || typeof lane !== "number") {
    return { x: 0, y: 0 };
  }

  const distance = parallelLaneOffset(lane, laneCount, PARALLEL_LABEL_STAGGER);
  const source = ele.source?.().position();
  const target = ele.target?.().position();
  if (source === undefined || target === undefined) {
    return { x: 0, y: distance };
  }
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: (-dy / len) * distance, y: (dx / len) * distance };
}

/** Stations along the chord for a parallel bundle. Two identical offsets
 * (not one mid-path bow) so sibling strokes split and stay split. */
export const PARALLEL_LANE_WEIGHTS = [0.18, 0.82] as const;

/** Same perpendicular offset at both stations — a single mid control is
 * what pinched four “Mom / Dad / …” arrows into a bow-tie. */
export function parallelLaneDistances(
  lane: number,
  count: number,
  spacing: number,
): [number, number] {
  const offset = parallelLaneOffset(lane, count, spacing);
  return [offset, offset];
}

export interface Point {
  x: number;
  y: number;
}

/** Polyline for a parallel lane: source → offset@w0 → offset@w1 → target.
 * Used by tests (and as the model Cytoscape `round-segments` draws). */
export function parallelLanePolyline(
  source: Point,
  target: Point,
  lane: number,
  count: number,
  spacing: number,
): Point[] {
  const offset = parallelLaneOffset(lane, count, spacing);
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const len = Math.hypot(dx, dy) || 1;
  const rx = -dy / len;
  const ry = dx / len;
  const at = (weight: number): Point => ({
    x: source.x + dx * weight + rx * offset,
    y: source.y + dy * weight + ry * offset,
  });
  return [source, at(PARALLEL_LANE_WEIGHTS[0]), at(PARALLEL_LANE_WEIGHTS[1]), target];
}

export type DockSide = "top" | "bottom" | "left" | "right";

/** How far along a side docks may sit, as a percent of the node’s width
 * or height from its centre. Cytoscape `source-endpoint` / `target-endpoint`
 * percents are centre-relative: `50%` y is the bottom edge, `-50%` y is
 * the top — not CSS top-left. ±40 leaves the rounded corners free. */
export const DOCK_ALONG_SPAN = 40;

function isDockSide(value: unknown): value is DockSide {
  return value === "top" || value === "bottom" || value === "left" || value === "right";
}

function formatPct(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return `${rounded}%`;
}

/** Signed percent along a side (`-DOCK_ALONG_SPAN` … `+DOCK_ALONG_SPAN`),
 * centred when there is only one edge. */
export function dockAlongPercent(index: number, count: number): number {
  if (count <= 1) return 0;
  const t = index / (count - 1);
  return (t - 0.5) * 2 * DOCK_ALONG_SPAN;
}

/**
 * Cytoscape endpoint string for a slot on a node side. (0, 0) is the
 * node centre; do not emit `x% 100%` — that is a full height *below*
 * the centre, which is what bunched four arrows under the box.
 */
export function nodeSideEndpoint(index: number, count: number, side: DockSide): string {
  const along = formatPct(dockAlongPercent(index, count));
  switch (side) {
    case "bottom":
      return `${along} 50%`;
    case "top":
      return `${along} -50%`;
    case "right":
      return `50% ${along}`;
    case "left":
      return `-50% ${along}`;
  }
}

/** Matches `manualEndptToPx`: percent offsets are from the node centre. */
export function nodeDockPoint(
  center: Point,
  width: number,
  height: number,
  index: number,
  count: number,
  side: DockSide,
): Point {
  const along = dockAlongPercent(index, count) / 100;
  switch (side) {
    case "bottom":
      return { x: center.x + along * width, y: center.y + height / 2 };
    case "top":
      return { x: center.x + along * width, y: center.y - height / 2 };
    case "right":
      return { x: center.x + width / 2, y: center.y + along * height };
    case "left":
      return { x: center.x - width / 2, y: center.y + along * height };
  }
}

/** Leave from the side that faces the target (TB DAG → usually bottom). */
export function sourceDockSide(dx: number, dy: number): DockSide {
  if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? "bottom" : "top";
  return dx >= 0 ? "right" : "left";
}

/** Arrive on the side that faces the source (TB DAG → usually top). */
export function targetDockSide(dx: number, dy: number): DockSide {
  if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? "top" : "bottom";
  return dx >= 0 ? "left" : "right";
}

type EdgeDataReader = { data: (name: string) => unknown };

export function sourceEndpointSpec(ele: EdgeDataReader): string {
  const count = ele.data("outLaneCount");
  const lane = ele.data("outLane");
  const side = ele.data("sourceDockSide");
  if (
    typeof count !== "number" ||
    count < 2 ||
    typeof lane !== "number" ||
    !isDockSide(side)
  ) {
    return "outside-to-node";
  }
  return nodeSideEndpoint(lane, count, side);
}

export function targetEndpointSpec(ele: EdgeDataReader): string {
  const count = ele.data("inLaneCount");
  const lane = ele.data("inLane");
  const side = ele.data("targetDockSide");
  if (
    typeof count !== "number" ||
    count < 2 ||
    typeof lane !== "number" ||
    !isDockSide(side)
  ) {
    return "outside-to-node";
  }
  return nodeSideEndpoint(lane, count, side);
}

/** Same-pair docks: source slot → target slot, no shared pinch. */
export function dockedPairSegment(
  source: Point,
  sourceSize: { width: number; height: number },
  target: Point,
  targetSize: { width: number; height: number },
  lane: number,
  count: number,
): [Point, Point] {
  return [
    nodeDockPoint(source, sourceSize.width, sourceSize.height, lane, count, "bottom"),
    nodeDockPoint(target, targetSize.width, targetSize.height, lane, count, "top"),
  ];
}

/** Point at parameter `t` ∈ [0,1] along a polyline of equal segments. */
export function pointOnPolyline(points: readonly Point[], t: number): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0] ?? { x: 0, y: 0 };
  const clamped = Math.min(1, Math.max(0, t));
  const segs = points.length - 1;
  const scaled = clamped * segs;
  const index = Math.min(Math.floor(scaled), segs - 1);
  const local = scaled - index;
  const a = points[index];
  const b = points[index + 1];
  if (a === undefined || b === undefined) return points[0] ?? { x: 0, y: 0 };
  return { x: a.x + (b.x - a.x) * local, y: a.y + (b.y - a.y) * local };
}

/** Collapse control, in rendered pixels, matching the painted chevron. */
export const SECTION_TOGGLE_INSET = 8;
export const SECTION_TOGGLE_HIT = 24;

export function pointInSectionToggle(
  box: { x1: number; y1: number },
  point: { x: number; y: number },
): boolean {
  return (
    point.x >= box.x1 + SECTION_TOGGLE_INSET &&
    point.x <= box.x1 + SECTION_TOGGLE_INSET + SECTION_TOGGLE_HIT &&
    point.y >= box.y1 + SECTION_TOGGLE_INSET &&
    point.y <= box.y1 + SECTION_TOGGLE_INSET + SECTION_TOGGLE_HIT
  );
}

function edgePriorityId(cy: Core, a: string, b: string): number {
  const pa = cy.getElementById(a).data("priority");
  const pb = cy.getElementById(b).data("priority");
  if (typeof pa === "number" && typeof pb === "number" && pa !== pb) {
    return pa - pb;
  }
  return a.localeCompare(b);
}

function edgeDelta(edge: EdgeSingular): { dx: number; dy: number } {
  const source = edge.source().position();
  const target = edge.target().position();
  return { dx: target.x - source.x, dy: target.y - source.y };
}

function pushGrouped(groups: Map<string, string[]>, key: string, id: string): void {
  const list = groups.get(key);
  if (list) list.push(id);
  else groups.set(key, [id]);
}

/** Bundle index for same-pair edges (label stagger) plus per-side dock
 * slots so several arrows leaving or entering one node do not share a
 * corner. Slots are grouped by the side they actually use, so four
 * downward options spread along the bottom without stealing a slot from
 * a single rightward sibling. */
export function assignParallelEdgeLanes(cy: Core): void {
  const pairs = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  const sourceSide = new Map<string, DockSide>();
  const targetSide = new Map<string, DockSide>();

  cy.edges().forEach((edge) => {
    const id = edge.id();
    pushGrouped(pairs, `${edge.source().id()}->${edge.target().id()}`, id);
    if (edge.data("isBack") === true) return;
    const { dx, dy } = edgeDelta(edge);
    const srcSide = sourceDockSide(dx, dy);
    const tgtSide = targetDockSide(dx, dy);
    sourceSide.set(id, srcSide);
    targetSide.set(id, tgtSide);
    pushGrouped(outgoing, `${edge.source().id()}:${srcSide}`, id);
    pushGrouped(incoming, `${edge.target().id()}:${tgtSide}`, id);
  });

  cy.batch(() => {
    cy.edges().forEach((edge) => {
      edge.data({
        outLane: 0,
        outLaneCount: 1,
        inLane: 0,
        inLaneCount: 1,
      });
    });
    for (const ids of pairs.values()) {
      ids.sort((a, b) => edgePriorityId(cy, a, b));
      ids.forEach((id, index) => {
        cy.getElementById(id).data({ lane: index, laneCount: ids.length });
      });
    }
    const applySide = (
      groups: Map<string, string[]>,
      otherId: (id: string) => string,
      laneKey: "outLane" | "inLane",
      countKey: "outLaneCount" | "inLaneCount",
    ) => {
      for (const ids of groups.values()) {
        ids.sort((a, b) => {
          const oa = otherId(a);
          const ob = otherId(b);
          if (oa !== ob) return oa.localeCompare(ob);
          return edgePriorityId(cy, a, b);
        });
        ids.forEach((id, index) => {
          cy.getElementById(id).data({ [laneKey]: index, [countKey]: ids.length });
        });
      }
    };
    applySide(
      outgoing,
      (id) => cy.getElementById(id).target().id(),
      "outLane",
      "outLaneCount",
    );
    applySide(
      incoming,
      (id) => cy.getElementById(id).source().id(),
      "inLane",
      "inLaneCount",
    );
    for (const [id, side] of sourceSide) {
      cy.getElementById(id).data("sourceDockSide", side);
    }
    for (const [id, side] of targetSide) {
      cy.getElementById(id).data("targetDockSide", side);
    }
  });
}

function nodeRect(node: NodeSingular): Rect {
  const bb = node.boundingBox({ includeOverlays: false, includeLabels: true });
  return { x1: bb.x1, y1: bb.y1, x2: bb.x2, y2: bb.y2 };
}

function isExpandedSection(node: NodeSingular): boolean {
  return node.data("kind") === "section" && node.data("collapsed") !== true;
}

/**
 * How far to slide `rect` so the open segment (x1,y1)→(x2,y2) misses it
 * by `padding`. Null when they already miss. Pushes further along the
 * side the box already sits on (or to the left when it sits on the line)
 * so a chain of skips fans out instead of stacking.
 */
export function nudgeOffSegment(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rect: Rect,
  padding: number,
): { x: number; y: number } | null {
  if (!segmentHitsRect(x1, y1, x2, y2, rect, padding)) return null;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const rx = -dy / len;
  const ry = dx / len;
  const cx = (rect.x1 + rect.x2) / 2;
  const cy = (rect.y1 + rect.y2) / 2;
  const cross = dx * (cy - y1) - dy * (cx - x1);
  const side = cross >= 0 ? 1 : -1;
  const extent = lineSideExtents(x1, y1, x2, y2, rect);
  // +1 so the moved box is strictly off the padded line; otherwise
  // Liang–Barsky still counts the shared boundary as a hit and the
  // separation loop spends every pass shoving the same node.
  const overlap = (side > 0 ? extent.left : extent.right) + padding + 1;
  return { x: rx * side * overlap, y: ry * side * overlap };
}

function strongerShift(
  current: { x: number; y: number },
  next: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: Math.abs(next.x) > Math.abs(current.x) ? next.x : current.x,
    y: Math.abs(next.y) > Math.abs(current.y) ? next.y : current.y,
  };
}

/**
 * After dagre, slide any question that sits on another question's chord
 * off that line. The canvas is unbounded, so a lateral nudge is cheaper
 * to read than a long bowed arrow. Expanded section boxes are not moved
 * — their children are, and the compound grows to keep those edges
 * inside the pad.
 *
 * Marks `internal` on edges whose ends share a section so they can stay
 * almost straight (a wide bezier is what leaked out of the category box).
 * Parallel arrows between the same pair get a `lane` so they can fan.
 */
export function separateNodesFromEdges(cy: Core): void {
  cy.edges().forEach((edge) => {
    edge.removeData("bow");
    const sourceParent = edge.source().data("parent");
    const targetParent = edge.target().data("parent");
    const internal = typeof sourceParent === "string" && sourceParent === targetParent;
    edge.data("internal", internal);
  });
  assignParallelEdgeLanes(cy);

  for (let pass = 0; pass < MAX_SEPARATION_PASSES; pass += 1) {
    const shifts = new Map<string, { x: number; y: number }>();
    cy.edges().forEach((edge) => {
      if (edge.data("isBack") === true) return;
      const source = edge.source();
      const target = edge.target();
      const s = source.position();
      const t = target.position();
      cy.nodes().forEach((node) => {
        if (node.id() === source.id() || node.id() === target.id()) return;
        if (isExpandedSection(node)) return;
        const parentId = node.data("parent") as string | undefined;
        if (parentId === source.id() || parentId === target.id()) return;
        const shift = nudgeOffSegment(s.x, s.y, t.x, t.y, nodeRect(node), CLEARANCE);
        if (shift === null) return;
        const current = shifts.get(node.id());
        shifts.set(
          node.id(),
          current === undefined ? shift : strongerShift(current, shift),
        );
      });
    });
    if (shifts.size === 0) break;
    cy.batch(() => {
      for (const [id, shift] of shifts) {
        const node = cy.getElementById(id);
        if (node.empty()) continue;
        const pos = node.position();
        node.position({ x: pos.x + shift.x, y: pos.y + shift.y });
      }
    });
  }
}

export function runGraphLayout(cy: Core): void {
  cy.layout({ ...LAYOUT }).run();
  separateNodesFromEdges(cy);
}
