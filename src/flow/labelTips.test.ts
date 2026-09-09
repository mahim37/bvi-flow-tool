import { describe, expect, it } from "vitest";

import {
  EDGE_TIP_MAX_WIDTH,
  NODE_TIP_MAX_WIDTH,
  clampTipPosition,
  guardIsTruncated,
  labelTipForEdgeData,
  labelTipForNodeData,
  staggerEdgeTips,
} from "./labelTips";

const VIEW = { width: 800, height: 600 };

describe("guardIsTruncated", () => {
  it("is true only when the canvas cut the option wording", () => {
    expect(guardIsTruncated("Both", "Both")).toBe(false);
    expect(guardIsTruncated("", "anything else")).toBe(false);
    expect(
      guardIsTruncated(
        "Parents prevented or disco…",
        "Parents prevented or discouraged",
      ),
    ).toBe(true);
  });
});

describe("clampTipPosition", () => {
  it("keeps a card inside the viewport", () => {
    const pos = clampTipPosition(790, -4, 200, VIEW);
    expect(pos.left).toBeLessThanOrEqual(800 - 200 - 8);
    expect(pos.top).toBe(8);
  });
});

describe("labelTipForNodeData", () => {
  it("expands every node, including a short prompt that was not truncated", () => {
    const tip = labelTipForNodeData(
      {
        id: "q1",
        kind: "question",
        fullLabel: "Short prompt\n◉ Q1",
        sectionColor: "#2f6fd6",
        box: { x1: 40, y1: 50, x2: 160, y2: 110 },
      },
      VIEW,
    );
    expect(tip).not.toBeNull();
    expect(tip?.text).toBe("Short prompt\n◉ Q1");
    expect(tip?.role).toBe("node");
    expect(tip?.minWidth).toBeGreaterThanOrEqual(120);
  });

  it("covers the node box rather than shrinking to the wrapped label", () => {
    const tip = labelTipForNodeData(
      {
        id: "q1",
        kind: "question",
        fullLabel: "Full wording",
        sectionColor: "#2f6fd6",
        box: { x1: 10, y1: 10, x2: 220, y2: 80 },
      },
      VIEW,
    );
    expect(tip?.minWidth).toBe(210);
    expect(tip?.maxWidth).toBe(NODE_TIP_MAX_WIDTH);
  });

  it("skips a section box — category chrome stays compact", () => {
    expect(
      labelTipForNodeData(
        {
          id: "section:intro",
          kind: "section",
          collapsed: false,
          isParent: true,
          fullLabel: "Introduction",
          sectionColor: "#c15c1f",
          box: { x1: 0, y1: 0, x2: 900, y2: 700 },
        },
        VIEW,
      ),
    ).toBeNull();
  });

  it("skips a node with no wording", () => {
    expect(
      labelTipForNodeData(
        {
          id: "empty",
          kind: "question",
          fullLabel: "",
          sectionColor: "#6b6355",
          box: { x1: 0, y1: 0, x2: 10, y2: 10 },
        },
        VIEW,
      ),
    ).toBeNull();
  });
});

describe("labelTipForEdgeData", () => {
  it("puts the full guard on the arrow midpoint when the canvas cut it short", () => {
    const long = "This option label is long enough that the canvas ellipsises it";
    const tip = labelTipForEdgeData(
      {
        id: "e1",
        guard: `${long.slice(0, 31)}…`,
        fullGuard: long,
        color: "#2f6fd6",
        mid: { x: 200, y: 100 },
      },
      VIEW,
    );
    expect(tip?.text).toBe(long);
    expect(tip?.role).toBe("edge");
    expect(tip?.maxWidth).toBe(EDGE_TIP_MAX_WIDTH);
  });

  it("leaves a short option pill on the arrow", () => {
    expect(
      labelTipForEdgeData(
        { id: "e1", guard: "Both", fullGuard: "Both", mid: { x: 200, y: 100 } },
        VIEW,
      ),
    ).toBeNull();
  });

  it("skips the unlabelled fallback route", () => {
    expect(
      labelTipForEdgeData({ id: "e1", fullGuard: "", mid: { x: 10, y: 10 } }, VIEW),
    ).toBeNull();
  });
});

describe("staggerEdgeTips", () => {
  it("spreads stacked guard cards so they no longer overlap", () => {
    const stacked = ["Both", "Other", "Neither"].map((text, index) => ({
      id: `e${index}`,
      left: 120,
      top: 200,
      minWidth: 72,
      maxWidth: EDGE_TIP_MAX_WIDTH,
      text,
      color: "#2f6fd6",
      role: "edge" as const,
    }));
    const staggered = staggerEdgeTips(stacked, VIEW);
    expect(staggered).toHaveLength(3);
    const lefts = new Set(staggered.map((tip) => tip.left));
    expect(lefts.size).toBeGreaterThan(1);
    for (let i = 0; i < staggered.length; i += 1) {
      for (let j = i + 1; j < staggered.length; j += 1) {
        const a = staggered[i];
        const b = staggered[j];
        if (a === undefined || b === undefined) continue;
        const overlapX = a.left < b.left + b.minWidth && b.left < a.left + a.minWidth;
        const overlapY = a.top < b.top + 28 && b.top < a.top + 28;
        expect(overlapX && overlapY).toBe(false);
      }
    }
  });

  it("leaves a lone node card where it is", () => {
    const node = {
      id: "q1",
      left: 40,
      top: 50,
      minWidth: 180,
      maxWidth: NODE_TIP_MAX_WIDTH,
      text: "Prompt",
      color: "#2f6fd6",
      role: "node" as const,
    };
    expect(staggerEdgeTips([node], VIEW)).toEqual([node]);
  });
});
