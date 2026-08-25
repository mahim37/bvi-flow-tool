import { useEffect, useRef } from "react";
import cytoscape from "cytoscape";
import type { Core, ElementDefinition } from "cytoscape";
import dagre from "cytoscape-dagre";

import { CANVAS_STYLE } from "./canvasStyle";

cytoscape.use(dagre);

const LAYOUT = {
  name: "dagre",
  rankDir: "TB",
  nodeSep: 45,
  rankSep: 80,
  animate: false,
  fit: true,
  padding: 40,
} as const;

interface CanvasProps {
  elements: ElementDefinition[];
  selectedId: string | null;
  /** Ids the sidebar or a diagnostic list is pointing at. The camera pans
   * and fits to show them; nothing about the elements' own styling changes. */
  highlightedIds: readonly string[];
  onSelectNode: (id: string | null) => void;
  onSelectEdge: (id: string) => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

/** The id set, in a form that is cheap to compare. A change here means
 * nodes appeared or vanished, which is the only thing worth re-running
 * dagre for -- see the layout effect. */
function nodeSignature(elements: ElementDefinition[]): string {
  return elements
    .filter((element) => element.group === "nodes")
    .map((element) => element.data.id)
    .sort()
    .join("|");
}

export function Canvas({
  elements,
  selectedId,
  highlightedIds,
  onSelectNode,
  onSelectEdge,
  sidebarCollapsed,
  onToggleSidebar,
}: CanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const signatureRef = useRef<string>("");
  const selectHandlers = useRef({ onSelectNode, onSelectEdge });
  selectHandlers.current = { onSelectNode, onSelectEdge };

  useEffect(() => {
    if (containerRef.current === null) return;
    const cy = cytoscape({
      container: containerRef.current,
      style: CANVAS_STYLE,
      // Boxing and multi-select would let a drag produce a selection this
      // app has no verb for; one thing at a time matches the detail panel,
      // which is the only place a selection goes.
      boxSelectionEnabled: false,
      selectionType: "single",
      wheelSensitivity: 0.2,
    });
    cyRef.current = cy;

    cy.on("tap", "node", (event) => {
      selectHandlers.current.onSelectNode(event.target.id() as string);
    });
    cy.on("tap", "edge", (event) => {
      selectHandlers.current.onSelectEdge(event.target.id() as string);
    });
    cy.on("tap", (event) => {
      if (event.target === cy) selectHandlers.current.onSelectNode(null);
    });

    // Hover-to-trace, ported from break-backend's focus/highlight engine
    // (state.hover in app.js): fade everything except the hovered node's
    // own connected edges/neighbours, so tracing one question's routing
    // doesn't require clicking it first.
    cy.on("mouseover", "node", (event) => {
      const set = event.target.closedNeighborhood();
      cy.elements().addClass("faded");
      set.removeClass("faded");
      set.nodes().addClass("hl");
      set.edges().addClass("hl");
    });
    cy.on("mouseout", "node", () => {
      cy.elements().removeClass("faded hl");
    });

    // Keeps cytoscape's own notion of its size in sync with the container's
    // actual box -- the sidebar-collapse toggle animates `.layout`'s grid
    // columns rather than firing a `resize` event, and cytoscape only
    // recomputes on the latter. A `ResizeObserver` catches that (and a
    // plain window resize) without this component needing to know why its
    // container changed size.
    const resizeObserver = new ResizeObserver(() => cy.resize());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      cy.destroy();
      cyRef.current = null;
      // A destroyed cy's elements go with it, so the next instance (React
      // 18 StrictMode's dev double-mount, or a real remount) starts with no
      // layout run yet -- without this reset, the elements-sync effect sees
      // the old signature, thinks the new (empty) instance is already laid
      // out, and skips dagre entirely, leaving every node stacked at (0,0).
      signatureRef.current = "";
    };
  }, []);

  useEffect(() => {
    const cy = cyRef.current;
    if (cy === null) return;

    const incoming = new Map(elements.map((element) => [element.data.id, element]));

    cy.batch(() => {
      // Diffed in place rather than replaced wholesale, because replacing
      // discards every node position and the graph would jump to a fresh
      // layout after each edit. Retargeting one arrow should move that
      // arrow, not the map.
      cy.elements().forEach((element) => {
        if (!incoming.has(element.id())) element.remove();
      });
      for (const element of elements) {
        const id = element.data.id;
        if (id === undefined) continue;
        const existing = cy.getElementById(id);
        if (existing.nonempty()) existing.data(element.data);
        else cy.add(element);
      }
    });

    const signature = nodeSignature(elements);
    if (signature !== signatureRef.current) {
      signatureRef.current = signature;
      cy.layout(LAYOUT).run();
    }
  }, [elements]);

