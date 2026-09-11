import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * The last line of defence against a blank page.
 *
 * React unmounts the whole tree on an uncaught render error with no
 * boundary in place, and this app's `body` background is the same cream
 * used everywhere in its chrome -- so a crash anywhere (a stale query still
 * holding data from one account while another 401s and signs it out
 * mid-render is the likeliest trigger, but not the only possible one) reads
 * as an unrecoverable, unexplained "blank beige screen" rather than an
 * error. A full reload is the fix rather than trying to resume in place:
 * it starts every provider and query fresh, which naturally lands on
 * sign-in if the session really is dead, or back on the map if it was not.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      "Uncaught error, showing the reload screen instead of a blank page:",
      error,
      info,
    );
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <main className="mx-auto flex min-h-svh max-w-[520px] flex-col items-center justify-center gap-2.5 bg-background p-6 text-center">
        <h1 className="m-0 text-xl font-extrabold tracking-tight">
          Something went wrong
        </h1>
        <p className="text-muted-foreground m-0">
          The app hit an unexpected error and cannot keep going from here. Reloading
          starts fresh. If your session had expired, this takes you back to sign-in.
        </p>
        <Button variant="primary" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </main>
    );
  }
}
