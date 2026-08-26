# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

Internal, admin-only frontend for viewing and proposing changes to a
questionnaire's branching logic. It is the UI for **bvi-backend**'s
`staff/flow-tool/` API (`bvi_backend/questionnaires/api/flow_tool/` in the
sibling `bvi-backend` repo) — this app has no backend of its own, and no
business logic is re-implemented here (see "Two rules this codebase keeps"
below). React 19 + TypeScript + Vite, React Router, TanStack Query,
Cytoscape.js + `cytoscape-dagre` for the canvas. No CSS framework — one
plain stylesheet, `src/styles/app.css`.

It is a **proposal system, not a live editor**: edits land on a draft copy
of a questionnaire version, and publishing is a separate, reviewed step
(`open → submitted → approved → published`, mirroring `ChangeRequest` on
the backend). **Only one draft may be open per questionnaire at a time**
— `editing.create_draft` refuses a second one (`DraftAlreadyExistsError`, 409) until the first is published or discarded. This is deliberately
stricter than "no data loss": two open drafts never silently conflicted
even before this (`StaleDraftError` refused whichever published second),
but the loser had to redo their work from scratch, and this removes that
risk by construction instead of explaining it after the fact.

## Architecture

- **`src/api/`** — the whole contract with Django, split by concern:
  - `client.ts` — the one `fetch` wrapper. Handles the session cookie
    (`credentials: "include"`), the CSRF header (reads `csrftoken` _or_
    `__Secure-csrftoken`, since `bvi-backend`'s `production.py` renames the
    cookie under a `__Secure-` prefix and dev doesn't), and flattens every
    DRF error shape into one `ApiError` with typed discriminators
    (`isUnauthenticated`, `isForbidden`, `isCsrfFailure`, `isConflict`,
    `lockHolder`). **Read this file's error-discrimination logic before
    touching any error handling** — a bare `status === 403` check is wrong
    twice over here (a CSRF failure and a permission refusal are both 403,
    and need different UI responses).
  - `endpoints.ts` — one function per backend endpoint, thinly typed,
    matching `flow_tool/urls.py` route-for-route. Nested writes
    (`versions/{id}/edges/{id}/`) stay nested in the path here too.
  - `queries.ts` — TanStack Query hooks over `endpoints.ts`
    (`useVersions`, `useGraph`, `useReview`). `retryUnlessRefused` is the
    shared retry policy: a 4xx is a decision the server already made, not
    a network blip, so it never retries; anything else gets two.
  - `types.ts` — hand-mirrors the backend's DRF serializers. **When a
    `flow_tool` serializer changes in `bvi-backend`, this file has to
    change by hand to match** — there is no codegen.
- **`src/auth/`** — `AuthProvider`/`useAuth`/`context.ts`, `LoginPage.tsx`.
  See "Auth model" below for why identity is cached in `localStorage`.
- **`src/flow/`** — the app itself:
  - `VersionLayout.tsx` / `VersionLanding.tsx` — the shared per-version
    shell (topbar, draft bar, version fetch) that `MapView`/`ReviewView`/
    `PreviewView` all mount under.
  - `MapView.tsx`, `Canvas.tsx`, `canvasStyle.ts`, `graphElements.ts` — the
    canvas. `graphElements.ts` turns a `Graph` API response into Cytoscape
    elements (`buildElements`); `canvasStyle.ts` is the Cytoscape
    stylesheet. Kept as two files on purpose: one decides _what_ each
    node/edge's data means, the other decides what that data _looks_
    like.
  - `Sidebar.tsx` — section list, search, diagnostics counts, all
    click-through to a node.
  - `DetailPanel.tsx`, `EdgeEditor.tsx`, `QuestionEditor.tsx`,
    `OptionEditor.tsx`, `SectionEditor.tsx`, `AddQuestion.tsx` — the
    content-editing surface for an open draft.
  - `ReviewView.tsx`, `DiffList.tsx` — the diff against the version a
    draft was copied from, plus approve/reject/publish.
  - `PreviewView.tsx` — click-through respondent simulation
    (`routing.walk_choices` on the server; this view has no routing logic
    of its own, see below).
  - `DraftBar.tsx` — the lock/status banner shown on an open draft.
  - `labels.ts` — every plain-English string this app shows for an enum,
    status, or diffed field name. Add new copy here, not inline in a
    component.
  - `useWriteError.ts`, `versionContext.ts` — shared write-error handling
    and the version-scoped React context `VersionLayout` provides.
- **`src/test/`** — `fixtures.ts` (a hand-built `Graph`/version fixture
  set — `Q1`..`Q4` etc.), `render.tsx`, `setup.ts`. Vitest + Testing
  Library; `npm test` runs once, `npm run test:watch` for TDD.

## Two rules this codebase keeps

**It never re-implements routing.** The critical instruction from the
backend's own spec is that the editor has to read routing through the same
functions the live runtime uses — the practical consequence here is that
_every write refetches the map_ rather than patching optimistically. The
server renumbers edge priorities on reorder, refuses a per-option edge
below a question-level fallback, and recomputes reachability from the new
edge set; reproducing any of that in TypeScript would be the second
implementation the instruction forbids. If a change here starts computing
diagnostics, reachability, or priority ordering client-side, that's a sign
the design is being violated, not a shortcut worth taking.

One narrow, deliberate exception: `MapView.tsx`'s add-route pick sends an
explicit `priority` on `POST edges/` when the destination question
already has a question-level ("Anything else") edge, computed as one less
than the lowest `priority` already on that question (read straight off
the already-fetched graph). Omitting it would let the server's own
default -- new edges go last -- land the new edge _after_ the fallback,
which `editing.add_edge` refuses outright (a per-option edge below a
question-level one could never fire). This picks a number, not an
ordering: the server still fully re-validates and owns the actual
decision, exactly as it does for every other write. Don't generalize this
into computing priority anywhere else without checking the same
reasoning applies.

**Nothing is signalled by colour alone** (accessibility). Every state on
the canvas has a shape, line-style, or badge as well as a colour, and the
canvas itself is `role="img"` — it's a `<canvas>` with no DOM to traverse,
so the keyboard-navigable view of the same routing is the sidebar and the
detail panel, not a fake accessibility tree that would go stale. Keep this
in mind before adding a purely-colour-coded state anywhere.

One deliberate exception: retargeting an existing route, and adding a new
route for a specific answer (`Options.tsx`'s "Retarget" and "Add a route"
buttons, wired up in `MapView.tsx`/`Canvas.tsx` via one shared
click-to-pick state, `CanvasPick`) both require clicking the destination
question on the canvas — a real, acknowledged regression for anyone who
can't use a mouse, not an oversight. It was asked for explicitly, with
the trade-off named and confirmed twice before building it, to match
break-backend's own click-to-retarget UX rather than this app's original
dropdowns; "Add a route" picked up the same mechanism on a later,
explicit request rather than being reconsidered. Ending a flow does
**not** share this gap for an _existing_ route — `Options.tsx`'s "End the
flow here" button sets a route's target to end-of-flow with no canvas
interaction, because that action has no reliable canvas equivalent (the
shared end-of-flow node is only drawn when some edge already ends the
flow). A _newly added_ route has no such button, though: to add one that
ends the flow, add it to any question via the canvas first, then click
"End the flow here" on the row that creates. Don't extend canvas-click
editing to anything else on the strength of this precedent without
checking with the user first — it was an argued trade-off made twice for
this one piece of UX, not a general reversal of the rule above.

## Visual design: ported from break-backend

The canvas and CSS were deliberately made to look like a **different,
unrelated sibling repo**: `D:\FJ\break-backend`'s own questionnaire graph
editor (`break_backend/static/question_graph_editor/app.js` +
`styles.css`), which independently solved the same design problem for a
different product (BREAK). That app's actual literal STYLE array, badge
SVG icons, and section-color palette were read directly and copied
value-for-value — not approximated — into `src/flow/canvasStyle.ts` and
`src/flow/graphElements.ts`, and the cream/tan palette into
`src/styles/app.css`.

If canvas/CSS values here look like oddly specific numbers (a 13px badge,
a `-4px`/`4px` offset, `#faf5ec`), **that specificity is intentional and
sourced** — break's own team hit real, undocumented Cytoscape rendering
quirks getting the corner badges to render as circles at all instead of
silently vanishing (see that repo's `CLAUDE_HANDOFFS.LOCAL/
2026-07-23-graph-editor-ux-redesign.md`, "corner-badge rendering fight",
for the story). Don't "clean up" these values without checking that file
first.

One deliberate non-port: `hasFault`/dead/broken edge styling
(`dead_edge_ids`/`broken_edge_ids` in the diagnostics) is this app's own —
break's own routing model has no equivalent diagnostic, so there was
nothing to copy. Back-edges deliberately carry **no colour difference**
from a normal edge, matching break's own stated principle in their source
comments: identifiable by curved routing, not by hue.

Not ported (out of scope so far, not forgotten): break's hover-to-trace
interaction (hovering a node fades every edge except its own connected
ones). Neither app currently has this wired up here.

## Auth model

Login (`POST /api/staff/auth/login/`) is the _only_ response that names
the signed-in user — **there is no `GET /api/staff/auth/session/`
endpoint**. So `AuthProvider` caches that response in `localStorage`
(`bvi-flow-tool.identity`) and treats a `401` on any later call as "that
identity is stale," clearing it and returning to sign-in. It has no way to
know a priori whether an account holds `edit_flow_tool`/
`publish_flow_tool` — it finds out by trying a write and getting refused
(`noteEditRefused`/`noteReviewRefused` in `AuthProvider.tsx`), then hides
those controls for the rest of the session. If `bvi-backend` ever grows a
real session-introspection endpoint, this whole workaround should come
out — don't build more on top of the guess-by-refusal pattern without
checking whether that endpoint already exists.

Three **per-user** permission grants gate everything, and no role confers
any of them — not even Super Admin:

| Code                | Unlocks                              |
| ------------------- | ------------------------------------ |
| `view_flow_tool`    | The map, diagnostics, diff, preview  |
| `edit_flow_tool`    | Opening a draft and every edit on it |
| `publish_flow_tool` | Approving, sending back, publishing  |

Granted in bvi-backend's Django admin (Users → the user → Permission
grants), never via `seed_roles`. `publish_flow_tool` does not imply
`edit_flow_tool` — a reviewer isn't necessarily an author — and the
backend itself refuses an author approving their own proposal regardless
of what they hold, so a real deployment needs the publish grant on **at
least two accounts** before anything can ship.

## Routes

Three screens on one version, each a real URL rather than local state, so
"look at this diff" is a link:

- `/versions/:versionId` (`MapView`) — the canvas.
- `/versions/:versionId/review` (`ReviewView`) — the diff, summary counts,
  the publish check asked in advance, review history, approve/reject/
  publish.
- `/versions/:versionId/preview` (`PreviewView`) — walk the graph as a
  respondent would.

All three nest under `VersionLayout`, which does the one fetch of the
version/draft state they all need. `?question=<id>` on the map focuses a
node — how the review screen links "this change" straight to its node.

## Running it locally

The backend has to be running first:

```sh
cd ../bvi-backend
COMPOSE_FILE=docker-compose.local.yml docker compose up django
```

```sh
npm install
npm run dev          # http://localhost:3100
```

**The `/api` dev proxy (`vite.config.ts`) is not a convenience, it's
required.** All staff/client/advisor session cookies are `SameSite=Lax`
(`bvi_backend/users/api/auth/views.py`), which a browser withholds from
any cross-site subresource request — every `fetch` from a differently-
hosted SPA included. Proxying makes the browser see one origin, so the
cookie is same-site and actually gets sent. Override the proxy target with
`VITE_API_PROXY_TARGET` in a `.env` (see `.env.example`) if pointing at
something other than local Django.

## Commands

| Command                | What it does                                     |
| ---------------------- | ------------------------------------------------ |
| `npm run dev`          | Dev server on :3100, with the `/api` proxy       |
| `npm run build`        | `tsc --build` then production build to `dist/`   |
| `npm run typecheck`    | `tsc --build --force` (no emit)                  |
| `npm test`             | Vitest, once                                     |
| `npm run test:watch`   | Vitest, watch mode                               |
| `npm run lint`         | ESLint                                           |
| `npm run format`       | Prettier, writing                                |
| `npm run format:check` | Prettier, check-only                             |
| `npm run check`        | format:check + lint + typecheck + test, in order |

Run `npm run check` before considering any change done — it's the same
gate a PR should pass.

## Deploying to Vercel

`vercel.json` does two things: SPA fallback to `index.html` (so
`/versions/:id` survives a reload) and a rewrite of `/api/*` to the API's
real origin, making the **deployed** app same-origin with the API too —
same reason as the dev proxy, same `SameSite=Lax` constraint. That origin
is hardcoded in `vercel.json` (Vercel parses it before the build runs, so
a dashboard env var can't reach it) — change that one line to point a
branch at a different backend.

**The one required backend-side change**: add this app's deployed origin
to bvi-backend's `DJANGO_CSRF_TRUSTED_ORIGINS`. Without it, sign-in still
answers 200 (login runs before any session cookie exists, so
`enforce_csrf` never triggers on it) — the first **write** after that
(opening a draft, moving an edge) is what 403s with `CSRF Failed: Origin
checking failed`. `DJANGO_CORS_ALLOWED_ORIGINS` needs nothing: the browser
thinks it's talking to itself through the rewrite, so no preflight is
made.

Two consequences worth knowing:

- Vercel preview deployments get a fresh URL per deploy, which is never in
  the trusted list — reads work, writes 403 there. Use the stable
  per-branch alias if previews need to be usable.
- Every request arrives from Vercel's shared egress IPs, so
  `staff_login_ip` (10/min) is effectively shared across every user of
  this tool, not per person.

First-deploy check: sign in proves nothing (see above) — **open a draft**
to actually exercise the CSRF path.

## Known backend limitations

Both are gaps in `bvi-backend`, not choices made here:

- No session-introspection endpoint — see "Auth model" above.
- `Question.show_raw_answer_to_advisor` is writable but not readable:
  `FlowToolQuestionSerializer` doesn't serve it, so an existing question's
  value can't be read back. It's offered on **add question** (no prior
  value to misreport) and deliberately left off **edit question** (a
  checkbox seeded from a guess would silently overwrite the real value).
  Fixing it is a one-line backend serializer change, not something to work
  around further here.

## Git conventions

Conventional commits, lowercase, scoped where it helps
(`feat(flow): draft proposals and edge editing`, `chore(deploy): vercel
same-origin /api rewrite`, `docs: how to run, deploy and get access`) —
match the existing `git log`, don't invent a different style. No AI/tool
attribution in commits.
