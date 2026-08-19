import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { ApiError } from "../api/client";
import * as api from "../api/endpoints";
import type { StaffIdentity } from "../api/types";
import { AuthContext } from "./context";
import type { AuthState } from "./context";

const STORAGE_KEY = "bvi-flow-tool.identity";

function readStoredIdentity(): StaffIdentity | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && "email" in parsed) {
      return parsed as StaffIdentity;
    }
  } catch {
    // A corrupt or unavailable store is not worth failing over: the worst
    // case is one extra sign-in.
  }
  return null;
}

function writeStoredIdentity(identity: StaffIdentity | null): void {
  try {
    if (identity === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // Private-mode browsers refuse writes; the app works without it, it
    // just asks for the password again in a new tab.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<StaffIdentity | null>(readStoredIdentity);
  const [editRefused, setEditRefused] = useState(false);
  const queryClient = useQueryClient();

  const forget = useCallback(() => {
    setIdentity(null);
    setEditRefused(false);
    writeStoredIdentity(null);
    // Cached graphs belong to the account that fetched them. Leaving them
    // would show the next person a map they may have no permission to see,
    // for as long as it takes the refetch to fail.
    queryClient.clear();
  }, [queryClient]);

  const signIn = useCallback(async (email: string, password: string) => {
    const next = await api.login(email, password);
    writeStoredIdentity(next);
    setIdentity(next);
    setEditRefused(false);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Already-dead sessions answer 401/403 here. The point of the call
      // is to revoke the server's copy; the client's is being dropped
      // either way, so a failure changes nothing worth reporting.
    }
    forget();
  }, [forget]);

  const noteApiError = useCallback(
    (error: unknown) => {
      if (!(error instanceof ApiError)) return;
      if (error.isUnauthenticated) forget();
    },
    [forget],
  );

  // Only the write paths call this, and only for a 403 that is a permission
  // refusal rather than a failed CSRF check. A bare "any 403 means no edit
  // access" rule would be wrong twice over: the versions list answers 403
  // when the account lacks *view* access, and `enforce_csrf` raises
  // `PermissionDenied` for a missing token, which is a fixable client bug
  // and not a statement about the account at all.
  const noteEditRefused = useCallback(() => setEditRefused(true), []);

  const value = useMemo<AuthState>(
    () => ({ identity, editRefused, signIn, signOut, noteApiError, noteEditRefused }),
    [identity, editRefused, signIn, signOut, noteApiError, noteEditRefused],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
