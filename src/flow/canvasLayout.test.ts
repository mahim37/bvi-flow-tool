import { describe, expect, it } from "vitest";
import cytoscape from "cytoscape";

import { END_NODE_ID, missingNodeId, sectionNodeId } from "./graphElements";
import {
  assignParallelEdgeLanes,
  cameraNeedsReframe,
  containerHasUsableSize,
  dockAlongPercent,
  dockedPairSegment,
  isSectionCollapseToggle,
  lineSideExtents,
  nodeDockPoint,
  nodeSideEndpoint,
  nudgeOffSegment,
  parallelLaneDistances,
  parallelLaneOffset,
  parallelLanePolyline,
  pointInSectionToggle,
  pointOnPolyline,
  segmentHitsRect,
  separateNodesFromEdges,
  shouldRepositionNewSiblings,
  sourceDockSide,
  sourceEndpointSpec,
  targetDockSide,
  targetEndpointSpec,
} from "./canvasLayout";

const BOX = { x1: -20, y1: 40, x2: 20, y2: 80 };

describe("containerHasUsableSize", () => {
  it("rejects a collapsed flex/grid box", () => {
    expect(containerHasUsableSize(0, 800)).toBe(false);
    expect(containerHasUsableSize(1200, 0)).toBe(false);
    expect(containerHasUsableSize(1, 1)).toBe(false);
  });

  it("accepts a real canvas pane", () => {
    expect(containerHasUsableSize(800, 600)).toBe(true);
  });
});

describe("cameraNeedsReframe", () => {
  it("is true after fit() into a 0-width container", () => {
    expect(cameraNeedsReframe(1e50, { x1: 0, y1: 0, x2: 0.001, y2: 4000 })).toBe(true);
  });

  it("is false for a normal reading viewport", () => {
    expect(cameraNeedsReframe(0.8, { x1: 0, y1: 0, x2: 800, y2: 600 })).toBe(false);
  });
});

describe("segmentHitsRect", () => {
  it("hits a box sitting on a vertical skip", () => {
    // Source at y=0, target at y=120, obstacle in between — the screenshot
    // case of a fallback drawn through the questions it skips.
    expect(segmentHitsRect(0, 0, 0, 120, BOX)).toBe(true);
  });

  it("misses a box sitting beside the line", () => {
    expect(segmentHitsRect(0, 0, 0, 120, { x1: 40, y1: 40, x2: 80, y2: 80 })).toBe(
      false,
    );
  });

  it("misses a box that is past the target", () => {
    expect(segmentHitsRect(0, 0, 0, 30, BOX)).toBe(false);
  });

  it("grows the box by padding so a near-miss still counts", () => {
    expect(segmentHitsRect(0, 0, 0, 120, { x1: 8, y1: 40, x2: 40, y2: 80 }, 16)).toBe(
      true,
    );
  });
});

describe("shouldRepositionNewSiblings", () => {
  it("does not run on the first layout, when there is no previous graph", () => {
    expect(shouldRepositionNewSiblings(new Set(), new Set(["q1", "q2"]))).toBe(false);
  });

  it("runs when a question is added to the graph already on the canvas", () => {
    expect(
      shouldRepositionNewSiblings(new Set(["q1", "q2"]), new Set(["q1", "q2", "q3"])),
    ).toBe(true);
  });

  it("does not run when every real id is new — opening a draft copy", () => {
    // Drafts copy questions under new UUIDs. Canvas stays mounted, so the
    // previous set is the published version. The shared end node would
    // look like overlap if synthetic ids counted.
    expect(
      shouldRepositionNewSiblings(
        new Set(["live-q1", "live-q2", END_NODE_ID]),
        new Set(["draft-q1", "draft-q2", END_NODE_ID]),
      ),
    ).toBe(false);
  });

  it("ignores a missing-question placeholder the same way as the end node", () => {
    const missing = missingNodeId("gone");
    expect(
      shouldRepositionNewSiblings(
        new Set(["live-q1", missing]),
        new Set(["draft-q1", missing]),
      ),
    ).toBe(false);
  });

  it("does not run when expanding a collapsed section adds many questions", () => {
    const section = sectionNodeId("intro");
    const previous = new Set(["q1", "q2", section]);
    const current = new Set(["q1", "q2", "q3", "q4", "q5", section]);
    expect(shouldRepositionNewSiblings(previous, current)).toBe(false);
  });
});

