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
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Feed every failed API call through here so a dead session ends up at
   * the sign-in screen instead of a wall of red panels. */
  noteApiError: (error: unknown) => void;
  /** Called by the write paths when a mutation was refused on permission
   * grounds, which is the only way this app can discover that the account
   * is view-only. */
  noteEditRefused: () => void;
}

export const AuthContext = createContext<AuthState | null>(null);
