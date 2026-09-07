import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Core, EventObject } from "cytoscape";

import type { Rect } from "./canvasLayout";
import {
  MINIMAP_HEIGHT,
  MINIMAP_PAD,
  MINIMAP_WIDTH,
  miniToModel,
  minimapTransform,
  modelToMini,
  panToCenterModel,
} from "./minimapGeometry";

interface MinimapProps {
  cy: Core;
}

interface MiniNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

interface MiniEdge {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function graphRect(cy: Core): Rect | null {
  if (cy.nodes().empty()) return null;
  const bb = cy.nodes().boundingBox({ includeOverlays: false, includeLabels: true });
  const pad = 40;
  return {
    x1: bb.x1 - pad,
    y1: bb.y1 - pad,
    x2: bb.x2 + pad,
    y2: bb.y2 + pad,
  };
}

/**
 * A live thumbnail of the whole graph. Click centres the main view on that
 * point; drag pans. Viewport rectangle is `cy.extent()`, so it answers
 * "where am I" without a second layout.
 */
export function Minimap({ cy }: MinimapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let frame = 0;
    const onChange = (_event?: EventObject) => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setTick((n) => n + 1);
      });
    };
    cy.on("pan zoom resize add remove position layoutstop drag", onChange);
    onChange();
    return () => {
      cy.off("pan zoom resize add remove position layoutstop drag", onChange);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [cy]);

  const snapshot = useMemo(() => {
    void tick;
    const bounds = graphRect(cy);
    if (bounds === null) return null;
    const transform = minimapTransform(
      bounds,
      MINIMAP_WIDTH,
      MINIMAP_HEIGHT,
      MINIMAP_PAD,
    );
    const nodes: MiniNode[] = [];
    cy.nodes().forEach((node) => {
      const bb = node.boundingBox({ includeOverlays: false, includeLabels: true });
      const topLeft = modelToMini(bb.x1, bb.y1, transform);
      const bottomRight = modelToMini(bb.x2, bb.y2, transform);
      const color = (node.data("sectionColor") as string | undefined) ?? "#6b6355";
      nodes.push({
        id: node.id(),
        x: topLeft.x,
        y: topLeft.y,
        w: Math.max(bottomRight.x - topLeft.x, 2),
        h: Math.max(bottomRight.y - topLeft.y, 2),
        color,
      });
    });
    const edges: MiniEdge[] = [];
    cy.edges().forEach((edge) => {
      const s = edge.source().position();
      const t = edge.target().position();
      const a = modelToMini(s.x, s.y, transform);
      const b = modelToMini(t.x, t.y, transform);
      edges.push({ id: edge.id(), x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    });
    const extent = cy.extent();
    const viewA = modelToMini(extent.x1, extent.y1, transform);
    const viewB = modelToMini(extent.x2, extent.y2, transform);
    return {
      transform,
      nodes,
      edges,
      view: {
        x: viewA.x,
        y: viewA.y,
        w: viewB.x - viewA.x,
        h: viewB.y - viewA.y,
      },
    };
  }, [cy, tick]);

  if (snapshot === null) return null;
  const map = snapshot;

  function clientToMini(event: ReactPointerEvent<SVGSVGElement>): {
    x: number;
    y: number;
  } {
    const svg = svgRef.current;
    if (svg === null) return { x: 0, y: 0 };
    const box = svg.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function panToMiniPoint(mini: { x: number; y: number }, animate: boolean) {
    const model = miniToModel(mini.x, mini.y, map.transform);
    const pan = panToCenterModel(model.x, model.y, cy.zoom(), cy.width(), cy.height());
    if (animate) cy.animate({ pan, duration: 180 });
    else cy.pan(pan);
  }

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const mini = clientToMini(event);
    dragRef.current = mini;
    panToMiniPoint(mini, false);
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (dragRef.current === null) return;
    const mini = clientToMini(event);
    dragRef.current = mini;
    panToMiniPoint(mini, false);
  }

  function onPointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    if (dragRef.current === null) return;
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Already released.
    }
  }

  return (
    <div
      className="absolute top-4 right-4 z-6 h-[120px] w-44 overflow-hidden rounded-[9px] border border-border bg-card shadow-md select-none"
      title="Graph overview — click or drag to pan"
    >
      <svg
        ref={svgRef}
        className="block cursor-grab active:cursor-grabbing"
        width={MINIMAP_WIDTH}
        height={MINIMAP_HEIGHT}
        viewBox={`0 0 ${MINIMAP_WIDTH} ${MINIMAP_HEIGHT}`}
        role="img"
        aria-label="Graph overview. Click or drag to pan the main view."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {map.edges.map((edge) => (
          <line
            key={edge.id}
            x1={edge.x1}
            y1={edge.y1}
            x2={edge.x2}
            y2={edge.y2}
            className="minimap__edge"
          />
        ))}
        {map.nodes.map((node) => (
          <rect
            key={node.id}
            x={node.x}
            y={node.y}
            width={node.w}
            height={node.h}
            rx={1.5}
            fill={node.color}
            opacity={0.85}
          />
        ))}
        <rect
          className="minimap__view"
          x={map.view.x}
          y={map.view.y}
          width={Math.max(map.view.w, 4)}
          height={Math.max(map.view.h, 4)}
        />
      </svg>
    </div>
  );
}
