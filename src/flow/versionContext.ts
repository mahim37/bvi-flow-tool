import { useOutletContext } from "react-router-dom";

import type { Graph, VersionListItem } from "../api/types";

/**
 * What every screen under a version needs, fetched once by `VersionLayout`.
 *
 * The map, the review screen and the preview all sit on the same version
 * and the same proposal, so the version list and the graph are read once
 * rather than three times over. `graph` is non-null by construction: the
 * layout renders its own loading and refusal states and only reaches
 * `<Outlet />` when there is a map to hand.
 *
 * In its own module rather than beside the layout so the layout file
 * exports only components, which is what keeps fast refresh working.
 */
export interface VersionContext {
  graph: Graph;
  versions: VersionListItem[];
  /**
   * Whether this screen may write.
   *
   * A draft whose proposal is still `open`, and nothing else. `submitted`
   * and `approved` are frozen on purpose -- what gets published has to be
   * what was read -- and a published version is not a draft at all. The
   * server enforces every one of those; this is the same rule stated where
   * the controls are drawn, so nothing offers a button whose only outcome
   * is a 409.
   */
  editable: boolean;
}

export function useVersionContext(): VersionContext {
  return useOutletContext<VersionContext>();
}
