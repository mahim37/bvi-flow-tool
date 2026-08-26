import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { useAddEdge, useReview, useUpdateEdge } from "../api/queries";
import type { UUID } from "../api/types";
import { Canvas } from "./Canvas";
import { DetailPanel } from "./DetailPanel";
import { Sidebar } from "./Sidebar";
import { useVersionContext } from "./versionContext";
import { useWriteErrorHandler } from "./useWriteError";
import { buildElements, changeKindsFromDiff, isSyntheticNode } from "./graphElements";

/** A pending canvas click-to-pick, one of two shapes: retargeting an
 * existing edge, or adding a new one for a question/option that doesn't
 * have a route yet. Either way `label` is what the banner names, and
 * picking a node on the canvas is what completes it. */
type CanvasPick =
  | { kind: "retarget"; edgeId: UUID; label: string }
  | { kind: "add"; questionId: UUID; optionId: UUID | null; label: string };

export function MapView() {
  const { graph, editable } = useVersionContext();
  const { versionId } = useParams<{ versionId: string }>();
  const [searchParams] = useSearchParams();
  const updateEdge = useUpdateEdge(graph.version.id);
  const addEdge = useAddEdge(graph.version.id);
  const onWriteError = useWriteErrorHandler();

  const [selectedQuestionId, setSelectedQuestionId] = useState<UUID | null>(null);
  const [highlightedIds, setHighlightedIds] = useState<readonly string[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pick, setPick] = useState<CanvasPick | null>(null);

  // `?question=` is how the review screen points at a node. In the URL
  // rather than in a handler, so "show me this change on the map" is a
  // link somebody can send, and so a reload lands on the same node.
  const focusId = searchParams.get("question");
  useEffect(() => {
    setSelectedQuestionId(focusId);
    setHighlightedIds(focusId === null ? [] : [focusId]);
  }, [versionId, focusId]);

  // Only a draft has anything "pending" to highlight -- a published
  // version's own diff (`ReviewView`'s "What changed" tab) is history, not
  // work still to publish, so there's nothing to fetch for one.
  const review = useReview(graph.version.is_draft ? graph.version.id : null);
  const elements = useMemo(
    () => buildElements(graph, review.data?.diff),
    [graph, review.data],
  );
  // Computed once here rather than separately in `DetailPanel`/`Options`
  // too -- both the canvas and the detail panel highlight the same
  // draft's diff, just in different places.
  const changeKinds = useMemo(
    () => changeKindsFromDiff(review.data?.diff),
    [review.data],
  );

  // Synthetic ids (the shared end-of-flow node, a cross-version target
  // this version doesn't contain) and archived questions aren't valid
  // pick destinations -- the old dropdowns never offered them either
  // (`Options.tsx`'s `targets` list excludes archived questions, and
  // there was never a synthetic-id option at all). An invalid pick is
  // ignored rather than refused, same as tapping empty canvas.
  function pickCanvasTarget(nodeId: string) {
    if (pick === null) return;
    if (isSyntheticNode(nodeId)) return;
    const target = graph.questions.find((question) => question.id === nodeId);
    if (target === undefined || target.archived_at !== null) return;
    if (pick.kind === "retarget") {
      updateEdge.mutate(
        { edgeId: pick.edgeId, changes: { to_question: nodeId } },
        { onError: onWriteError, onSuccess: () => setPick(null) },
      );
    } else {
      // A new edge goes last by default (`editing.add_edge`'s own rule),
      // which the server then refuses outright if this question already
      // has a default route (question-level edge) -- appending a
      // per-option edge below one that matches every answer would create
      // a route that can never fire. Sidestep that for the one case this
      // picker can actually cause (adding a *per-option* edge) by asking
      // for a priority below every edge this question already has, read
      // straight from the already-fetched graph -- not a routing
      // computation, just picking a number smaller than ones already
      // visible. The server still re-validates and owns the real
      // decision, same as any other write.
      const siblings = graph.edges.filter(
        (edge) => edge.from_question === pick.questionId,
      );
      const hasFallback = siblings.some((edge) => edge.from_option === null);
      const priority =
        pick.optionId !== null && hasFallback
          ? Math.min(...siblings.map((edge) => edge.priority)) - 1
          : undefined;
      addEdge.mutate(
        {
          from_question: pick.questionId,
          from_option: pick.optionId,
          to_question: nodeId,
          ...(priority !== undefined ? { priority } : {}),
        },
        { onError: onWriteError, onSuccess: () => setPick(null) },
      );
    }
  }

  const selectedQuestion = useMemo(() => {
    if (selectedQuestionId === null) return null;
    return (
      graph.questions.find((question) => question.id === selectedQuestionId) ?? null
    );
  }, [graph.questions, selectedQuestionId]);

  // Ported from break-backend's `.detail`/`.detail.open` (styles.css
  // ~L660-673) -- the panel is a closed drawer whenever nothing is
  // selected, sharing the same grid-column-collapse technique as the
  // sidebar toggle above rather than break's flex+margin-right, since
  // `.layout` is a grid here.
  const layoutClassName = [
    "layout",
    sidebarCollapsed && "layout--sidebar-collapsed",
    selectedQuestionId === null && "layout--panel-closed",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={layoutClassName}>
      <Sidebar
        graph={graph}
        selectedId={selectedQuestionId}
        onSelectQuestion={setSelectedQuestionId}
        onHighlight={setHighlightedIds}
      />
      <Canvas
        elements={elements}
        selectedId={selectedQuestionId}
        highlightedIds={highlightedIds}
        onSelectNode={(id) =>
          // Synthetic nodes -- the shared end-of-flow tag, a target this
          // version does not contain -- are not questions, so there is no
          // detail to show for them.
          setSelectedQuestionId(id !== null && !isSyntheticNode(id) ? id : null)
        }
        onSelectEdge={(edgeId) => {
          const edge = graph.edges.find((candidate) => candidate.id === edgeId);
          if (edge) setSelectedQuestionId(edge.from_question);
        }}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
        pickLabel={pick?.label ?? null}
        onPickTarget={pickCanvasTarget}
        onCancelPick={() => setPick(null)}
      />
      <DetailPanel
        graph={graph}
        question={selectedQuestion}
        editable={editable}
        changeKinds={changeKinds}
        retargetingEdgeId={pick?.kind === "retarget" ? pick.edgeId : null}
        addingRouteOptionId={pick?.kind === "add" ? pick.optionId : null}
        onSelectQuestion={setSelectedQuestionId}
        onStartRetarget={(edgeId, label) =>
          setPick({ kind: "retarget", edgeId, label })
        }
        onStartAddRoute={(questionId, optionId, label) =>
          setPick({ kind: "add", questionId, optionId, label })
        }
        onCancelPick={() => setPick(null)}
        onClose={() => setSelectedQuestionId(null)}
      />
    </div>
  );
}