describe("isSectionCollapseToggle", () => {
  const section = sectionNodeId("intro");

  it("is true when a section's questions disappear (collapse)", () => {
    expect(
      isSectionCollapseToggle(
        new Set(["q1", "q2", "q3", "q4", section]),
        new Set(["q1", section]),
      ),
    ).toBe(true);
  });

  it("is true when those questions come back (expand)", () => {
    expect(
      isSectionCollapseToggle(
        new Set(["q1", section]),
        new Set(["q1", "q2", "q3", "q4", section]),
      ),
    ).toBe(true);
  });

  it("is false when opening a draft replaces every question id", () => {
    expect(
      isSectionCollapseToggle(
        new Set(["live-q1", "live-q2", section, END_NODE_ID]),
        new Set(["draft-q1", "draft-q2", section, END_NODE_ID]),
      ),
    ).toBe(false);
  });

  it("is false when a single question is added", () => {
    expect(
      isSectionCollapseToggle(
        new Set(["q1", "q2", section]),
        new Set(["q1", "q2", "q3", section]),
      ),
    ).toBe(false);
  });

  it("is true when a small section's questions disappear", () => {
    expect(
      isSectionCollapseToggle(
        new Set(["q1", "q2", "q3", section]),
        new Set(["q1", section]),
      ),
    ).toBe(true);
  });

  it("is false when only two questions reappear — that looks like an edit", () => {
    // Canvas still keeps the camera: MapView passes collapsedSectionKey.
    expect(
      isSectionCollapseToggle(
        new Set(["q1", section]),
        new Set(["q1", "q2", "q3", section]),
      ),
    ).toBe(false);
  });
});

describe("lineSideExtents", () => {
  it("reports a box sitting on a downward line as equal left and right half-widths", () => {
    const extent = lineSideExtents(0, 0, 0, 200, { x1: -40, y1: 60, x2: 40, y2: 100 });
    expect(extent.left).toBeCloseTo(40);
    expect(extent.right).toBeCloseTo(40);
  });
});

describe("nudgeOffSegment", () => {
  const padding = 8;

  it("returns null when the box already misses the chord", () => {
    expect(
      nudgeOffSegment(0, 0, 0, 120, { x1: 40, y1: 40, x2: 80, y2: 80 }, padding),
    ).toBeNull();
  });

  it("slides a box sitting on a vertical skip until the chord misses it", () => {
    const rect = { ...BOX };
    const shift = nudgeOffSegment(0, 0, 0, 120, rect, padding);
    expect(shift).not.toBeNull();
    const moved = {
      x1: rect.x1 + shift!.x,
      y1: rect.y1 + shift!.y,
      x2: rect.x2 + shift!.x,
      y2: rect.y2 + shift!.y,
    };
    expect(segmentHitsRect(0, 0, 0, 120, moved, padding)).toBe(false);
    expect(shift!.y).toBeCloseTo(0);
    expect(Math.abs(shift!.x)).toBeCloseTo(29);
  });

  it("pushes a box already on the right further right", () => {
    const rect = { x1: -8, y1: 40, x2: 32, y2: 80 };
    const shift = nudgeOffSegment(0, 0, 0, 120, rect, padding);
    expect(shift).not.toBeNull();
    expect(shift!.x).toBeGreaterThan(0);
  });
});

