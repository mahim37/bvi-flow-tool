import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import type { UUID } from "../api/types";
import { Canvas } from "./Canvas";
import { DetailPanel } from "./DetailPanel";
import { Sidebar } from "./Sidebar";
import { useVersionContext } from "./versionContext";
import { buildElements, isSyntheticNode } from "./graphElements";

export function MapView() {
  const { graph, editable } = useVersionContext();
  const { versionId } = useParams<{ versionId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [selectedQuestionId, setSelectedQuestionId] = useState<UUID | null>(null);
  const [highlightedIds, setHighlightedIds] = useState<readonly string[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // `?question=` is how the review screen points at a node. In the URL
  // rather than in a handler, so "show me this change on the map" is a
  // link somebody can send, and so a reload lands on the same node.
  const focusId = searchParams.get("question");
  useEffect(() => {
    setSelectedQuestionId(focusId);
    setHighlightedIds(focusId === null ? [] : [focusId]);
  }, [versionId, focusId]);

  const elements = useMemo(() => buildElements(graph), [graph]);

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
      />
      <DetailPanel
        graph={graph}
        question={selectedQuestion}
        editable={editable}
        onSelectQuestion={setSelectedQuestionId}
        onPreviewFrom={() => navigate(`/versions/${versionId}/preview`)}
        onClose={() => setSelectedQuestionId(null)}
      />
    </div>
  );
}
