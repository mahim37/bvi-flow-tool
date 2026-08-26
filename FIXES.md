# Break-backend parity — punch list

Working list from porting break-backend's `question_graph_editor` UI onto
this app. Priority order, not chronological.

## Done

- Hover-to-trace: hovering a node fades everything except its own
  connected edges/neighbours.
- Canvas chrome: zoom in/out/fit/reset controls, bottom-center status hint
  bar.
- Topbar: question-count and pending-count stat pills, a subtitle line.
- Sidebar rebuild: Sections as a flat click-to-highlight-and-pan legend
  (numbered, rounded-square colour swatches, left-aligned), Diagnostics /
  History / "What do the colors mean?" collapsed into one tight
  disclosure group with break's real chevron icon, capped + independently
  scrollable bodies, alignment and spacing fixes.
- History panel: wired up `listHistory`, which existed in `endpoints.ts`
  but had no query hook or screen anywhere in the app.
- Legend content corrected: the old text described shapes the canvas
  never draws (circle/diamond/double border); now uses the real badge
  icons (`BadgeIcon`, reusing `canvasStyle.ts`'s actual SVG paths) and
  accurate descriptions per diagnostic.
- Session-expiry bug: a hooks-order crash (`useProposals` declared after
  an early return) plus a 401-vs-403 misclassification (`bvi-backend`'s
  `StaffSessionAuthentication` never sends `WWW-Authenticate`, so every
  auth failure downgrades to 403, indistinguishable by status code alone
  from a real permission refusal) that together meant a dead session
  never reached the sign-in screen.
- Exact-value pass: topbar/sidebar/panel backgrounds, padding, font
  sizes, and border-radius matched to break's literal CSS values (not
  `rem`-based approximations, which silently drifted since this app's
  root font-size differs from break's implicit 16px).
- Sidebar-collapse toggle: a hamburger button in the canvas's own chrome
  (break's lives in the topbar, but this app's topbar is shared across
  Map/Review/Preview while the sidebar is Map-only) collapses `.layout`'s
  grid column to 0. Resize handled by a `ResizeObserver` on the canvas
  container rather than break's `setTimeout` tied to the transition
  duration.
- Desktop-required gate: below 1024px width the app is replaced outright
  by a warning card, same breakpoint/copy/sizes as break's, pure CSS (no
  JS breakpoint state). The existing 1100px reflow still does useful work
  in the 1024-1100px range above the new hard block.
- Detail panel, visual parity pass: slide-in drawer (grid-column
  collapse, same technique as the sidebar toggle, plus a `#detailClose`-
  style close button) instead of a permanently visible column; content
  reordered to break's flags → meta → id/text → answers → reached-from →
  danger-zone; question prompt edited in place (`PromptEditor`, break's
  own affordance) instead of only through the persistent form; flags/
  section-badge/type-chip/answer-cards/destination-chips/reached-from
  cards all restyled to break's literal CSS (`.flag`, `.d-meta`,
  `.d-section-badge`, `.opt`/`.opt-dest`, `.in-row`, `.d-sub`+count
  bubble). `EdgeEditor` deliberately kept a flat priority-ordered edge
  list rather than break's per-answer grouping + bulk-retarget picker —
  grouping by answer would hide the real precedence between a per-option
  edge and a question-level "any answer" edge that can both match the
  same answer. (Its dropdown-based retarget control was later replaced by
  canvas click-to-retarget — see "Done" further down and `CLAUDE.md`'s
  accessibility section.) `QuestionEditor`'s persistent form lost only
  the `prompt` field (now
  edited inline); code/type/section/required/reorder/retire stayed,
  since break has no equivalent for any of them to match.
- Detail panel, follow-up: the inline text-only editor and the separate
  "Edit this question" form were two edit affordances for one thing.
  Merged into one -- `QuestionEditor` now sits in the header next to the
  question text, closed by default behind the same "Edit" toggle, opening
  into one form covering text + code + type + section + required.
  Reorder controls stay always-visible below it (a position action, not a
  field edit). Retire stays in the separate Danger Zone at the bottom.
- Detail panel, follow-up: dropped the reorder control entirely (Move
  earlier/later + "Position N of M"). It only swapped one adjacent pair
  at a time, so it was never a realistic way to reach the one thing it
  actually changed (entry point = position 1), and did nothing but
  reshuffle cosmetic list order the rest of the time. `useReorderQuestions`
  stays in `endpoints.ts`/`queries.ts`, unused, per this repo's existing
  practice of keeping API coverage regardless of whether a screen calls
  it yet.
- Detail panel, follow-up: merged Options / Edit options / Outgoing edges
  into one "Options" section (`Options.tsx`, replacing both
  `OptionEditor.tsx` and `EdgeEditor.tsx`). One card per answer, its
  edges nested inside the same card instead of three separate places
  (also fixed a real duplicate-display bug: the old read-only Options
  list and the editable Options form used to render simultaneously
  whenever a draft was editable). A "Dead edges" card catches edges
  guarded by an option this question doesn't offer -- grouping strictly
  by this question's own options would have silently dropped them
  instead of just failing to route.
- Detail panel, follow-up: Options' per-answer rename/reorder/delete and
  per-route retarget/reorder/remove now collapse behind a per-card "Edit"
  toggle (was expanded by default the moment a draft was editable) --
  same pattern as `QuestionEditor`'s text-edit toggle. "Add an answer" /
  "Add a route" collapse behind their own buttons too. Also reworded this
  section's copy for a non-technical audience: "edge"/"guard" replaced
  with "route"/"answer" in every visible string (dead/broken-route
  explanations, the in-use-delete refusal, the top hint, the add-route
  form). General principle going forward, not just this section:
  progressive disclosure by default, avoid jargon in new copy.