describe("separateNodesFromEdges", () => {
  it("slides a node off a skip chord and marks same-section edges internal", () => {
    const cy = cytoscape({
      headless: true,
      styleEnabled: true,
      layout: { name: "preset" },
      style: [{ selector: "node", style: { width: 40, height: 40 } }],
      elements: [
        { data: { id: "sec", kind: "section" } },
        { data: { id: "a", parent: "sec" }, position: { x: 0, y: 0 } },
        { data: { id: "b", parent: "sec" }, position: { x: 0, y: 80 } },
        { data: { id: "c", parent: "sec" }, position: { x: 0, y: 160 } },
        { data: { id: "skip", source: "a", target: "c" } },
      ],
    });

    separateNodesFromEdges(cy);

    expect(cy.getElementById("skip").data("internal")).toBe(true);
    expect(cy.getElementById("a").position()).toEqual({ x: 0, y: 0 });
    expect(cy.getElementById("c").position()).toEqual({ x: 0, y: 160 });
    expect(cy.getElementById("b").position().x).not.toBe(0);
  });
});

describe("parallelLaneOffset", () => {
  it("is zero when there is only one edge", () => {
    expect(parallelLaneOffset(0, 1, 64)).toBe(0);
  });

  it("centers a three-edge bundle on the chord", () => {
    expect(parallelLaneOffset(0, 3, 64)).toBe(-64);
    expect(parallelLaneOffset(1, 3, 64)).toBe(0);
    expect(parallelLaneOffset(2, 3, 64)).toBe(64);
  });
});

describe("pointInSectionToggle", () => {
  const box = { x1: 100, y1: 50, x2: 400, y2: 300 };

  it("hits the top-left chevron, not the rest of the box", () => {
    expect(pointInSectionToggle(box, { x: 118, y: 68 })).toBe(true);
    expect(pointInSectionToggle(box, { x: 250, y: 180 })).toBe(false);
    expect(pointInSectionToggle(box, { x: 90, y: 68 })).toBe(false);
  });
});

describe("parallelLaneDistances", () => {
  it("repeats the same offset so a lane is a split, not a mid-path bow", () => {
    expect(parallelLaneDistances(0, 4, 56)).toEqual([-84, -84]);
    expect(parallelLaneDistances(3, 4, 56)).toEqual([84, 84]);
  });
});

describe("parallelLanePolyline", () => {
  const source = { x: 0, y: 0 };
  const target = { x: 0, y: 400 };
  const spacing = 48;

  it("keeps sibling lanes apart along the whole path, not only at the midpoint", () => {
    const lanes = [0, 1, 2, 3].map((lane) =>
      parallelLanePolyline(source, target, lane, 4, spacing),
    );
    const first = lanes[0];
    if (first === undefined) throw new Error("expected four lanes");
    // Both interior stations share an x — a quadratic mid-control would
    // pull every stroke through one waist (the screenshot bow-tie).
    expect(first[1]?.x).toBeCloseTo(first[2]?.x ?? NaN);

    for (const t of [0.4, 0.5, 0.6]) {
      const xs = lanes.map((lane) => pointOnPolyline(lane, t).x);
      for (let i = 1; i < xs.length; i += 1) {
        const prev = xs[i - 1];
        const next = xs[i];
        if (prev === undefined || next === undefined) continue;
        expect(Math.abs(next - prev)).toBeGreaterThan(spacing * 0.99);
      }
    }
  });

  it("does not share a midpoint across a four-edge bundle", () => {
    const mids = [0, 1, 2, 3].map(
      (lane) =>
        pointOnPolyline(parallelLanePolyline(source, target, lane, 4, spacing), 0.5).x,
    );
    expect(new Set(mids.map((x) => Math.round(x * 100))).size).toBe(4);
  });
});

