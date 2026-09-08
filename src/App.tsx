import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AuthProvider } from "./auth/AuthProvider";
import { LoginPage } from "./auth/LoginPage";
import { useAuth } from "./auth/useAuth";
import { ErrorBoundary } from "./ErrorBoundary";
import { MapView } from "./flow/MapView";
import { PreviewView } from "./flow/PreviewView";
import { ReviewView } from "./flow/ReviewView";
import { VersionLanding, VersionLayout } from "./flow/VersionLayout";
import { Card, CardDescription, CardHeader, CardTitle } from "./components/ui/card";

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

/**
 * Three screens on one version, so they share a route rather than a
 * component.
 *
 * The version picker, the proposal's status and the map itself are read
 * identically by all three; nesting them under `VersionLayout` means one
 * fetch of each and one place that decides what to show while they are in
 * flight. It also makes each view a real URL, so "look at this diff" is a
 * link somebody can send.
 */
function Shell() {
  const { identity } = useAuth();
  if (identity === null) return <LoginPage />;
  return (
    <Routes>
      <Route path="/versions/:versionId" element={<VersionLayout />}>
        <Route index element={<MapView />} />
        <Route path="review" element={<ReviewView />} />
        <Route path="preview" element={<PreviewView />} />
      </Route>
      <Route path="/" element={<VersionLanding />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <>
      {/* Ported from break-backend's #desktopRequired (index.html ~L12-18):
          the sidebar (300px) + detail panel (380px) alone need more room
          than a phone or small tablet has before the canvas gets any space
          to be useful, so below a real desktop/laptop width this replaces
          the app outright rather than letting the layout squish into
          something unusable. Pure CSS (`.app-shell` hidden by the same
          media query that shows this) -- no JS breakpoint state to keep in
          sync. */}
      <div className="desktop-required hidden max-[1024px]:fixed max-[1024px]:inset-0 max-[1024px]:z-100 max-[1024px]:flex max-[1024px]:items-center max-[1024px]:justify-center max-[1024px]:bg-background max-[1024px]:p-6">
        <Card className="w-full max-w-[520px] py-8 text-center shadow-md">
          <CardHeader className="gap-3">
            <CardTitle className="text-xl font-extrabold tracking-tight">
              Desktop required
            </CardTitle>
            <CardDescription className="text-base text-pretty">
              The flow tool needs a larger screen to use safely — please switch to a
              desktop or laptop to continue.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
      <div className="app-shell flex h-svh min-h-0 flex-col overflow-hidden max-[1024px]:hidden">
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter>
              <AuthProvider>
                <Shell />
              </AuthProvider>
            </BrowserRouter>
          </QueryClientProvider>
        </ErrorBoundary>
      </div>
    </>
  );
}
