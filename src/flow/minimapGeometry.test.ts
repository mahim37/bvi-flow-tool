import { describe, expect, it } from "vitest";

import {
  miniToModel,
  minimapTransform,
  modelToMini,
  panToCenterModel,
} from "./minimapGeometry";

const GRAPH = { x1: 0, y1: 0, x2: 200, y2: 100 };

describe("minimapTransform", () => {
  it("maps the graph origin into the padded box", () => {
    const t = minimapTransform(GRAPH, 220, 120, 10);
    const origin = modelToMini(0, 0, t);
    expect(origin.x).toBeGreaterThanOrEqual(10);
    expect(origin.y).toBeGreaterThanOrEqual(10);
  });

  it("round-trips a model point through the minimap", () => {
    const t = minimapTransform(GRAPH, 176, 120, 10);
    const mini = modelToMini(80, 40, t);
    const back = miniToModel(mini.x, mini.y, t);
    expect(back.x).toBeCloseTo(80);
    expect(back.y).toBeCloseTo(40);
  });
});

describe("panToCenterModel", () => {
  it("puts the model point at the rendered centre", () => {
    const zoom = 2;
    const pan = panToCenterModel(50, 10, zoom, 400, 300);
    expect(50 * zoom + pan.x).toBe(200);
    expect(10 * zoom + pan.y).toBe(150);
  });
});
