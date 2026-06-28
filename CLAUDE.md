# The Cave Wall — working notes for Claude

A self-contained operations + member-engagement dashboard for **The Cave Gym, Toowoomba**
(Australia's first HYROX HTCx). One `index.html` file — all HTML, CSS and JS inline, no build
step — backed by Supabase and hosted on Netlify.

## Stack & deploy

- **Frontend:** vanilla HTML/CSS/JS in a single `index.html`. No framework, no bundler.
- **Backend:** Supabase (Postgres + Auth + Storage). Project **`unfoqmfislfcnzxoivta`** ("cave-ops").
  Tables: `leaderboard`, `achievements`, `events`, `todos`, `kpis`, `challenges`, `submissions`,
  `wods`, `ads`, `boards`, `app_state`, `activity_log`, `history`, `row500`, `benchmarks`,
  `benchmark_phones`, `member_profiles`, `workout_logs`, `body_metrics`, `daily_results`,
  `reset_requests`, `records`.
  - `records` = the **all-time records / leaderboard wall** (public read; admin-only insert/update/
    delete via `is_cave_admin()`, all perf-wrapped in `(select …)`; in the realtime publication). Holds
    **every approved entry** (NOT one row per feat — the `unique(rkey,sex)` constraint was dropped; the
    app computes the best per feat for the headline and the full ranked leaderboard for the drill-down).
    Cols: cat, rkey (feat key, e.g. `squat`), label, sex ('m'/'f' split, or 'x' for a single non-gendered
    feat), holder, display (formatted value, e.g. `200 kg` / `1:28`), value (numeric, for comparison),
    dir ('high'/'low'), date. **No `proof_url` is persisted** — proof is verified at approval then deleted
    (honours "stored for verification only"). Index on (rkey,sex). See the "All-time records" section below.
  - `benchmarks` = recurring benchmark test (public read+insert, admin edit/delete, realtime). Cols:
    name, sex ('m'/'f'), score (seconds for time / reps), cycle (the cycle-start date). **No phone
    column** — the public board is phone-free. Config in `settings.benchmark` {on,title,start,weeks,
    body,dir,unit}. Renders at the bottom of the WOD page (`#wod-benchmark` via `renderBenchmark()`);
    recurs every `weeks` (test active for the first 7 days of each cycle). Admin = WOD panel → 🏅
    Benchmark (`openModal('benchmark')`). Submit/leaderboard/improvement are member-facing on the WOD
    page; normal submissions still go through the Submit tab. Cross-cycle member matching is **name-
    based** (`bmKey()` = lowercased name); the leaderboard splits Men/Women (`bmBoardHTML`).
  - `benchmark_phones` = **private** phone numbers for benchmark entrants, kept out of the public
    board for member ID only. RLS: public INSERT, **admin-only SELECT + DELETE** (`is_cave_admin()`),
    so a phone is never readable client-side except by a signed-in admin. Cols: ref (the `benchmarks`
    row id it belongs to), name, phone (Aussie mobile, stored 4-3-3 `0412 345 678` via `bmFmtPhone`;
    `bmSubmit` validates `/^04\d{8}$/` or blank). Loaded into `cache.benchmark_phones` only when an
    admin is signed in (in `fetchAll`); shown in the admin entry list via `bmPhoneFor(id)`. Deleting a
    benchmark entry (`bmDelEntry`) also deletes its linked phone row. NOT in the realtime publication.
    (Phone privacy is a two-table split — never a security-definer view, which trips the advisor.)
  - `row500` = one-time 500m row challenge (public read + public insert; admin-only edit/delete; in the
    realtime publication for live updates). Cols: name, sex ('m'/'f'), seconds (int; entered as mm:ss).
    Gated by `settings.row500_on`; secret coach link uses `settings.row500_key`. Routes: `#row`
    (TV leaderboard), `#rowcoach/<key>` (coach entry). Admin manage = `openModal('row')` from Owner controls.
  - `history` = the undo / version-history log (admin-only RLS). Each row is a reversible change
    (`kind` ∈ delete/settingsKey/boardDelete/wodbatch + serializable `data`). `recordHistory()`
    writes one; `applyHistoryUndo()`/`doUndo()` reverse + delete it; `loadHistory()` prunes rows
    older than 14 days on each admin sign-in. Owner-only undo bar sits at the top of the planner,
    plus a 🕘 Version history modal. The mesocycle plan lives in `app_state.settings.mesocycle`.
- **Hosting:** Netlify project `the-cave-wall` → https://the-cave-wall.netlify.app (deploys from `main`).

### Deploy workflow (owner preference: autopublish)
- **Commit straight to `main`.** Netlify auto-deploys `main` to production. The owner does **not**
  want PRs / deploy previews for routine changes — just push and it goes live.
- **Author commits as `caleb@theproswitch.com`** (`git config user.email`). Netlify's dev plan blocks
  builds from unverified Git contributors ("Unrecognized Git contributor"), so commits authored by a
  bot email (e.g. `noreply@anthropic.com`) will **fail to deploy**. Caleb's email is a verified team
  member, so production builds.
- Data changes (anything in Supabase) are **live instantly** — they don't need a deploy.

## File structure (`index.html`)
- `<style>` … one big stylesheet. Responsive: base styles are TV/large-screen first; a
  `@media(max-width:760px)` block compacts the phone view; a landscape `min-width:1024px` block does
  the 3-column WOD layout.
- First `<script>` (small): theme cache + device zoom bootstrap.
- Body: nav + the mode "tabs" (`#wod`, `#challenge`, `#submit`, `#display`, `#eventpage`, `#planner`
  admin, timer) + modal + auth gate.
- Main `<script>`: config (Supabase keys), `cache`/`DEFAULT_SETTINGS`, data layer
  (`fetchAll`/`rowInsert`/`rowUpdate`/`stateUpdate`, localStorage fallback when not LIVE), demo data,
  renderers per section, the WOD generator, the timer, auth, boot.

## WOD data model (`wods` table)
Fields: `date` (YYYY-MM-DD), `slot` ('a'/'b' for dual-WOD), `title`, `focus`
(Strength/Engine/Endurance/Challenge/Partner/custom), `purpose`, `warmup`, `core`, `cool`, `bonus`,
`custom_label`, `custom_color`, `custom_body`.

### Section text conventions (the `wodBody` parser styles lines by prefix)
- **Bold "key" lines:** `Part A …`, `Finisher …`, rep-scheme lines (`4 rounds…`, `21-15-9…`, `AMRAP…`,
  `EMOM…`, `5 x 5`), and lines ending in `:`.
- **Muted/indented secondary lines:** anything starting `RX:`, `Scaled:`, `Scale:`, `Note:`, `BUILD:`,
  `PRO:`, `Coach cue:`, `Cue:`, `Tip:`, `Target:`, `Sub:`. Keep scaling/coaching notes on these
  prefixes so they recede visually and the movements stand out (esp. on mobile).
- Blank line = small gap.

### Style guide for workout content (learned from the owner)
- **Purpose:** one short, benefit-led line (~40–70 chars) — *why* you're doing it, not the structure.
- **Core:** lean. Fold cues into the prescription; merge scale-down/scale-up into one
  `Scale: … Pro: …` line; keep one `Coach cue:`. Never change the actual sets/reps/weights when
  "simplifying" — only tighten wording.
- **Cool-down:** every workout should have one. If `cool` is blank, the display now shows a
  focus-matched **auto-cooldown** (`defaultCool(w)`), so it's optional in the data.

## WOD generator (admin → WOD → "Generate workout 💫")
No-API, built from The Cave's HYROX logic. Key pieces:
- `DAYFOCUS` (by weekday) is the single source of truth for a day's focus; `buildWod`'s "Auto" derives
  from it so the generated focus never disagrees with the WOD page.
- `WG_LIFTS` — catalog of strength main lifts (name + rx + scaled + bodyweight variant + pattern).
- `HYROX` — the 8 race stations in order (ski, sledpush, sledpull, burpee, row, carry, lunge, wallball)
  with RX/scaled distances; `wgStationMove` renders one (equipment-aware), `wgStationKey` maps UI
  labels → keys.
- Builders: `wgStrength`, `wgEngine`, `wgComplete` (incl. full/half race sim), `wgAerobic`, `wgPartner`,
  `wgBodyweight`, `wgStationCircuit`.
- Panel controls (multi-select where noted): Focus, Length, **Strength movements** (multi),
  **HYROX movements** (multi, the 8 + Run/Any), Equipment (Full/No barbell/Bodyweight), Gym context
  (class size/kit), free-text notes. State vars: `wgFocus`, `wgLen`, `wgStrengths[]`, `wgStations[]`,
  `wgEquip`, `wgCtxOn`, `wgClassSize`. Flow: `wgPick`/`wgToggleStation`/`wgToggleStrength` →
  `genWod` (builds `ctx`) → `buildWod` → builders.

## Mesocycle planner & phase-matched batch generation (admin → WOD → "🗓️ Mesocycles")
- Visual periodization planner. Plan = `app_state.settings.mesocycle` =
  `{race, raceDate, start, notes, blocks:[{id,type,name,weeks,focus,vol,int,color}]}`. `MESO_PHASES`
  (base/build/specific/peak/taper/deload/custom) give each block its default colour + vol/int curve;
  `mesoSmartPlan(start,race)` auto-fits 4–8-week blocks to the runway. `mesoSvg()` draws the volume area +
  intensity line + phase bands + today/race markers (theme-aware via `cssVar`). Editor = wide modal
  (`openModal('meso')`); in-modal undo stack (`mesoPush`/`mesoUndoPop`). Visual only — does not change manual generation.
- **Generate WODs from the plan** (`openModal('mesogen')`): for each selected training day,
  `MESO_PROG[phaseType][weekday]` picks a focus → `buildWod` → preview. Fills **empty days only** unless the
  "Overwrite" toggle is on. Tap a preview row to reroll / change focus / hand-edit it. Publish inserts (or
  updates, if overwriting) `wods`; the whole batch is a single reversible `history` entry.

## Undo, version history, owner controls & tab names
- **Undo is durable, not session-only.** `rowDelete`, board/screen deletes, published WOD batches and WOD
  **edits** (`saveWOD`, only when content changed) call `recordHistory(kind,label,data)` → writes a reversible
  row to `history` + shows a "↩ Undo" toast (any admin). `applyHistoryUndo(id)`/`doUndo()` reverse + delete.
  `kind` ∈ delete / settingsKey / boardDelete / wodedit / wodbatch.
- **Owner-only UI** (gated by `isOwner()` = `calebbrowny@gmail.com`, the sole owner): an **undo bar** in the
  planner top row (next to ⚙️ settings) — `renderUndoBar()`, always shown for the owner, Undo greys out when
  empty; a **🕘 Version history** modal (`openModal('history')`) listing the last 14 days.
- **Owner controls** accordion (bottom of planner, `#owner-wrap`, owner-only): Demo data (device),
  Reduce motion (device → `body.reduce-motion`), Accept member submissions (`settings.submissions_open`,
  gates the public Submit page), Log page views (`settings.analytics_on`, gates `logView`),
  **Maintenance mode** (`settings.maintenance_on` → full-screen `#maint` overlay for non-admins;
  `applyMaintenance()`, admins bypass), and **🚣 500m Row Challenge** (opens `openModal('row')`).
- **Tab names** (Super Admin → 🏷️ Tab names, owner-only): rename nav tabs via `settings.tab_names` →
  `applyTabNames()` sets the `.tl` span inside each `#m-*` button (live preview on type, save on blur). Emoji-on-tabs
  toggle = `appearance.tab_emojis` → `body.no-tab-emoji`; nav labels live in `.tl`, emoji in `.te`. On phones the
  Cave logo + clock are hidden so tabs get the width.

## Home dashboard (built, currently DISABLED) + minimal header nav
- **Home dashboard is disabled for now** (owner: "doesn't look polished"). The code is intact but has **no entry
  point** — no Home tab, `boot` defaults to `'wod'`, and `#home` is not in the hash-route map, so `renderHome()`
  never runs and `#home` stays `display:none`. To re-enable: add the Home tab back to `.mode-toggle`, set the boot
  default to `'home'`, and add `home:'home'` to the `applyHashRoute` map. Mode `'home'` → `#home` section,
  `renderHome()` → 3-tile grid (`.ho-tile`): **Today's WOD**, **Your training** (streak or login CTA), **This month**.
- **Nav = top bar + bottom tab bar (app-style).** Top bar (`#nav`, `.nav-i`): logo + clock on the left,
  `.nav-top-acts` on the right (the `#member-chip` login/"Hey {name}" chip + the **⚙️ admin cog `#m-plan`** +
  hidden `#lock-btn`). **No hamburger.** Page navigation lives in a **fixed bottom tab bar** (`#tabbar`, `.tb`
  buttons with minimalist inline-SVG line icons + `.tl` labels): **WOD / Challenge / The Wall / Submit** (+
  Event/Row/Timer when enabled). The buttons keep their original `#m-*` ids so `_setMode` toggles `.on` (active =
  blue). `_setMode` hides the tab bar + drops `body.tabbar-on` padding **only when `activeScreenSlug`** is set (a
  dedicated TV-screen kiosk) so members never get trapped on The Wall. The **"Hey {name}" chip is the only entry
  to My Account** (`setMode('me')`); clock + logo jump to the WOD (`navLogoTap`, clock `onclick`).
  (Earlier nav iterations — peek/header/pinned modes, the `.mode-toggle`/`.nav-acts`/`.nav-ic` styles, `toggleNav`/
  `navBurger` — are now dormant but left in place.)

## Admin layout — collapsible categories (`buildAdminCategories`)
The planner's flat `.planner-sec` panels are grouped at runtime into collapsible top-level **categories**
(drag-to-reorder removed). `ADM_CATS` = Programming (`wod`) / Community (`leaderboards`, `customboards`,
`challenge`, `submissions`) / Events (`events`, `eventpage`) / Screens & display (`screens`, `ads`) / Members
(new). `buildAdminCategories()` (called from `renderAll`, once via `admCatBuilt`) re-parents each existing
panel into its category body **by `appendChild` so every panel ID + renderer is preserved**, and injects the
`#members-admin` panel into the Members category. Open/closed state per category persists in localStorage
(`cave_admcat_<key>`); `toggleAdmCat` flips it (and renders the members panel on open). The old `applyOrder`/
`initDrag` (free drag-reorder) are no longer called; drag handles are hidden (`.drag-handle{display:none}`).
Owner controls + Super Admin remain their own accordions below the categories. CSS: `.adm-cat/.adm-cat-head/
.adm-cat-body` + reused `.wod-chev`.

## Recipe: a new batch of uploaded workouts
The owner uploads via the WOD admin (rows land in `wods`). To give a batch the standard treatment:
1. **Back up first:** `create table if not exists wods_backup_<note> as select * from wods;`
2. Read the batch (`select … from wods where date between …`).
3. For each: simplify the `core` (see style guide), add/keep a tailored `cool`, tighten `purpose`.
   Update with dollar-quoted SQL (`update wods set core=$w$…$w$, cool=$w$…$w$ where id=…`) so quotes
   and em-dashes don't need escaping. Wrap in `begin; … commit;`.
4. Display formatting (muted notes, mobile compaction, bold headers, auto-cooldown) is automatic — no
   code change needed as long as the section conventions above are followed.

## Testing the generator without a browser
Slice the generator out of `index.html` and run it in `vm` (it has no DOM deps):
```js
const slice = html.slice(html.indexOf('const WG_NAMES='), html.indexOf('function genWod('));
const buildWod = vm.runInContext(slice + '\n;buildWod', {DAYFOCUS, console});
```
Sweep focus × day × length × stations × lifts × equipment and assert no `undefined`/`NaN`/`[object`
in the output. Also run a quick inline-`<script>` syntax check (`new vm.Script(scriptText)`).

## Member platform (member logins, workout/metrics tracking, accountability)
Members are a SECOND auth tier, distinct from admins. Anonymous public viewing is unchanged.
- **Auth = email + phone-as-password (owner's call), no codes.** Supabase **email+password** auth where the
  password value is the member's mobile digits (`memNorm`). Join = `sb.auth.signUp({email,password:phone})`;
  Login = `sb.auth.signInWithPassword`. **Requires Supabase Auth → Email → "Confirm email" OFF** (no signup
  email/code is sent; not settable via MCP — dashboard only). Low-entropy password is a documented tradeoff
  for low-stakes data; phone is the password only (never stored in a readable column). Reset (changed number)
  = the **Members admin** (edge function) or the Supabase dashboard.
- **Profile creation is tied to the session, not the signup call (login-bug fix).** The `member_profiles`
  upsert must NOT run right after `signUp` — the new JWT isn't attached yet, so RLS silently blocks the insert
  (symptom: auth users with 0 profiles). Instead `memberJoin` stashes `pendingProfile={name,sex,age}`, and
  `ensureMemberProfile()` (called from `handleSession`'s member branch, after the session is live) creates the
  profile then, reloads, clears the stash. `memberJoin`/`memberLogin` **block admin emails** (`emailAllowed()`
  → "use the gear to sign in as admin"; those OTP accounts have no password) and surface real errors
  ("already registered" → switch to Login; bad creds → "first time? Sign up"; "not confirmed" → clear note).
- **handleSession** branches: authed + `emailAllowed()` → admin (unchanged); authed + not admin → **member**
  (`currentMember`, `memberProfile` via `ensureMemberProfile`→`loadMemberProfile`), NOT signed out. `isMember()`;
  members are never admins (`is_cave_admin()` stays false). `boot`'s getSession restores either tier.
- **Logins on/off + feature toggles (owner control):** `settings.members_on` (default true) → `membersOn()`
  gates the chip + join/login; `settings.member_complete_on` / `settings.member_metrics_on` (default true) →
  `memCompleteOn()`/`memMetricsOn()` gate the WOD card's "mark complete" + metrics entry. All in `DEFAULT_SETTINGS`,
  toggled in the **Members** admin category.
- **Tables (per-member RLS, `auth.uid()`):** `member_profiles` (id=auth.uid; name/sex/age — no phone),
  `workout_logs` (member_id, date, wod_ref; unique(member_id,date) → idempotent one-tap-per-day),
  `body_metrics` (member_id, date, kind bodyweight/squat/bench/deadlift/note, value, unit). RLS: all
  CRUD `member_id=auth.uid()`; SELECT also `OR is_cave_admin()` (coach view). NOT in realtime publication
  (writes update `cache` directly via `refreshMemberData`). Fetched in `fetchAll` only when `currentMember`.
- **UI (clean, emoji-free):** nav greeting chip `#member-chip` sits **immediately left of the ☰ burger**
  (`renderMemberChip`: "Log in" → `openMemberAuth`, or "Hey {name}" → My Hub; empty innerHTML when hidden, kept
  in flow). Member auth modal `openModal('member')` (`memberAuthHTML`, login/join toggle) has a **"First time
  here? Sign up" / "Already have an account? Log in"** CTA (`.mauth-alt`/`.mauth-link` → `setMemberAuthTab`).
  WOD page shows `#wod-member` (`renderWodMember`, gated by `memCompleteOn()`/`memMetricsOn()`): Mark complete
  (`wmComplete` upsert) + optional metrics (`wmSaveMetrics`). **My Hub** dashboard = mode `'me'` (`#member`
  section, nav tab `#m-me`, hash `#me`/`#hub`): "Hey {name}", streak calendar (`memCalendarHTML`), stats
  (`memStat`, no icons), metric sparklines (`memSpark`), auto badges (`BADGES`/`memBadgesHTML` — monochrome
  `.md-badge-mark` ✓, derived, no table), the how-to (`settings.howto`). **No decorative emojis** on any
  member-facing surface (only the ✓ done-mark + ▾/▸ chevrons as UI glyphs).
- **Smart metrics + daily results (the intelligent system).** Profile tracking lives in `body_metrics`
  (kept private). Catalogs: `STR_LIFTS` (back/front squat, deadlift, bench, press, push press, clean
  variants, snatch — stored as **estimated 1RM** via Epley `est1RM(w,reps)`, raw set in `note`), `STR_REPS`
  (max pull-ups etc.), `ENG_TESTS` (run/row/ski times, stored as **seconds**, lower=better), `BODY_COMP`
  (bodyweight, bodyfat). My Account shows Strength/Engine/Body sections (`strSectionHTML`/`engSectionHTML`/
  `bodySectionHTML`, sparkline trend via `memSpark`; engine sparkline negates seconds so up=faster). Entry =
  one modal `openModal('metric')` (`metricModalHTML`, group tabs strength/engine/body → `metSaveClick`→`metSave`);
  PB on a lift → confirm → `sharePBNow` (submissions→achievements, moderated). **Retest nudges**: `memSuggest()`
  flags any tracked test untested ≥6 weeks (shown in My Account + as a one-line nudge on the WOD).
- **Daily result + leaderboard (`daily_results` table; logged-in members read all, name/sex denormalised so it
  never reads others' private profiles).** `wodResultSpec(wod)` parses the day's WOD (focus + core text) →
  `amrap` (rounds+reps) / `fortime` / `load` (+detected lift, shown vs the member's 1RM) / `time` (+detected
  engine test) / `done`; `detectLift` matches the **longest** keyword first (so "front squat"/"squat clean"/
  "push press" aren't swallowed by "squat"/"press"). On the WOD page `renderWodMember` shows mark-complete +
  "Log your result" (`drFormHTML`→`drSave` upserts `daily_results`, unique per member/day, counts as a
  completion) + the day's board (`drBoardHTML`, split M/F, RX flagged, sorted by `drLower(kind)`). Loaded per
  date via `loadDailyBoard(date)` (member's own in `cache.my_results`). Generic bodyweight/squat/bench entry
  was **removed from the WOD tab** — all metrics now live in My Account.
- **Edit account + locked-out reset.** My Account → "Edit account" (`openModal('memedit')`→`memSaveAccount`):
  updates name/sex/age (`member_profiles`) and, self-serve while logged in, the mobile/password via
  `sb.auth.updateUser({password})`. Locked-out members use "Trouble logging in?" on the login modal
  (`memResetRequest` → inserts `reset_requests`, public-insert / admin-read+delete RLS); requests show in the
  Members admin (`resetReqClear` to dismiss), and the admin resets via Manage → reset (edge function).
- **Profile metric UI (`metSectionHTML`/`metRowHTML`).** Each section lists **every** catalog metric as a row:
  name · PB (best, or latest for body) · **improvement arrow** (`metTrendArrow`: ▲ green if the latest attempt
  beat the prior best, ▼ red if down) · a **History** toggle (`metHistToggle`/`metHistoryHTML` — per-entry
  delete via `metDelete`) · an **✕** to hide it (`metHide`/`metUnhide`, stored in `member_profiles.prefs.hidden`
  jsonb; hidden ones reappear as "+ add" chips). **Tapping anywhere on a row** (incl. the "＋ log" hint) opens the
  log modal pre-set to that metric. Each section (Strength/Engine/Body/Benchmarks) is a **collapsible accordion**
  (`metSecHead`/`memSecOpen`/`toggleMemSec`, open-state in localStorage `cave_memsec_<group>`), and a one-time
  **intro card** (`metMetricsIntroHTML`) at the top explains "enter your current bests, we track improvement".
  `est1RM` caps reps at 12 (Epley only reliable that far). Names are **Title-Cased** everywhere (`titleCase`,
  applied on display + save; existing rows `initcap`-ed in the DB).
- **Benchmarks & tests section (`benchSectionHTML`).** In My Account, shows the member's recurring-benchmark
  results matched by name (`bmKey`) across cycles with improvement arrows + a PB line; prompts to log on the WOD
  page when a test week is active. Read-only view over the existing public `benchmarks` data.
- **Audit hardening (this pass).** Sign-out now also clears `cache.daily_results`/`my_results` + `drLoadedDate`/
  `drOpen`/`metHistOpen` (prevents a second member on a shared device briefly seeing the first's board);
  `renderWodMember` only shows **Mark complete** on live days with content (`liveDay`); the daily board reloads
  on each WOD entry (`drLoadedDate=null` in `_setMode('wod')`); `detectLift` uses word-boundary + optional-plural
  matching and `wodResultSpec` no longer guesses "load" without a strength signal; daily `load`/`time` results
  that beat a stored best offer to update it. **RLS perf:** all member-table policies wrap `auth.uid()`/
  `is_cave_admin()` in `(select …)` (one eval per query). Advisor notes left as-is by design: public-INSERT
  policies (submissions/benchmarks/row500/reset_requests/activity_log), `is_cave_admin()` anon-executable (only
  reveals the caller's own admin bool), leaked-password protection off (password is the member's phone by design).
- **PB → achievements board (opt-in, one system):** a new strength/engine best (detected in `metSaveClick`/
  `drSave` vs `metBest`) offers (confirm) to share. `sharePBNow` inserts a `submissions` row `{category:
  'achievement', detail:'Back Squat 1RM ≈ 140 kg', status:'pending'}` → **Pending Submissions** → owner
  approves → existing auto-promote posts it to the **achievements board**. Reuses the moderated pipeline; no new RLS.
- **Members admin** (admin → **Members** category → "Member hub", `renderMembersAdmin` into `#members-admin`):
  stats (members / active-7d / completions via admin SELECTs — RLS allows `is_cave_admin()` read), member list
  (name/sex/age/completions, **Manage** → `memberAdminAct` prompt: reset / remove), the three feature toggles
  (`swRow`/`toggleMembersOn`/`toggleMemberFeature`), and the how-to editor. Reset/remove call
  `memberEdgeCall` → edge function (deployed **slug `swift-responder`**, dashboard label "admin-members" — the
  slug is immutable from creation, so `memberEdgeCall` invokes `swift-responder`; source kept at
  `supabase/functions/admin-members/index.ts`): verifies
  the caller is an admin (their JWT + SECURITY DEFINER `is_cave_admin()` RPC), then service-role
  `updateUserById` (password = new mobile) / `deleteUser` (member tables FK `auth.users` ON DELETE CASCADE →
  data removed too). 403 for non-admins; service key never leaves the function. **If the function isn't
  deployed, reset/remove show a clear "not enabled yet" message** — list/stats/toggles/how-to all still work.
- **One-time setup before members can join:** (1) Supabase dashboard → Auth → Email → turn **"Confirm email"
  OFF** (otherwise `signUp` sends a confirmation email and the account can't log in until clicked — defeats
  "no codes"). (2) Deploy the `admin-members` edge function (Supabase CLI or dashboard) to enable member
  reset/remove.

## All-time records + leaderboards (The Wall — one connected system)
The single performance system: members submit a result (with proof) → admin approves → it lands in `records`
as an entry → the wall shows the best **Male + Female** (or one overall) per feat, and tapping a feat drills
into the **full ranked leaderboard**. There is **no separate "old leaderboard" + "records" split** — they were
unified (the standalone Strength/HYROX submit categories were folded into this). Mobile-first as the default
view of The Wall, with a per-TV rotator for gym screens. ClubFit auto-population is a future tie-in (not built).
- **Catalog = `REC_CATS`** (single source of truth): six categories — **powerlifting** (Squat/Bench/Deadlift/
  `pl_total` "Total", kg high), **strength** (Olympic & accessory 1RMs — front squat, OHS, presses, cleans,
  snatch; no overlap with PL's big-3), **fitness** (row/ski/run times = low + 60s bike cals = high), **hyrox**
  (Open/Pro/`hyrox_doubles` (single, non-gendered)/100 wall balls, time/low), **gymnastics** (max-rep feats,
  high), **community** (`single:true` — most classes / most WODs / longest streak). Each item `{k,l,dir,u,
  input}`, `input` ∈ kg/time/reps/cals. `REC_MAP` flattens to `rkey → {…,cat}`; `REC_CAT_LABEL` maps cat→label.
- **Entry model + helpers.** `records` holds every approved entry. `recEntries(rkey,sex)` = all rows for a
  feat+sex, **deduped to each person's best** (by lowercased holder), ranked dir-aware; `recBest` = the #1;
  `recFor` aliases `recBest`. `recItem`/`recCatOf`/`recCat`/`recSex` ('m'/'f' or 'x'), `recSecToClock`/
  `recClockToSec` (h:mm:ss ↔ secs), `recParseInput(it,raw)`→`{value,display}`, `recFmt`, `recBeats`,
  `recPL(detail)` (parses the Powerlifting payload `pl_total:sq/bn/dl`). `recRowHTML(it,tv)`/`recBoardHTML(catKey,tv)`
  render the per-feat card (M/F podium + count + chevron; `tv`=static for the rotator); `recToggle(k)` expands
  one feat (`recOpenKey`) into `recLeaderboardHTML` (two ranked columns, medals on top-3).
- **Mobile master page = the default Wall view.** `renderDisplay()` branches on `dispIsMaster()` (= no
  `activeScreenSlug`): master mode renders `#master` (`renderMaster`) — title + sticky **category tab strip**
  (`mw-tab` → `recTab(key)`: the 6 cats + **Achievements** (`masterAchHTML`) + **What's On** (`masterComingHTML`
  = active challenge + upcoming events, rich `.wo-card` date badges + countdown)), a coloured category header
  (`.mw-cat`, per-cat accent via `.cat-<key>` → `--cat`), the board, and a "Set a record" CTA → Submit. Hides
  the rotator. `startDisplay()` early-returns in master mode (no rotation, no wake-lock). Each card "pops":
  category-coloured left accent + gradient + the value in the cat colour; M/F sub-cells blue/pink.
- **Gym screen (kiosk) rotator.** When `activeScreenSlug` is set, `renderDisplay` keeps the dots rotator.
  Record slides (`s.recordsCat`, `.rec-disp` grid, `recBoardHTML(cat,true)`) are added in `buildSlides` (one per
  category with any entry) when `vis('records')` — gated globally by `settings.show_records` (default true; ⚙️
  Display settings) and per-screen by the `records` key in `SCREEN_KEYS`. The legacy built-in Strength/HYROX
  leaderboard slides only render if their `leaderboard` board actually has rows (otherwise skipped).
- **Submit = one unified flow.** Categories: **🏆 Record / PB** + Challenge (if active) + Achievement + custom
  leaderboards. Record: pick the feat from an `<optgroup>`-per-category dropdown → value input typed by
  `it.input` → **required** proof; for **Powerlifting → Total**, the 3-lift form (squat/bench/deadlift + 3
  videos, live total). `doSubmitRecord` stores `{category:'record', detail:rkey | 'pl_total:sq/bn/dl',
  score, unit, gender, proof_url(/2/3)}` into `submissions`. Members never write `records` directly. (The old
  `doSubmitStrength`/`doSubmitHyrox` and their submit categories were removed; `strengthProofField`/
  `onStrengthProofPick`/`subStrengthProofs` are reused by the Powerlifting form.)
- **Approve → entry (no "beats" gating).** `approveSubmission` `category:'record'`: a normal feat inserts one
  entry; a `pl_total:…` payload (`recPL`) inserts **four** entries — Total + Squat + Bench + Deadlift (the
  intelligent connection). The board recomputes the best automatically. Proof is **deleted** on approval.
  Readable pending text via `subDetailText` ("Powerlifting · Men · Total 605 kg (Sq…/Bn…/Dl…)", or
  "Strength · Snatch · Men · 95 kg · would be #1 / current best X").
- **Admin records panel** (Community category, `#records-admin`, `renderRecordsAdmin`, owner-gated): per feat,
  best M/W (or single) + entry count + **Add** (`openModal('record','rkey|sex')` → `saveRecord` inserts an
  entry) + **Manage** (`recAdminToggle` expands the full entry list; per-entry **✕** = `recDelEntry`). No
  upsert/clear-single — it's an entry store.
- **Demo data.** `demoRecordsData()` (built lazily so `REC_MAP`/`recParseInput` exist) seeds sample entries
  across all categories incl. multiple per feat so the drill-down looks alive; wired through `applyDemo`.
- **Dynamic bottom tabs.** `refreshNav` shows/hides the bottom-bar tabs by state: Challenge (`challengeOn()`),
  Event (`evp().enabled` — updates the `.tl` label, keeps its SVG icon), Timer (`show_timer`), Row
  (`row500_tab` && `row500On()`). WOD / The Wall / Submit are always present.

## Misc & security
- **Admin sign-in:** Supabase magic link + 6-digit OTP. Allowlist = hardcoded owners (`ALLOWED_EMAILS`,
  mirrored in the `is_cave_admin()` Postgres function) **plus** extra emails managed in the UI
  (Super Admin → Admin access → stored in `app_state.settings.admin_emails`). `is_cave_admin()` honours both.
- **Real security is server-side (Supabase RLS).** Every table's writes are gated by `is_cave_admin()`;
  `activity_log` reads are admin-only; public reads are open only where the public site needs them. Never
  put a real secret in client JS — it's all viewable in the console. There is no shared password (the old
  client-side activity-log password was removed); access = the OTP email login.
- **Super Admin** (bottom of the admin panel, owner-only via `isOwner()`): collapsible Stats / Activity
  tracker / Admin access / Tab names sections. Page views are logged per public load (`logView`), tagged by surface,
  and excluded from the activity feed (they power the Stats tab).
- Appearance/theme, per-device display scaling, demo data, ads rotator, display "screens" (per-TV
  links), monthly challenges, custom leaderboards and an event-page builder all live in the same file.
