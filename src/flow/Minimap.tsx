import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Core, EventObject } from "cytoscape";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
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
  kind: "section" | "node";
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
  const [collapsed, setCollapsed] = useState(false);

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
      const isSection = node.data("kind") === "section";
      nodes.push({
        id: node.id(),
        x: topLeft.x,
        y: topLeft.y,
        w: Math.max(bottomRight.x - topLeft.x, isSection ? 10 : 5),
        h: Math.max(bottomRight.y - topLeft.y, isSection ? 8 : 5),
        color,
        kind: isSection ? "section" : "node",
      });
    });
    nodes.sort((a, b) => {
      if (a.kind === b.kind) return 0;
      return a.kind === "section" ? -1 : 1;
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
      className="absolute top-4 right-4 z-6 overflow-hidden rounded-xl border-2 border-gold/55 bg-card shadow-lg select-none"
      style={{ width: MINIMAP_WIDTH }}
    >
      <div
        className={`flex items-center justify-between gap-2 bg-secondary px-2.5 py-1 ${
          collapsed ? "" : "border-b border-border"
        }`}
      >
        <span className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          Overview
        </span>
        <div className="flex items-center gap-1">
          {!collapsed && (
            <span className="text-[10px] text-muted-foreground">Drag to pan</span>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            title={collapsed ? "Show overview" : "Hide overview"}
            aria-label={collapsed ? "Show overview" : "Hide overview"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((open) => !open)}
          >
            {collapsed ? (
              <ChevronDownIcon aria-hidden="true" />
            ) : (
              <ChevronUpIcon aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>
      {!collapsed && (
        <svg
          ref={svgRef}
          className="block cursor-grab bg-[var(--canvas-bg)] active:cursor-grabbing"
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
          {map.nodes.map((node) =>
            node.kind === "section" ? (
              <rect
                key={node.id}
                x={node.x}
                y={node.y}
                width={node.w}
                height={node.h}
                rx={3}
                fill={node.color}
                fillOpacity={0.12}
                stroke={node.color}
                strokeWidth={1.25}
                strokeOpacity={0.7}
              />
            ) : (
              <rect
                key={node.id}
                x={node.x}
                y={node.y}
                width={node.w}
                height={node.h}
                rx={1.5}
                fill={node.color}
                stroke="#fff"
                strokeWidth={0.6}
              />
            ),
          )}
          <rect
            className="minimap__view"
            x={map.view.x}
            y={map.view.y}
            width={Math.max(map.view.w, 8)}
            height={Math.max(map.view.h, 8)}
            rx={2}
          />
        </svg>
      )}
    </div>
  );
}
