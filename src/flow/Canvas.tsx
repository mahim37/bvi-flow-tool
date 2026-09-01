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
  // Default (dagre's internal 20) crowds a node that shares a rank with a
  // longer edge skipping past it -- e.g. a question with both an incoming
  // and outgoing edge, ranked between two ends of a direct fallback edge
  // that skips it. edgeSep only spaces routed edges away from nodes/each
  // other, unlike nodeSep, so it doesn't also widen every sibling-node gap
  // on the canvas.
  edgeSep: 200,
  rankSep: 80,
  animate: false,
  // Framing the opening view is done by hand below (`fitToChainStart`),
  // not dagre's own fit-to-everything -- a large questionnaire would
  // otherwise open shrunk down to unreadable text.
  fit: false,
  padding: 40,
} as const;

const INITIAL_VIEW_QUESTION_COUNT = 10;

/** Frames the camera on roughly the first `count` questions of the chain
 * from the entry point, rather than the whole graph -- BFS over the
 * already-drawn edges to pick which nodes the opening view shows, not a
 * resolver: it never decides which edge fires for an answer, only which
 * nodes the camera happens to look at first. */
function fitToChainStart(cy: Core, count: number) {
  const start =
    cy.nodes().filter((node) => node.data("isEntry") === true)[0] ?? cy.nodes()[0];
  if (start === undefined) return;

  const visited = new Set([start.id()]);
  const order = [start];
  let frontier = [start];
  while (order.length < count && frontier.length > 0) {
    const next: typeof frontier = [];
    for (const node of frontier) {
      node.outgoers("node").forEach((successor) => {
        if (visited.has(successor.id())) return;
        visited.add(successor.id());
        order.push(successor);
        next.push(successor);
      });
    }
    frontier = next;
  }

  const framed = order
    .slice(0, count)
    .reduce((collected, node) => collected.union(node), cy.collection());
  cy.fit(framed, 40);
}

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
  /** Non-null while a route is mid-retarget, or a new route is mid-add
   * (see `MapView`/`Options`) -- names what's being picked, for the
   * banner. Tapping a node completes it instead of selecting the node;
   * tapping empty canvas or pressing Esc cancels, same as `onCancelPick`. */
  pickLabel: string | null;
  onPickTarget: (id: string) => void;
  onCancelPick: () => void;
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

function idsFromSignature(signature: string): Set<string> {
  return new Set(signature === "" ? [] : signature.split("|"));
}

/** Places a brand new question beside its section's own first question
 * instead of wherever dagre's own disconnected-component placement
 * happened to land it -- a new question has no edges yet, so dagre sees
 * it as its own component with no relation to the rest of its section.
 * Purely a starting position, same reasoning as `fitToChainStart`: it
 * doesn't touch routing, just where a freshly-added node's camera-facing
 * position begins (a further drag/re-layout is unaffected). Several new
 * questions sharing one anchor (added in the same batch) stagger down
 * from it rather than stacking exactly on top of each other. */
function repositionNewSiblings(cy: Core, newNodeIds: ReadonlySet<string>) {
  const placedPerAnchor = new Map<string, number>();
  for (const id of newNodeIds) {
    const node = cy.getElementById(id);
    if (node.empty()) continue;
    const anchorId = node.data("sectionAnchorId") as string | null;
    if (anchorId === null) continue;
    const anchor = cy.getElementById(anchorId);
    if (anchor.empty()) continue;
    const index = placedPerAnchor.get(anchorId) ?? 0;
    placedPerAnchor.set(anchorId, index + 1);
    const anchorPosition = anchor.position();
    node.position({ x: anchorPosition.x + 220, y: anchorPosition.y + index * 90 });
  }
}

