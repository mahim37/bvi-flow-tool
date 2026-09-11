import { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import type { Core, EdgeSingular, ElementDefinition, NodeSingular } from "cytoscape";
import dagre from "cytoscape-dagre";

import {
  cameraNeedsReframe,
  containerHasUsableSize,
  idsAddedToJoinedKey,
  isSectionCollapseToggle,
  paddedScreenBox,
  pointInSectionToggle,
  rectFullyInView,
  runGraphLayout,
  separateNodesFromEdges,
  shouldRepositionNewSiblings,
} from "./canvasLayout";
import { CANVAS_STYLE } from "./canvasStyle";
import { sectionNodeId } from "./graphElements";
import { type LabelTip, guardIsTruncated, labelTipForNodeData } from "./labelTips";
import { Minimap } from "./Minimap";
import { MapIndexDialog } from "./MapIndexDialog";
import { Button } from "@/components/ui/button";

cytoscape.use(dagre);

const INITIAL_VIEW_QUESTION_COUNT = 10;
/** Keep `Minimap.tsx` and its geometry; just stop mounting it for now. */
const SHOW_MINIMAP = false;

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

const CANVAS_LABEL_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/** Direct DOM write so the highlight tracks pan/zoom on the same frame.
 * React state on `pan` lagged a frame behind the stroke (or missed the
 * drag entirely), leaving the box parked where the click happened. */
function paintEdgeBox(
  el: HTMLDivElement | null,
  cy: Core,
  edgeId: string | null,
): void {
  if (el === null) return;
  if (edgeId === null) {
    el.style.display = "none";
    return;
  }
  const edge = cy.getElementById(edgeId);
  if (edge.empty() || !edge.isEdge()) {
    el.style.display = "none";
    return;
  }
  const box = paddedScreenBox(
    edge.renderedBoundingBox({ includeOverlays: false, includeLabels: true }),
    10,
  );
  if (box === null) {
    el.style.display = "none";
    return;
  }
  el.style.display = "block";
  el.style.left = `${box.left}px`;
  el.style.top = `${box.top}px`;
  el.style.width = `${box.width}px`;
  el.style.height = `${box.height}px`;
}

interface CanvasProps {
  elements: ElementDefinition[];
  selectedId: string | null;
  /** A default-route arrow currently opening the choices sheet. Exclusive
   * with `selectedId` -- MapView never sets both. */
  selectedEdgeId: string | null;
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
  /** Clicking the chevron on a section box expands or collapses it. The
   * rest of the box is not a control — hovering a question inside would
   * otherwise fight a full-box toggle. */
  onToggleSection: (sectionId: string) => void;
  /** Sorted join of collapsed section ids. A change here is a fold, not a
   * new graph — keep the camera instead of fitting the chain start. */
  collapsedSectionKey: string;
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

/** Neighbourhood fade for a hovered question; a section hover only
 * highlights the box itself so child questions do not pick up a thicker
 * border. Cytoscape bubbles mouseover from child to parent, so callers
 * must `stopPropagation` or the section handler wins and the question
 * trace never shows. */
function applyHover(cy: Core, node: NodeSingular): void {
  cy.elements().removeClass("faded hl");
  if (node.data("kind") === "section") {
    const keep = node
      .union(node.descendants())
      .union(node.connectedEdges())
      .union(node.descendants().connectedEdges());
    cy.elements().difference(keep).addClass("faded");
    node.addClass("hl");
    node.connectedEdges().addClass("hl");
    return;
  }
  const neighborhood = node.closedNeighborhood();
  cy.elements().difference(neighborhood).addClass("faded");
  neighborhood.nodes().forEach((member) => {
    if (member.data("kind") !== "section") member.addClass("hl");
  });
  neighborhood.edges().addClass("hl");
  const parent = node.parent();
  if (parent.nonempty()) parent.removeClass("faded");
}

function applyEdgeHover(cy: Core, edge: EdgeSingular): void {
  cy.elements().removeClass("faded hl");
  let keep = edge.union(edge.connectedNodes());
  edge.connectedNodes().forEach((node) => {
    const parent = node.parent();
    if (parent.nonempty()) keep = keep.union(parent);
  });
  cy.elements().difference(keep).addClass("faded");
  edge.addClass("hl");
  edge.connectedNodes().forEach((node) => {
    if (node.data("kind") !== "section") node.addClass("hl");
  });
}

function nodeLabelTip(
  node: NodeSingular,
  view: { width: number; height: number },
): LabelTip | null {
  return labelTipForNodeData(
    {
      id: node.id(),
      kind: String(node.data("kind") ?? ""),
      collapsed: node.data("collapsed") === true,
      isParent: node.isParent(),
      fullLabel: node.data("fullLabel"),
      sectionColor: node.data("sectionColor"),
      box: node.renderedBoundingBox({ includeOverlays: false, includeLabels: true }),
    },
    view,
  );
}

/** Truncated guards on this question's arrows: swap to `fullGuard` in
 * place (same size, still along the stroke). Sections and edges do not. */
function syncFullGuards(cy: Core, node: NodeSingular | null): void {
  cy.edges().removeClass("full-guard");
  if (node === null || node.data("kind") === "section") return;
  node.connectedEdges().forEach((edge) => {
    if (guardIsTruncated(edge.data("guard"), edge.data("fullGuard"))) {
      edge.addClass("full-guard");
    }
  });
}

/** Hovered question's own larger prompt. Option pills stay on the arrows. */
function tipsForElement(
  ele: NodeSingular | EdgeSingular,
  view: { width: number; height: number },
): LabelTip[] {
  if (ele.isEdge()) return [];
  if (ele.data("kind") === "section") return [];
  const tip = nodeLabelTip(ele, view);
  return tip === null ? [] : [tip];
}

function syncExpandedLabels(cy: Core, tips: readonly LabelTip[]): void {
  cy.elements().removeClass("expanded-label");
  for (const tip of tips) {
    const ele = cy.getElementById(tip.id);
    if (ele.nonempty()) ele.addClass("expanded-label");
  }
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
  selectedEdgeId,
  highlightedIds,
  onSelectNode,
  onSelectEdge,
  sidebarCollapsed,
  onToggleSidebar,
  pickLabel,
  onPickTarget,
  onCancelPick,
  onToggleSection,
  collapsedSectionKey,
}: CanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [cy, setCy] = useState<Core | null>(null);
  const signatureRef = useRef<string>("");
  const collapseKeyRef = useRef(collapsedSectionKey);
  const selectHandlers = useRef({
    onSelectNode,
    onSelectEdge,
    onPickTarget,
    onCancelPick,
    onToggleSection,
  });
  selectHandlers.current = {
    onSelectNode,
    onSelectEdge,
    onPickTarget,
    onCancelPick,
    onToggleSection,
  };
  // Read inside the `cy.on(...)` handlers registered once below, so
  // whether a tap selects or picks a target reflects the latest mode
  // without re-binding cytoscape's listeners on every mode change.
  const pickingRef = useRef(pickLabel !== null);
  pickingRef.current = pickLabel !== null;
  const selectedEdgeIdRef = useRef(selectedEdgeId);
  selectedEdgeIdRef.current = selectedEdgeId;
  const canvasRootRef = useRef<HTMLDivElement>(null);
  const edgeBoxElRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<{ id: string; isNode: boolean } | null>(null);
  const [labelTips, setLabelTips] = useState<LabelTip[]>([]);

  useEffect(() => {
    const host = containerRef.current;
    if (host === null) return;
    const cy = cytoscape({
      container: host,
      style: CANVAS_STYLE,
      // Boxing and multi-select would let a drag produce a selection this
      // app has no verb for; one thing at a time matches the detail panel,
      // which is the only place a selection goes.
      boxSelectionEnabled: false,
      selectionType: "single",
      wheelSensitivity: 2,
      minZoom: 1e-50,
      maxZoom: 2.5,
    });
    cyRef.current = cy;
    setCy(cy);

    cy.on("tap", "node", (event) => {
      const kind = event.target.data("kind") as string | undefined;
      if (kind === "section") {
        if (pickingRef.current) return;
        const rendered = event.renderedPosition;
        const box = event.target.renderedBoundingBox({ includeOverlays: false });
        if (!pointInSectionToggle(box, rendered)) return;
        const sectionId = event.target.data("sectionId") as string | undefined;
        if (typeof sectionId === "string") {
          selectHandlers.current.onToggleSection(sectionId);
        }
        return;
      }
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
    // doesn't require clicking it first. stopPropagation keeps a question
    // inside a section from also running the section hover. The HTML
    // cards sit on the boxes they belong to and grow past them, so
    // mouseout of the cytoscape hit-area is not enough on its own — if
    // the pointer is still inside a card, keep the expansion.
    const viewSize = () => {
      const frame = cy.container();
      return { width: frame?.clientWidth ?? 0, height: frame?.clientHeight ?? 0 };
    };
    const pointerInTips = (clientX: number, clientY: number): boolean => {
      const root = canvasRootRef.current;
      if (root === null) return false;
      for (const el of root.querySelectorAll("[data-label-tip]")) {
        const box = el.getBoundingClientRect();
        if (
          clientX >= box.left &&
          clientX <= box.right &&
          clientY >= box.top &&
          clientY <= box.bottom
        ) {
          return true;
        }
      }
      return false;
    };
    const clearHover = () => {
      hoverRef.current = null;
      cy.elements().removeClass("faded hl expanded-label full-guard");
      setLabelTips([]);
      const container = cy.container();
      if (container) container.style.cursor = "";
    };
    const showHover = (ele: NodeSingular | EdgeSingular) => {
      hoverRef.current = { id: ele.id(), isNode: ele.isNode() };
      if (ele.isNode()) {
        applyHover(cy, ele);
        syncFullGuards(cy, ele);
      } else {
        applyEdgeHover(cy, ele);
        syncFullGuards(cy, null);
      }
      const tips = tipsForElement(ele, viewSize());
      syncExpandedLabels(cy, tips);
      setLabelTips(tips);
    };
    const resyncTips = () => {
      const hover = hoverRef.current;
      if (hover === null) return;
      const ele = cy.getElementById(hover.id);
      if (ele.empty() || (hover.isNode ? !ele.isNode() : !ele.isEdge())) {
        clearHover();
        return;
      }
      const tips = tipsForElement(ele as NodeSingular | EdgeSingular, viewSize());
      syncExpandedLabels(cy, tips);
      setLabelTips(tips);
    };
    const resyncEdgeBox = () => {
      paintEdgeBox(edgeBoxElRef.current, cy, selectedEdgeIdRef.current);
    };
    cy.on("mouseover", "node", (event) => {
      event.stopPropagation();
      showHover(event.target);
    });
    cy.on("mouseover", "edge", (event) => {
      event.stopPropagation();
      showHover(event.target);
    });
    cy.on("mouseout", "node, edge", (event) => {
      event.stopPropagation();
      const leavingId = event.target.id();
      const orig = event.originalEvent as MouseEvent | undefined;
      requestAnimationFrame(() => {
        if (hoverRef.current?.id !== leavingId) return;
        if (orig !== undefined && pointerInTips(orig.clientX, orig.clientY)) {
          return;
        }
        clearHover();
      });
    });
    cy.on("mousemove", (event) => {
      if (hoverRef.current === null || event.target !== cy) return;
      const orig = event.originalEvent as MouseEvent | undefined;
      if (orig !== undefined && pointerInTips(orig.clientX, orig.clientY)) return;
      clearHover();
    });
    cy.on("pan zoom position", resyncTips);
    cy.on("viewport render", resyncEdgeBox);
    cy.on("mousemove", 'node[kind = "section"]', (event) => {
      const container = cy.container();
      if (container === null) return;
      const box = event.target.renderedBoundingBox({ includeOverlays: false });
      container.style.cursor = pointInSectionToggle(box, event.renderedPosition)
        ? "pointer"
        : "";
    });
    // A dragged node can uncover or create a skip-through; slide the
    // questions that now sit on a chord rather than bowing the arrow.
    cy.on("dragfree", "node", () => separateNodesFromEdges(cy));

    // Keeps cytoscape's own notion of its size in sync with the container's
    // actual box -- the sidebar-collapse toggle animates `.layout`'s grid
    // columns rather than firing a `resize` event, and cytoscape only
    // recomputes on the latter. A `ResizeObserver` catches that (and a
    // plain window resize) without this component needing to know why its
    // container changed size.
    //
    // `cy.resize()` alone is not enough when the first layout ran against
    // a 0×0 flex/grid cell: `width: "label"` and `fit()` both bake that
    // degeneracy in, which is the empty canvas + sliver minimap. Relayout
    // and reframe only when recovering from that, not on every pixel of a
    // sidebar animation (that would steal the user's pan).
    const size = { w: 0, h: 0 };
    const recordSize = (width: number, height: number) => {
      size.w = width;
      size.h = height;
    };
    const box = host.getBoundingClientRect();
    recordSize(box.width, box.height);

    const resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect === undefined) return;
      const wasUnusable = !containerHasUsableSize(size.w, size.h);
      recordSize(rect.width, rect.height);
      if (!containerHasUsableSize(rect.width, rect.height)) return;
      cy.resize();
      resyncEdgeBox();
      if (cy.nodes().empty()) return;
      const graphBox = cy.nodes().boundingBox({
        includeOverlays: false,
        includeLabels: true,
      });
      const collapsedGraph = cy.nodes().length > 1 && graphBox.x2 - graphBox.x1 < 8;
      if (wasUnusable || collapsedGraph) {
        runGraphLayout(cy);
        fitToChainStart(cy, INITIAL_VIEW_QUESTION_COUNT);
        return;
      }
      if (cameraNeedsReframe(cy.zoom(), cy.extent())) {
        fitToChainStart(cy, INITIAL_VIEW_QUESTION_COUNT);
      }
    });
    resizeObserver.observe(host);

    return () => {
      resizeObserver.disconnect();
      cy.destroy();
      cyRef.current = null;
      setCy(null);
      hoverRef.current = null;
      setLabelTips([]);
      paintEdgeBox(edgeBoxElRef.current, cy, null);
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
    cy.nodes('[kind = "section"]').ungrabify().panify();

    const signature = nodeSignature(elements);
    if (signature !== signatureRef.current) {
      hoverRef.current = null;
      setLabelTips([]);
      const previousIds = idsFromSignature(signatureRef.current);
      const currentIds = idsFromSignature(signature);
      const keepCamera =
        signatureRef.current !== "" &&
        (collapseKeyRef.current !== collapsedSectionKey ||
          isSectionCollapseToggle(previousIds, currentIds));
      const zoom = cy.zoom();
      const pan = { ...cy.pan() };
      const newlyCollapsed = idsAddedToJoinedKey(
        collapseKeyRef.current,
        collapsedSectionKey,
      );
      signatureRef.current = signature;
      // Collapse used to leave remaining boxes where they were, which kept
      // the old rank gaps between categories. Re-run dagre on fold and
      // unfold; zoom is restored below rather than fitting the chain start.
      runGraphLayout(cy);
      // Incremental adds only. A draft is a whole new id set (Canvas
      // stays mounted), and treating every copied question as "new"
      // stacked them beside their section anchors. See
      // `shouldRepositionNewSiblings`. Expanding a small section looks
      // like 1–2 adds; do not park those beside the anchor.
      if (!keepCamera && shouldRepositionNewSiblings(previousIds, currentIds)) {
        const newIds = new Set([...currentIds].filter((id) => !previousIds.has(id)));
        repositionNewSiblings(cy, newIds);
        separateNodesFromEdges(cy);
      }
      if (keepCamera) {
        cy.viewport({ zoom, pan });
        const focusId = newlyCollapsed[0];
        if (focusId !== undefined) {
          const collapsedBox = cy.getElementById(sectionNodeId(focusId));
          if (collapsedBox.nonempty()) {
            const box = collapsedBox.boundingBox({
              includeOverlays: false,
              includeLabels: true,
            });
            if (!rectFullyInView(box, cy.extent(), 48 / zoom)) {
              cy.animate({
                center: { eles: collapsedBox },
                duration: 280,
                easing: "ease-out",
              });
            }
          }
        }
      } else {
        const host = cy.container();
        if (
          host !== null &&
          containerHasUsableSize(host.clientWidth, host.clientHeight)
        ) {
          fitToChainStart(cy, INITIAL_VIEW_QUESTION_COUNT);
        }
      }
    } else {
      // Edges can retarget without any node appearing or vanishing, and
      // that is enough to turn a neighbour-link into a skip.
      separateNodesFromEdges(cy);
    }
    collapseKeyRef.current = collapsedSectionKey;
  }, [elements, collapsedSectionKey]);

  useEffect(() => {
    const cy = cyRef.current;
    if (cy === null) return;
    cy.batch(() => {
      cy.elements().unselect();
      if (selectedEdgeId !== null) cy.getElementById(selectedEdgeId).select();
      else if (selectedId !== null) cy.getElementById(selectedId).select();
    });
    // A default-route click opens the right-hand sheet and shrinks this
    // pane. Centering/zooming on the arrow at the old size, then resizing,
    // blanks the viewport for a beat. Keep the camera; the faint box
    // marks which arrow is open. Question selection still pans/zooms so
    // a sidebar/search pick lands on-screen.
    if (selectedEdgeId !== null) {
      paintEdgeBox(edgeBoxElRef.current, cy, selectedEdgeId);
      return;
    }
    paintEdgeBox(edgeBoxElRef.current, cy, null);
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
  }, [selectedId, selectedEdgeId]);

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

  // Zoom about the viewport centre. The previous `center: { eles }` form
  // panned onto the bounding-box midpoint of every node — usually some
  // question in the middle of the chain — on every +/– click.
  function zoomBy(factor: number) {
    const graph = cyRef.current;
    if (graph === null) return;
    const level = Math.min(
      Math.max(graph.zoom() * factor, graph.minZoom()),
      graph.maxZoom(),
    );
    graph.animate(
      {
        zoom: {
          level,
          renderedPosition: { x: graph.width() / 2, y: graph.height() / 2 },
        },
      },
      { duration: 180 },
    );
  }
  function fitEntireGraph() {
    const graph = cyRef.current;
    if (graph === null) return;
    graph.animate({ fit: { eles: graph.elements(), padding: 50 } }, { duration: 300 });
  }
  function resetNodePositions() {
    const graph = cyRef.current;
    if (graph === null) return;
    runGraphLayout(graph);
    fitToChainStart(graph, INITIAL_VIEW_QUESTION_COUNT);
  }

  return (
    <div
      ref={canvasRootRef}
      className="canvas relative h-full min-h-0 min-w-0 overflow-hidden border-x border-border bg-[var(--canvas-bg)] bg-[radial-gradient(circle_at_1px_1px,var(--canvas-dot)_1.5px,transparent_0)] bg-size-[26px_26px] [background-position:0_0]"
    >
      <div
        className="canvas__stage absolute inset-0 h-full w-full"
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
        <div
          className="absolute top-4 left-1/2 z-7 flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-gold bg-gold/12 px-4 py-2 text-[12.5px] shadow-md"
          role="status"
        >
          <span>Click a question for {pickLabel}, or press Esc to cancel.</span>
          <Button variant="outline" size="sm" onClick={onCancelPick}>
            Cancel
          </Button>
        </div>
      )}

      {/* Ported from break-backend's #sidebarToggle (index.html ~L174-188,
          same hamburger path) -- there it lives in the topbar, but this
          app's topbar is shared across Map/Review/Preview while the
          sidebar only exists here, so the button sits with the rest of
          the canvas's own chrome instead. */}
      <div className="absolute top-4 left-4 z-6 flex flex-col gap-1.5">
        <Button
          size="icon"
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
        </Button>
      </div>

      <div className="absolute right-4 bottom-4 z-6 flex flex-col gap-1.5">
        <Button
          size="icon"
          title="Zoom in"
          aria-label="Zoom in"
          onClick={() => zoomBy(1.3)}
        >
          ＋
        </Button>
        <Button
          size="icon"
          title="Zoom out"
          aria-label="Zoom out"
          onClick={() => zoomBy(1 / 1.3)}
        >
          －
        </Button>
        <Button
          size="icon"
          title="Fit entire graph"
          aria-label="Fit entire graph"
          onClick={fitEntireGraph}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Button>
        <Button
          size="icon"
          title="Reset"
          aria-label="Reset"
          onClick={resetNodePositions}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Button>
        <MapIndexDialog />
      </div>

      <div
        ref={edgeBoxElRef}
        className="pointer-events-none absolute z-5 rounded-md border border-foreground/12 bg-foreground/[0.04]"
        style={{ display: "none" }}
        aria-hidden="true"
      />

      {labelTips.map((tip) => (
        <div
          key={tip.id}
          data-label-tip={tip.id}
          className={
            tip.role === "node"
              ? "pointer-events-none absolute z-9 max-w-[400px] rounded-lg border-2 bg-white px-3.5 py-3 text-[13.5px] leading-[1.35] font-semibold text-[#1c1a16] shadow-lg whitespace-pre-wrap"
              : "pointer-events-none absolute z-8 max-w-[280px] rounded-md border bg-white px-2.5 py-1.5 text-[12.5px] leading-snug font-semibold text-[#4a473f] shadow-md whitespace-pre-wrap"
          }
          style={{
            left: tip.left,
            top: tip.top,
            minWidth: tip.minWidth,
            maxWidth: tip.maxWidth,
            borderColor: tip.color,
            fontFamily: CANVAS_LABEL_FONT,
          }}
          aria-hidden="true"
        >
          {tip.text}
        </div>
      ))}

      {SHOW_MINIMAP && cy !== null && <Minimap cy={cy} />}
    </div>
  );
}
