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
 * rides along, and CORS/CSRF-trusted-origin configuration stops mattering
 * in development entirely.
 *
 * A deployed build keeps the same shape: `vercel.json` rewrites `/api/*` to
 * the API's origin, so the browser still sees one origin and the cookie is
 * still same-site. That is why nothing here or in `src/api` ever builds an
 * absolute URL -- every request is relative, and the proxy in front of it
 * (Vite's in development, Vercel's in a deployment) decides where it lands.
 * See README.md, "Deploying to Vercel".
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_API_PROXY_TARGET ?? "http://localhost:8000";

  return {
    plugins: [react()],
    server: {
      port: 3100,
      proxy: {
        "/api": {
          target,
          changeOrigin: false,
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