export function Canvas({
  elements,
  selectedId,
  highlightedIds,
  onSelectNode,
  onSelectEdge,
  sidebarCollapsed,
  onToggleSidebar,
  pickLabel,
  onPickTarget,
  onCancelPick,
}: CanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const signatureRef = useRef<string>("");
  const selectHandlers = useRef({
    onSelectNode,
    onSelectEdge,
    onPickTarget,
    onCancelPick,
  });
  selectHandlers.current = {
    onSelectNode,
    onSelectEdge,
    onPickTarget,
    onCancelPick,
  };
  // Read inside the `cy.on(...)` handlers registered once below, so
  // whether a tap selects or picks a target reflects the latest mode
  // without re-binding cytoscape's listeners on every mode change.
  const pickingRef = useRef(pickLabel !== null);
  pickingRef.current = pickLabel !== null;

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
      if (pickingRef.current) {
        selectHandlers.current.onPickTarget(event.target.id() as string);
        return;
      }
      selectHandlers.current.onSelectNode(event.target.id() as string);
    });
    cy.on("tap", "edge", (event) => {
      if (pickingRef.current) return;
      selectHandlers.current.onSelectEdge(event.target.id() as string);
    });
    cy.on("tap", (event) => {
      if (event.target !== cy) return;
      // A blank-canvas tap mid-pick used to fall through to
      // `onSelectNode(null)`, closing the detail panel but silently
      // leaving pick mode active -- inconsistent with Esc/Cancel, and
      // easy to not notice. Ported from break-backend's own fix for this
      // (app.js's cy "tap" handler, ~L2369-2382): treat it the same as
      // backing out.
      if (pickingRef.current) {
        selectHandlers.current.onCancelPick();
        return;
      }
      selectHandlers.current.onSelectNode(null);
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
        if (existing.nonempty()) {
          // Cytoscape treats an edge's source/target as fixed at creation
          // time -- merging new values into `.data()` updates what the
          // edge *reports*, but not which nodes it's actually drawn
          // between, so a retargeted or newly-ended edge would keep
          // pointing at its old destination forever. Remove and re-add it
          // under the same id instead; every other field (priority,
          // guard, fault flags) still merges in place below.
          const data = element.data as { source?: string; target?: string };
          if (
            existing.isEdge() &&
            (existing.data("source") !== data.source ||
              existing.data("target") !== data.target)
          ) {
            existing.remove();
            cy.add(element);
          } else {
            existing.data(element.data);
          }
        } else {
          cy.add(element);
        }
      }
    });

    const signature = nodeSignature(elements);
    if (signature !== signatureRef.current) {
      const previousIds = idsFromSignature(signatureRef.current);
      signatureRef.current = signature;
      cy.layout(LAYOUT).run();
      // Only for an incremental change -- on the very first layout every
      // node is "new" against an empty previous set, and that first full
      // layout is exactly the one case this should leave alone.
      if (previousIds.size > 0) {
        const newIds = new Set(
          [...idsFromSignature(signature)].filter((id) => !previousIds.has(id)),
        );
        repositionNewSiblings(cy, newIds);
      }
      fitToChainStart(cy, INITIAL_VIEW_QUESTION_COUNT);
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
    // the node wherever it happened to land off-screen. Capped at both
    // ends -- not just floored at 0.7 -- because the current zoom can
    // already be well past 1 the moment a fresh map lands here straight
    // from "Show on map" (`fitToChainStart` frames just the first 10
    // questions, not the whole graph, so it can zoom in more than this
    // is meant to on its own): without the ceiling, centering on the
    // target would keep whatever tight zoom that framing happened to
    // produce instead of a normal reading distance.
    if (selectedId !== null) {
      const node = cy.getElementById(selectedId);
      if (node.nonempty()) {
        cy.animate({
          center: { eles: node },
          zoom: Math.min(Math.max(cy.zoom(), 0.8), 0.8),
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
    if (set.empty()) return;

    if (set.length === 1) {
      // A single highlighted node ("Show on map" from the review screen
      // is the common case) is the same "look at this one thing" the
      // selection effect above handles -- fitting tightly to just its own
      // bounding box + padding zooms in far more than centering on it
      // does, so this shares that effect's center+clamp instead of `fit`.
      cy.animate({
        center: { eles: set },
        zoom: Math.min(Math.max(cy.zoom(), 0.7), 1),
        duration: 360,
        easing: "ease-out",
      });
      return;
    }

    // Ported from break-backend's focusGroup/diag-chip fit
    // (app.js ~L2028-2032, ~L2092-2097) -- a section or diagnostic group
    // pans/zooms to fit every question it lit up, not just the first.
    cy.animate({
      fit: { eles: set, padding: 70 },
      duration: 360,
      easing: "ease-out",
    });
  }, [highlightedIds]);

  // Ported from break-backend's global Escape handler (app.js
  // ~L3665-3669) -- only wired up while a pick is actually active, so
  // this doesn't compete with any other Esc behaviour elsewhere.
  useEffect(() => {
    if (pickLabel === null) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancelPick();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pickLabel, onCancelPick]);

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
          "for a keyboard-navigable view of the same routing, with one exception: " +
          "retargeting a route or adding one to a specific question requires " +
          "clicking a question on this canvas."
        }
      />

      {pickLabel !== null && (
        <div className="retarget-banner" role="status">
          <span>Click a question for {pickLabel}, or press Esc to cancel.</span>
          <button type="button" className="opt-edit-btn" onClick={onCancelPick}>
            Cancel
          </button>
        </div>
      )}

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
          aria-label="Zoom in"
          onClick={() => zoomBy(1.3)}
        >
          ＋
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Zoom out"
          aria-label="Zoom out"
          onClick={() => zoomBy(1 / 1.3)}
        >
          －
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Reset view"
          aria-label="Reset view"
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
