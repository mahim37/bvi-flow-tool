import { useId, useState } from "react";

import { ApiError } from "../api/client";
import croppedLogo from "../assets/predmind-logo - cropped.webp";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "./useAuth";

export function LoginPage() {
  const { signIn } = useAuth();
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (caught) {
      // The backend answers a wrong password and an unknown address with
      // the same message on purpose, so there is nothing to add here --
      // passing its wording through keeps this screen from inventing a
      // distinction the API deliberately refuses to make.
      setError(
        caught instanceof ApiError ? caught.message : "Could not reach the server.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-2.5 bg-background p-6">
      <Card className="w-full max-w-[340px] py-7 shadow-md">
        <CardContent className="flex flex-col gap-4">
          <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
            <div className="flex items-start gap-3">
              <img className="block h-8 w-auto shrink-0" src={croppedLogo} alt="" />
              <div>
                <h1 className="m-0 text-xl font-extrabold tracking-tight">Flow Tool</h1>
                <p className="text-muted-foreground mt-1 mb-0 text-[0.85rem]">
                  Internal tool. Staff sign-in required.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={emailId}>Email</Label>
              <Input
                id={emailId}
                type="email"
                name="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={passwordId}>Password</Label>
              <Input
                id={passwordId}
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            {error !== null && (
              <Banner tone="error" id={errorId} role="alert">
                {error}
              </Banner>
            )}

            <Button
              variant="primary"
              type="submit"
              className="w-full"
              disabled={busy}
              {...(error !== null ? { "aria-describedby": errorId } : {})}
            >
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
