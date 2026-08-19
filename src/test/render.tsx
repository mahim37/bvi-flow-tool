import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import { AuthProvider } from "../auth/AuthProvider";

/** Components under test sit inside the query client and the auth context
 * in the real app, and several of them read both, so the helper provides
 * the same pair rather than each test rebuilding it. Retries are off:
 * a test that asserts on an error should not wait through a backoff. */
export function renderWithProviders(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{ui}</AuthProvider>
    </QueryClientProvider>,
  );
}