  useEffect(() => {
    const cy = cyRef.current;
    if (cy === null) return;
    cy.batch(() => {
      cy.elements().unselect();
      if (selectedId !== null) cy.getElementById(selectedId).select();
    });
    // Ported from break-backend's tap handler (setFocus("pin", ..., {
    // center: true }) -- selecting a question from anywhere (sidebar,
    // search, a diagnostic chip, canvas tap itself) pans/zooms the camera
    // to it, so "select" always means "look at this" rather than leaving
    // the node wherever it happened to land off-screen.
    if (selectedId !== null) {
      const node = cy.getElementById(selectedId);
      if (node.nonempty()) {
        cy.animate({
          center: { eles: node },
          zoom: Math.max(cy.zoom(), 0.7),
          duration: 320,
        });
      }
    }
  }, [selectedId]);

  useEffect(() => {
    const cy = cyRef.current;
    if (cy === null) return;
    let set = cy.collection();
    for (const id of highlightedIds) set = set.union(cy.getElementById(id));
    // Ported from break-backend's focusGroup/diag-chip fit
    // (app.js ~L2028-2032, ~L2092-2097) -- a section or diagnostic group
    // pans/zooms to fit every question it lit up, not just the first.
    if (set.nonempty()) {
      cy.animate({ fit: { eles: set, padding: 70 }, duration: 360, easing: "ease-out" });
    }
  }, [highlightedIds]);

  // Ported from break-backend's #zoomIn/#zoomOut/#fit/#reset (app.js
  // ~L3594-3623) -- same factors and durations. Break's "reset" also
  // clears its own search/focus state, which lives in this app's Sidebar
  // instead of Canvas, so here it only resets the camera.
  function zoomBy(factor: number) {
    const cy = cyRef.current;
    if (cy === null) return;
    cy.animate(
      { zoom: cy.zoom() * factor, center: { eles: cy.elements() } },
      { duration: 180 },
    );
  }
  function fitToScreen() {
    const cy = cyRef.current;
    if (cy === null) return;
    cy.animate({ fit: { eles: cy.elements(), padding: 50 } }, { duration: 300 });
  }

  return (
    <div className="canvas">
      <div
        className="canvas__stage"
        ref={containerRef}
        // The canvas is a picture as far as assistive technology is
        // concerned: cytoscape draws to a <canvas> element with no DOM to
        // traverse. Rather than fake a tree that would go stale, the same
        // information is available in full as real, focusable DOM -- the
        // section list, the search results and the detail panel -- and this
        // says so instead of pretending to be navigable.
        role="img"
        aria-label={
          "Questionnaire flow diagram. Use the question list and detail panel " +
          "for a keyboard-navigable view of the same routing."
        }
      />

      {/* Ported from break-backend's #sidebarToggle (index.html ~L174-188,
          same hamburger path) -- there it lives in the topbar, but this
          app's topbar is shared across Map/Review/Preview while the
          sidebar only exists here, so the button sits with the rest of
          the canvas's own chrome instead. */}
      <div className="canvas-controls canvas-controls--top-left">
        <button
          type="button"
          className="icon-btn"
          title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          onClick={onToggleSidebar}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              d="M3 6h18M3 12h18M3 18h18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div className="canvas-controls">
        <button
          type="button"
          className="icon-btn"
          title="Zoom in"
          onClick={() => zoomBy(1.3)}
        >
          ＋
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Zoom out"
          onClick={() => zoomBy(1 / 1.3)}
        >
          －
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Fit to screen"
          onClick={fitToScreen}
        >
          ⤢
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Reset view"
          onClick={fitToScreen}
        >
          ⟲
        </button>
      </div>

      <div className="hint" aria-hidden="true">
        <strong>Click</strong> a question for details · <strong>Hover</strong> to trace
        its paths · <strong>Drag the canvas</strong> to pan ·{" "}
        <strong>Drag a question</strong> to move it · <strong>Scroll</strong> to zoom
      </div>
    </div>
  );
}