- Detail panel, follow-up: a route's/an incoming source's destination now
  shows "{code} · {prompt, truncated}" instead of a bare code
  (`labels.ts`'s `targetLabel`/`sourceLabel`, sharing one
  `questionRefLabel` formatter). The requiredness chip flipped to show
  "Optional" only when a question isn't required, instead of "Required"
  on the (currently universal) common case. Dropped the "Walk it" /
  "Open the preview" shortcut and `onPreviewFrom` end to end -- the
  Preview tab itself is untouched, just this per-question shortcut into
  it.
- Canvas edge labels: truncated to 20 chars (`graphElements.ts`'s
  `guard` data field) -- the full text runs diagonally along the edge
  (`text-rotation: autorotate`), not wrapped in a node's box, so a long
  guard reads as tangled sideways text once more than one edge converges
  on a node. Full text is unaffected everywhere else (the panel's Options
  section). Background switched from cream-at-0.9-opacity to solid white
  - `roundrectangle`, for real contrast against the dotted canvas and
    crossing edges. "Any answer" renamed to "Anything else" throughout
    (dropdown, card heading, canvas label) -- reads as plain English
    instead of a routing term needing translation.
- Confirm dialogs de-nativized: the 4 `window.confirm` call sites
  (publish, discard draft, retire question, activate an old version) are
  now `ConfirmAction` -- an inline "are you sure?" popup, same
  `.editor-panel`/outside-click/Escape mechanics `EditorDropdown` already
  uses (shared via the new `useOutsideDismiss` hook), rather than the
  browser's own blocking dialog. Reverses the "legitimate simplification"
  call this file made earlier -- explicitly requested, not a re-discovered
  gap.
- **Canvas click-to-retarget**, replacing the target `<select>` outright
  (`Options.tsx`'s "Retarget" button, `MapView.tsx`/`Canvas.tsx`).
  Reverses the "Confirmed architectural — deliberately not portable" call
  this file made below -- explicitly requested after the accessibility
  trade-off was named and confirmed twice, not a re-discovered gap. Ending
  a flow got its own always-available "End the flow here" button rather
  than depending on the canvas's shared end-of-flow node (only drawn when
  some edge already ends the flow) -- this also closes the "Clear-jump
  button" item below.
- **Adding a route for a specific answer also moved off its dropdown**,
  onto the same canvas click-to-pick mechanism as Retarget (`OptionCard`'s
  "Add a route" button, `MapView.tsx`'s `CanvasPick` union covering both).
  Also moved the per-option guard picker out of the section-wide "+ Add a
  route" form entirely -- that form now only ever adds a fallback
  ("anything else") route, since a specific answer's route is added from
  that answer's own card. A newly added route has no "End the flow here"
  shortcut of its own (unlike retargeting an existing one) -- add it to
  any question first, then use that row's own button.

## P0 — declined

- Canvas's `fit: true` on initial layout shrinks nodes unreadably small
  at high question counts (break avoids this with a fixed post-layout
  zoom + entry-node center, `boot(cy)`). Explicitly not needed per
  instruction.

## P3 — not started

- **"Continues here automatically" wording.** `labels.ts`'s `optionLabel`
  renders a question-level fallthrough edge as "Any answer," the same
  text used for a genuine wildcard guard — conflating two different
  things break's own wording keeps separate.

## Confirmed fine as-is — not gaps

- **Blockers list** — already done via `BlockingList.tsx`, inline in the
  write-error banner rather than a separate modal; arguably better than
  break's approach.
- **Preview back/restart** — already present in `PreviewView.tsx`.
- **Not-authorized / login gates** — already covered by
  `VersionLayout.tsx` / `LoginPage.tsx`.
- **Add-question modal fields** — checked line by line against break's;
  matches, plus one field break's serializer doesn't have
  (`show_raw_answer_to_advisor`, offered only on create).

## Done (backend work, not a frontend port)

- **2 named reviewers, enforced.** No longer a gap: `ChangeRequest` gained
  `reviewer_1`/`reviewer_2` (`bvi-backend` migration
  `flow_tool/0002_...`), `submit/` now requires them (distinct, not the
  author, both holding `publish_flow_tool`), and `approve`/`reject` refuse
  anyone but those two named people — not just any `publish_flow_tool`
  holder, which is what the old behaviour actually was. New
  `GET reviewers/` endpoint lists who's eligible to be named. Frontend:
  `DraftBar.tsx`'s Submit-for-review is now a two-reviewer form, and
  `ReviewView.tsx` gates the approve/reject forms on the signed-in user
  being one of the two named (same client-side pattern as the
  Discard/Withdraw `isAuthor` gate, to avoid a non-named
  `publish_flow_tool` holder seeing a button that just 403s).

## Confirmed architectural — deliberately not portable

- **Snapshots.** Break's named, restorable checkpoints exist to
  work around having only one mutable live flow. This app's
  publish-creates-a-new-immutable-`Version` model already subsumes that:
  every past version is a permanent, always-restorable checkpoint via the
  version picker, automatically, not something someone has to remember to
  save.
- **"Continue automatically" as a retarget option.** This app has no
  positional fallthrough by design — every route is an explicit edge.
  Folded into the "continues here automatically" wording item above
  rather than a separate feature.
- **List/Graph view-mode switch.** Conflicts with this app's "three
  screens, three real URLs" routing design (Map/Review/Preview as
  routes, not client-side state).
- **Search box relocated to the topbar.** Low-value plumbing (would need
  lifting state out of `Sidebar` into shared context) for a purely
  cosmetic move; the sidebar's own search already surfaces a real
  focusable results list, which is the part that matters.