describe("assignParallelEdgeLanes", () => {
  it("numbers edges that share a source and target", () => {
    const cy = cytoscape({
      headless: true,
      styleEnabled: true,
      layout: { name: "preset" },
      elements: [
        { data: { id: "a" }, position: { x: 0, y: 0 } },
        { data: { id: "b" }, position: { x: 0, y: 100 } },
        { data: { id: "e1", source: "a", target: "b", priority: 2 } },
        { data: { id: "e2", source: "a", target: "b", priority: 1 } },
        { data: { id: "e3", source: "a", target: "b", priority: 3 } },
      ],
    });

    assignParallelEdgeLanes(cy);

    expect(cy.getElementById("e2").data("lane")).toBe(0);
    expect(cy.getElementById("e1").data("lane")).toBe(1);
    expect(cy.getElementById("e3").data("lane")).toBe(2);
    expect(cy.getElementById("e1").data("laneCount")).toBe(3);
  });

  it("spreads same-pair docks along the source bottom and target top", () => {
    const cy = cytoscape({
      headless: true,
      styleEnabled: true,
      layout: { name: "preset" },
      elements: [
        { data: { id: "a" }, position: { x: 0, y: 0 } },
        { data: { id: "b" }, position: { x: 0, y: 200 } },
        { data: { id: "e1", source: "a", target: "b", priority: 1 } },
        { data: { id: "e2", source: "a", target: "b", priority: 2 } },
        { data: { id: "e3", source: "a", target: "b", priority: 3 } },
        { data: { id: "e4", source: "a", target: "b", priority: 4 } },
      ],
    });

    assignParallelEdgeLanes(cy);

    const ids = ["e1", "e2", "e3", "e4"];
    const outLanes = ids.map((id) => cy.getElementById(id).data("outLane") as number);
    const inLanes = ids.map((id) => cy.getElementById(id).data("inLane") as number);
    expect(new Set(outLanes).size).toBe(4);
    expect(new Set(inLanes).size).toBe(4);
    expect(cy.getElementById("e1").data("outLaneCount")).toBe(4);
    expect(cy.getElementById("e1").data("inLaneCount")).toBe(4);
    expect(cy.getElementById("e1").data("sourceDockSide")).toBe("bottom");
    expect(cy.getElementById("e1").data("targetDockSide")).toBe("top");

    const sourceEnds = ids.map((id) => sourceEndpointSpec(cy.getElementById(id)));
    const targetEnds = ids.map((id) => targetEndpointSpec(cy.getElementById(id)));
    expect(new Set(sourceEnds).size).toBe(4);
    expect(new Set(targetEnds).size).toBe(4);
    for (const spec of sourceEnds) {
      expect(spec.endsWith(" 50%")).toBe(true);
      expect(spec.includes("100%")).toBe(false);
    }
    for (const spec of targetEnds) {
      expect(spec.endsWith(" -50%")).toBe(true);
      expect(spec.includes(" 0%")).toBe(false);
    }
  });

  it("spreads many-to-one arrivals along the shared target side", () => {
    const cy = cytoscape({
      headless: true,
      styleEnabled: true,
      layout: { name: "preset" },
      elements: [
        { data: { id: "a" }, position: { x: -80, y: 0 } },
        { data: { id: "b" }, position: { x: 0, y: 0 } },
        { data: { id: "c" }, position: { x: 80, y: 0 } },
        { data: { id: "t" }, position: { x: 0, y: 220 } },
        { data: { id: "e1", source: "a", target: "t", priority: 1 } },
        { data: { id: "e2", source: "b", target: "t", priority: 1 } },
        { data: { id: "e3", source: "c", target: "t", priority: 1 } },
      ],
    });

    assignParallelEdgeLanes(cy);

    expect(cy.getElementById("e1").data("laneCount")).toBe(1);
    expect(cy.getElementById("e1").data("outLaneCount")).toBe(1);
    expect(cy.getElementById("e1").data("inLaneCount")).toBe(3);
    expect(sourceEndpointSpec(cy.getElementById("e1"))).toBe("outside-to-node");

    const inLanes = ["e1", "e2", "e3"].map(
      (id) => cy.getElementById(id).data("inLane") as number,
    );
    expect(new Set(inLanes).size).toBe(3);
    const targetEnds = ["e1", "e2", "e3"].map((id) =>
      targetEndpointSpec(cy.getElementById(id)),
    );
    expect(new Set(targetEnds).size).toBe(3);
    expect(cy.getElementById("e2").data("targetDockSide")).toBe("top");
  });

  it("spreads one-to-many departures along the shared source side", () => {
    const cy = cytoscape({
      headless: true,
      styleEnabled: true,
      layout: { name: "preset" },
      elements: [
        { data: { id: "a" }, position: { x: 0, y: 0 } },
        { data: { id: "b" }, position: { x: -60, y: 200 } },
        { data: { id: "c" }, position: { x: 60, y: 200 } },
        { data: { id: "e1", source: "a", target: "b", priority: 1 } },
        { data: { id: "e2", source: "a", target: "c", priority: 1 } },
      ],
    });

    assignParallelEdgeLanes(cy);

    expect(cy.getElementById("e1").data("outLaneCount")).toBe(2);
    expect(cy.getElementById("e1").data("inLaneCount")).toBe(1);
    expect(cy.getElementById("e1").data("outLane")).not.toBe(
      cy.getElementById("e2").data("outLane"),
    );
    expect(sourceEndpointSpec(cy.getElementById("e1"))).not.toBe(
      sourceEndpointSpec(cy.getElementById("e2")),
    );
    expect(targetEndpointSpec(cy.getElementById("e1"))).toBe("outside-to-node");
  });
});

