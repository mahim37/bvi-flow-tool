import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AuthProvider } from "./auth/AuthProvider";
import { LoginPage } from "./auth/LoginPage";
import { useAuth } from "./auth/useAuth";
import { FlowToolPage } from "./flow/FlowToolPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The map is a picture of data somebody else may be editing, so a
      // refetch when the tab comes back is the point rather than a cost.
      refetchOnWindowFocus: true,
      staleTime: 10_000,
    },
  },
});

function Shell() {
  const { identity } = useAuth();
  if (identity === null) return <LoginPage />;
  return (
    <Routes>
      <Route path="/versions/:versionId" element={<FlowToolPage />} />
      <Route path="/" element={<FlowToolPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
