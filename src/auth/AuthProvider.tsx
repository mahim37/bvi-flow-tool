import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError } from "../api/client";
import * as api from "../api/endpoints";
import { EDIT_FLOW_TOOL, PUBLISH_FLOW_TOOL, type StaffIdentity } from "../api/types";
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

function applyGrantHints(
  identity: StaffIdentity | null,
  setEditRefused: (value: boolean) => void,
  setReviewRefused: (value: boolean) => void,
): void {
  if (identity === null || !Array.isArray(identity.permission_codes)) return;
  setEditRefused(!identity.permission_codes.includes(EDIT_FLOW_TOOL));
  setReviewRefused(!identity.permission_codes.includes(PUBLISH_FLOW_TOOL));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<StaffIdentity | null>(readStoredIdentity);
  const [editRefused, setEditRefused] = useState(false);
  const [reviewRefused, setReviewRefused] = useState(false);
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: ["session"],
    queryFn: ({ signal }) => api.fetchSession(signal),
    retry: false,
    staleTime: 30_000,
  });

  const forget = useCallback(() => {
    setIdentity(null);
    setEditRefused(false);
    setReviewRefused(false);
    writeStoredIdentity(null);
    // Cached graphs belong to the account that fetched them. Leaving them
    // would show the next person a map they may have no permission to see,
    // for as long as it takes the refetch to fail.
    queryClient.clear();
  }, [queryClient]);

  const remember = useCallback((next: StaffIdentity) => {
    writeStoredIdentity(next);
    setIdentity(next);
    applyGrantHints(next, setEditRefused, setReviewRefused);
  }, []);

  useEffect(() => {
    if (session.data !== undefined) remember(session.data);
  }, [session.data, remember]);

  useEffect(() => {
    if (!(session.error instanceof ApiError) || !session.error.isUnauthenticated) {
      return;
    }
    // Only drop a remembered identity. A 403 on the login screen is the
    // expected "no cookie" answer; calling `forget` there would clear the
    // session query and refetch it in a loop.
    if (identity !== null) forget();
  }, [session.error, identity, forget]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const next = await api.login(email, password);
      remember(next);
      setEditRefused(false);
      setReviewRefused(false);
      applyGrantHints(next, setEditRefused, setReviewRefused);
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
    [queryClient, remember],
  );

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

  // Separate from the above because `edit_flow_tool` and
  // `publish_flow_tool` are separate grants: an account may hold either,
  // both or neither, and a reviewer deliberately does not need the edit
  // code. One flag for both would have a refused edit hide the review
  // controls of somebody entitled to use them.
  const noteReviewRefused = useCallback(() => setReviewRefused(true), []);

  const sessionPending = session.isPending && identity === null;

  const value = useMemo<AuthState>(
    () => ({
      identity,
      sessionPending,
      editRefused,
      reviewRefused,
      signIn,
      signOut,
      noteApiError,
      noteEditRefused,
      noteReviewRefused,
    }),
    [
      identity,
      sessionPending,
      editRefused,
      reviewRefused,
      signIn,
      signOut,
      noteApiError,
      noteEditRefused,
      noteReviewRefused,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