describe("node side docks", () => {
  it("uses centre-relative percents on the node border, not CSS top-left", () => {
    expect(nodeSideEndpoint(0, 4, "bottom")).toBe("-40% 50%");
    expect(nodeSideEndpoint(3, 4, "bottom")).toBe("40% 50%");
    expect(nodeSideEndpoint(0, 4, "top")).toBe("-40% -50%");
    expect(dockAlongPercent(0, 1)).toBe(0);
  });

  it("keeps four same-pair strokes on distinct docks with no shared pinch", () => {
    const source = { x: 0, y: 0 };
    const target = { x: 0, y: 400 };
    const size = { width: 160, height: 80 };
    const paths = [0, 1, 2, 3].map((lane) =>
      dockedPairSegment(source, size, target, size, lane, 4),
    );
    const starts = paths.map(([start]) => start);
    const ends = paths.map(([, end]) => end);
    expect(new Set(starts.map((p) => Math.round(p.x * 100))).size).toBe(4);
    expect(new Set(ends.map((p) => Math.round(p.x * 100))).size).toBe(4);
    for (const [start, end] of paths) {
      expect(start.y).toBeCloseTo(40);
      expect(end.y).toBeCloseTo(360);
    }
    for (let i = 0; i < paths.length; i += 1) {
      for (let j = i + 1; j < paths.length; j += 1) {
        const a = paths[i];
        const b = paths[j];
        if (a === undefined || b === undefined) continue;
        expect(segmentsProperlyIntersect(a[0], a[1], b[0], b[1])).toBe(false);
      }
    }
    const midXs = paths.map((path) => pointOnPolyline(path, 0.5).x);
    expect(new Set(midXs.map((x) => Math.round(x * 100))).size).toBe(4);
  });

  it("places many-to-one target docks at distinct x on the top edge", () => {
    const target = { x: 40, y: 200 };
    const xs = [0, 1, 2].map(
      (lane) => nodeDockPoint(target, 180, 70, lane, 3, "top").x,
    );
    expect(new Set(xs.map((x) => Math.round(x * 100))).size).toBe(3);
    expect(xs[0]).toBeLessThan(xs[1] ?? Infinity);
    expect(xs[1]).toBeLessThan(xs[2] ?? Infinity);
    expect(nodeDockPoint(target, 180, 70, 1, 3, "top").y).toBeCloseTo(165);
  });

  it("picks bottom→top for a downward DAG hop", () => {
    expect(sourceDockSide(30, 180)).toBe("bottom");
    expect(targetDockSide(30, 180)).toBe("top");
  });
});

function segmentsProperlyIntersect(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
): boolean {
  const ccw = (
    p: { x: number; y: number },
    q: { x: number; y: number },
    r: { x: number; y: number },
  ) => (r.y - p.y) * (q.x - p.x) > (q.y - p.y) * (r.x - p.x);
  return ccw(a1, b1, b2) !== ccw(a2, b1, b2) && ccw(a1, a2, b1) !== ccw(a1, a2, b2);
}
