import { useContext } from "react";

import { AuthContext } from "./context";
import type { AuthState } from "./context";

/**
 * The signed-in account, as far as this app can know it.
 *
 * Identity and `permission_codes` come from `GET /api/staff/auth/session/`
 * (and from login, until that refresh lands). `editRefused` /
 * `reviewRefused` start from those codes and still flip on a write 403
 * if a grant is revoked mid-session.
 */
export function useAuth(): AuthState {
  const state = useContext(AuthContext);
  if (state === null) {
    throw new Error("useAuth must be used inside <AuthProvider>.");
  }
  return state;
}
