# Questionnaire flow tool

Internal, admin-only UI for viewing and proposing changes to questionnaire
branching logic. It is the frontend for the `staff/flow-tool/` API in
`bvi-backend`, and it is a **proposal system, not a live editor** — edits land
on a draft copy of a version, and publishing is a separate, reviewed step.

## Running it

The backend has to be up first:

```sh
cd ../bvi-backend
COMPOSE_FILE=docker-compose.local.yml docker compose up django
```

Then:

```sh
npm install
npm run dev
```

`vite.config.ts` proxies `/api` to http://localhost:8000. Override with
`VITE_API_PROXY_TARGET` in a `.env` file (see `.env.example`).

**The proxy is not a convenience.** All three session cookies are issued
`SameSite=Lax` (`bvi_backend/users/api/auth/views.py`, and the client and
advisor equivalents). A `Lax` cookie is withheld from cross-site subresource
requests, which is what every `fetch` from a SPA is — so a browser talking
straight to a different-origin API sends no `staff_session` and gets 401 no
matter how correct the credentials are. Proxying makes the browser see one
origin, so the cookie is same-site and rides along.

A deployed build keeps the same shape rather than dropping the proxy — see
below.

## Deploying to Vercel

`vercel.json` does two things. It falls back to `index.html` so the router's
`/versions/:id` URLs survive a reload, and it rewrites `/api/*` to the API's
origin so **the deployed app is same-origin with the API too**. That second
rewrite is what makes cookie auth work at all: it is the production
equivalent of the dev proxy, for the reason above, and it is why no code in
`src/` ever builds an absolute API URL.

Import the repo on Vercel and accept the detected settings (framework
`vite`, build `npm run build`, output `dist`) — `vercel.json` states them
anyway. There are **no environment variables to set**; the API origin is the
one line in `vercel.json`:

```json
{ "source": "/api/(.*)", "destination": "https://bvi-dev.therewirelab.com/api/$1" }
```

Change that line to point a branch at staging. It is hardcoded rather than
read from an env var because Vercel parses `vercel.json` before the build,
so nothing set in the dashboard can reach it.

### The one backend change

Add this app's production origin to **`DJANGO_CSRF_TRUSTED_ORIGINS`** on the
API. Django compares the `Origin` header against its own host, and the
rewrite leaves `Origin` as the Vercel domain while `Host` becomes the API's,
so without this every authenticated write is refused with:

```
403 {"detail": "CSRF Failed: Origin checking failed -
     https://<this app>.vercel.app does not match any trusted origins."}
```

**Signing in is not what breaks**, which is the confusing part.
`StaffSessionAuthentication.authenticate` returns early when there is no
session cookie, so `enforce_csrf` never runs on the login request itself —
login answers 200 and sets both cookies quite happily. The failure lands on
the first write after that: opening a draft, or moving an edge.

`DJANGO_CORS_ALLOWED_ORIGINS` needs **nothing**: the browser thinks it is
talking to itself, so no preflight is made and no CORS header is consulted.

Two consequences worth knowing:

- **Preview deployments get a fresh URL per deployment**, which will not be
  in the trusted list, so writes fail there while reads work. Trust the
  stable per-branch alias (`…-git-<branch>-<team>.vercel.app`) if previews
  need to be usable, and do not reach for `https://*.vercel.app` — that
  trusts every app on the platform.
- **Every request arrives from Vercel's egress IPs**, so `staff_login_ip`
  (10/min, `config/settings/base.py`) is shared across everyone using this
  tool rather than per person. Fine for a handful of admins; the per-email
  cap is unaffected.

### First deploy: check these three things

1. **Open a draft**, rather than only signing in — see above for why signing
   in proves nothing. A 403 mentioning `Origin checking failed` means the
   trusted origin is missing.
2. **Trailing slashes.** Django's API paths end in `/`. Confirm
   `POST /api/staff/auth/login/` is not redirected to a slashless path — a
   redirect would drop the request body. `trailingSlash` is deliberately
   left unset in `vercel.json` so Vercel enforces nothing either way.
3. **The session survives a reload**, which means `Set-Cookie` came back
   through the rewrite and the browser kept it for the Vercel host.

No Content-Security-Policy is set yet. Adding one is worthwhile and is left
out here rather than shipped unverified.

## Getting access

Three **per-user** grants, and no role confers any of them — `seed_roles`
grants them to nobody, including Super Admin. Grant them in Django admin on
the user (Users → _the user_ → Permission grants), which records an audited
`PERMISSION_GRANTED` event.

| Code                | What it unlocks                                 |
| ------------------- | ----------------------------------------------- |
| `view_flow_tool`    | The map, the diagnostics, the diff, the preview |
| `edit_flow_tool`    | Opening a draft and every edit on it            |
| `publish_flow_tool` | Approving, sending back, and publishing         |

`publish_flow_tool` deliberately does not imply `edit_flow_tool`: a reviewer
is not necessarily somebody who proposes changes. And **the author of a
proposal cannot approve their own** whatever they hold, so a deployment needs
the publish grant on **at least two accounts** before anything can ship. The
review screen does not offer an author the approve and send-back controls at
all, since pressing them could only ever produce a 403.

