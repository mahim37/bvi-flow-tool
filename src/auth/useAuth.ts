import { useContext } from "react";

import { AuthContext } from "./context";
import type { AuthState } from "./context";

/**
 * The signed-in account, as far as this app can know it.
 *
 * There is no endpoint that answers "who am I and what may I do" -- the
 * backend exposes permission codes to no client at all (`granted_codes` is
 * read server-side only), and staff login is the one response that names
 * the user. So identity here is what login returned, remembered in
 * `localStorage`, and edit access is discovered by being refused.
 *
 * That is a real limitation rather than a stylistic one, and the fix is a
 * small `GET /api/staff/auth/session/` returning `{email, name, role,
 * permission_codes}`. Until it exists: a stale remembered identity
 * self-corrects, because the first API call made with a dead cookie
 * answers 401 and `noteApiError` clears it.
 */
export function useAuth(): AuthState {
  const state = useContext(AuthContext);
  if (state === null) {
    throw new Error("useAuth must be used inside <AuthProvider>.");
  }
  return state;
}
