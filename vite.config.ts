import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

/**
 * The dev server proxies `/api` to Django rather than letting the app call
 * the backend's origin directly, and that is a correctness decision rather
 * than a convenience one.
 *
 * All three session cookies are issued `SameSite=Lax`
 * (`bvi_backend/users/api/auth/views.py`). A Lax cookie is withheld from
 * cross-site subresource requests, which is what every `fetch` from this
 * app is, so a direct cross-origin call would send no `staff_session` and
 * the API would answer 401 no matter how correct the credentials were.
 * Proxying makes the browser see one origin, so the cookie is same-site and
 * rides along.
 *
 * Against local Django, `changeOrigin` stays false so the Host header is
 * still `localhost:3100`. Origin and Host then match, and CSRF trusted-
 * origin config does not come into it. Against a hosted API, Host has to
 * be the real hostname or nginx/Django refuse the request, so we rewrite
 * it (`changeOrigin: true`) and strip `Domain=` off `Set-Cookie` so the
 * browser will store `staff_session` for localhost rather than for
 * `therewirelab.com`. Writes to a hosted API can still 403 CSRF unless
 * `http://localhost:3100` is in `DJANGO_CSRF_TRUSTED_ORIGINS` -- reads
 * (the map) do not need that.
 *
 * A deployed build keeps the same shape: `vercel.json` rewrites `/api/*` to
 * the API's origin, so the browser still sees one origin and the cookie is
 * still same-site. That is why nothing here or in `src/api` ever builds an
 * absolute URL -- every request is relative, and the proxy in front of it
 * (Vite's in development, Vercel's in a deployment) decides where it lands.
 * See README.md, "Deploying to Vercel".
 */
function isLocalApiTarget(target: string): boolean {
  try {
    const { hostname } = new URL(target);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_API_PROXY_TARGET ?? "http://localhost:8000";
  const local = isLocalApiTarget(target);

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
    server: {
      port: 3100,
      proxy: {
        "/api": {
          target,
          changeOrigin: !local,
          // Empty string removes `Domain=` so the cookie is host-only for
          // localhost. A rewrite to "localhost" would still be wrong if
          // the API set `Domain=therewirelab.com`.
          ...(local ? {} : { cookieDomainRewrite: "" }),
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Cytoscape and dagre are ~three quarters of the bundle and
          // change only when a dependency is bumped, so they are split
          // out to be cached on their own. This is about how long the
          // bytes live in a browser, not about how many there are: the
          // asset URLs are content-hashed and `vercel.json` serves them
          // `immutable`, so a deploy that touches only app code leaves
          // this chunk untouched.
          manualChunks: {
            cytoscape: ["cytoscape", "cytoscape-dagre", "dagre"],
          },
        },
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
      css: false,
    },
  };
});
