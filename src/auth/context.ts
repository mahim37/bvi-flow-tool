import { createContext } from "react";

import type { StaffIdentity } from "../api/types";

export interface AuthState {
  /** Who this browser last signed in as, or null. Display-only: the
   * session itself is the httpOnly cookie, which this app cannot read. */
  identity: StaffIdentity | null;
  /** True once a write has come back 403, meaning the account holds
   * `view_flow_tool` but not `edit_flow_tool`. Starts false because
   * nothing tells the client its permission codes -- see `useAuth`. */
  editRefused: boolean;
  /** The same discovery for `publish_flow_tool`, kept apart from
   * `editRefused` because the two codes are separate grants and a
   * reviewer is deliberately not required to hold the edit one. Folding
   * them together would have one refusal disable the other's controls. */
  reviewRefused: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Feed every failed API call through here so a dead session ends up at
   * the sign-in screen instead of a wall of red panels. */
  noteApiError: (error: unknown) => void;
  /** Called by the write paths when a mutation was refused on permission
   * grounds, which is the only way this app can discover that the account
   * is view-only. */
  noteEditRefused: () => void;
  /** The same, for approve/reject/publish. Only called where the refusal
   * cannot be a self-review: the author is never offered approve or
   * reject, so a 403 there is about the grant rather than about who is
   * asking. */
  noteReviewRefused: () => void;
}

export const AuthContext = createContext<AuthState | null>(null);