An account without `view_flow_tool` gets an explanatory screen rather than a
sign-in loop, because signing in again would never help. The other two are
discovered by being refused — see "Known limitations".

## Scripts

| Command          | What it does                                |
| ---------------- | ------------------------------------------- |
| `npm run dev`    | Dev server on :3100 with the `/api` proxy   |
| `npm run build`  | Typecheck, then production build to `dist/` |
| `npm test`       | Vitest, once                                |
| `npm run lint`   | ESLint                                      |
| `npm run format` | Prettier, writing                           |
| `npm run check`  | format check + lint + typecheck + tests     |

## What it does

Three screens on one version, each a real URL: `/versions/:id` for the map,
`/versions/:id/review` for the diff, `/versions/:id/preview` for the walk. So
"look at this diff" is a link somebody can send, and a change on the review
screen can jump straight to its node on the map (`?question=<id>`).

- **Canvas** (spec §4.2) — Cytoscape with a dagre layout. Archived questions
  appear only while something still points at them, and there is no toggle to
  bring the rest back.
- **Navigation** (§4.3) — section list, search over code and prompt,
  click-through from any diagnostic to the question it concerns.
- **Detail panel** (§4.4) — one question's options, its outgoing edges in
  priority order, what reaches it, and its own diagnostics.
- **Diagnostics** (§4.5) — entry, decision points, terminals, unreachable
  questions, plus the three the explicit-edge model makes computable:
  uncovered answers, dead edges and broken edges. Every count says what it
  means.
- **Proposals** (§4.6) — open a draft from any published version, retarget,
  add, remove and reorder edges on it, then submit for review.
- **Locking** (§4.7) — shows who is holding a draft and since when.
- **Review and publish** (§4.8) — the **Review** tab: the diff against the
  version this draft was copied from, grouped by kind and matched by code;
  added/removed/changed counts; the publish check asked in advance, so a
  reviewer learns a graph is unpublishable while reading it rather than after
  approving it; every review round with its reviewer and reasons; then
  approve, send back, or publish.
- **Preview** (§4.9) — the **Preview** tab: walk any graph version as a
  respondent would, through the runtime's own resolver. A cycle or a dangling
  target answers 409 and is rendered as the finding it is: the crash a
  respondent would get, found by somebody who can still fix it.
- **Content editing** (§4.11's editing half) — on an open draft: add, edit and
  retire questions; add, reword, reorder and delete options; add, rename,
  reorder and delete sections; reorder the question list.
- **History, in part** (§4.10) — a version is its own snapshot, so the Review
  tab on a _published_ version answers "what did this release change" against
  the one it superseded, and shows the proposal and review rounds behind it.
- **Concurrent sandboxes** (plan §2.8) — several drafts can be open against one
  questionnaire at once. The version picker groups by questionnaire and can be
  filtered to one; a draft the live version has moved out from under is marked
  **behind live** in the picker, on the draft bar and on the review screen,
  through the server's own `is_stale`.

Not built, because the backend does not have it yet: snapshot **rollback** as a
framed operation (activating an older version is still a Django-admin job), and
side-by-side compare of two sandboxes, which needs the pairwise
`diffing.diff(left, right)` — see `../bvi-backend/FLOW_TOOL_PLAN.md` §4.1 and
§4.5.

## Two rules this codebase keeps

**It never re-implements routing.** The spec's critical instruction is that the
editor must read routing through the same functions the live runtime uses, and
the practical consequence here is that _every write refetches the map_ rather
than patching it optimistically. The server renumbers priorities on reorder,
refuses a per-option edge below a question-level fallback, and recomputes
reachability from the new edge set — reproducing any of that in TypeScript
would be the second implementation the instruction forbids. See
`src/api/queries.ts`.

**Nothing is signalled by colour alone** (§4.11). Every state on the canvas has
a shape or line-style as well as a colour, the legend spells the vocabulary out
in text, and the canvas itself is `role="img"`: it is a `<canvas>` with no DOM
to traverse, so the keyboard-navigable view of the same routing is the sidebar
and the detail panel rather than a fake accessibility tree that would go stale.

## Known limitations

Both are backend gaps rather than choices made here, and both are small.

**There is no `GET /api/staff/auth/session/`.** The backend exposes permission
codes to no client, and staff login is the only response that names the user,
so this app remembers the login response in `localStorage` and discovers that
an account lacks `edit_flow_tool` or `publish_flow_tool` by having a write
refused. A session endpoint returning `{email, name, role, permission_codes}`
would remove that guesswork — and would let the controls be hidden up front
rather than after the first refusal. Until then a stale remembered identity
self-corrects: the first call made with a dead cookie answers 401 and the app
returns to sign-in.

**`show_raw_answer_to_advisor` is writable but not readable.**
`FlowToolQuestionSerializer` does not serve it, so an existing question's value
cannot be read back. It is therefore offered on the _add question_ form, where
there is no prior value to misreport, and deliberately left off the edit form:
a checkbox that started from a guess would silently overwrite whatever was
really set. Adding the field to that serializer is the whole fix.
