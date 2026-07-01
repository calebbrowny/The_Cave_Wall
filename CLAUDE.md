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
  `reset_requests`, `records`, `cancellations`.
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

### Public WOD view — stunning-minimal redesign + McDonald toggle + export (this pass)
The public `#wod` page (`renderWOD`→`wodBlocksHTML`, blocks Purpose/Warm-up/**Main**/Cool-down/Bonus) was
restyled for a clean, premium look. **All new CSS is scoped to `#wod` (or `body.wod-min #wod`)** because the
**TV kiosk reuses `wodBlocksHTML` under `#slides`/`.slide`** — the global `.wod-block` card rules are kept as the
kiosk fallback and must never be removed. Verified: kiosk `.wod-block` computed styles are unchanged with the
toggle on/off. **Layer A (new default, everyone):** thinner 3px accent, rounded cards, muted section labels each
with a small **hue dot** (`::before`; the decorative WOD_BLOCKS emoji is wrapped in `.wb-ico` and hidden via
`#wod .wb-ico{display:none}`), movements loud/white, and the Main block's rep-scheme `.wb-key` lines get the one
**blue punch**. The **Main (core) block is non-collapsible** (`blk` force-expands it; `toggleWodBlock` early-returns for `core`;
its chevron is hidden on `#wod`; a stale `core` entry in `cave_wod_collapsed` is self-healed on render) so a member
can never hide the day's workout; other blocks keep persisted collapse.
- **McDonald's-clean toggle** = `appearance.wod_min` (boolean, default false, owner Settings → "WOD page style" →
  "Minimal (clean menu) mode" via `tog('wod_min',…)`) → `body.wod-min` (wired in `applyAppearance` next to `wod_fill`;
  reuses `toggleAppearance`, no new persistence). The variant is flat — **no cards, hairline `border-top` dividers,
  no dots/emoji, one blue accent, maximum air** — the same language the owner loved on The Wall. Kiosk-safe (no
  `#slides` rule), theme-safe (var() only), reversible; `wod-min` beats `wod-fill` when both on.
- **Export / share poster** (admin-gated via `isUnlocked()` — shows for owner + coaches, hidden for public/kiosk/
  coming-soon/empty via `isUnlocked()&&dispIsMaster()&&wodLive(d)&&wodHasContent(w)`): a share icon on the hero
  (`#wod-share-btn`) opens `openWodExport()` → a lazy fixed overlay `#wodx-export`. The poster is painted **purely on
  a `<canvas>`** (`paintWodCanvas`, `ctx.fillText`, no libs, offline) in **Story 1080×1920 / Square 1080×1080 (Main-
  only) / Print A4 1240×1754**, focus-coloured, with the logo drawn from the inline same-origin `data:` PNG (read off a
  `.logo-img` probe → `_wodLogoImg`, taint-free) and a text-wordmark fallback. `wodExpLineKind` mirrors `wodBody`'s
  key/scale regex; long workouts truncate with "…full workout in the app". Download = `toDataURL`+anchor; **Web Share**
  (`navigator.canShare({files})`) with download fallback. All `wodx*` code lives after `pickPublicSlot`.

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
  from it so the generated focus never disagrees with the WOD page. **Default week (HTCx):** Mon = Strength
  (`STR_PATTERN[1]` = heavy lower, squat/hinge → "Lower-body strength"), Tue = Engine, **Wed = Power**
  (`wgPower`: explosive main lift [push press/deadlift] contrasted with ballistics/plyos → SIT sprint intervals,
  low-volume CNS/speed day → "Cave Power"), Thu = Endurance, Fri = Strength (`STR_PATTERN[5]`='upper' + a
  midline/core block → "Upper-body & core strength"), Sat = Partner, Sun = Challenge. **Power** is a focus
  alongside Strength/Engine/Endurance/Challenge/Partner/Custom (`DEFAULT_FOCUS.Power` red; in the focus
  dropdown, appearance colours, `defaultCool`, `wgWarmup` primer).
- **Balanced strength days.** A heavy main lift is paired with *complementary* HYROX conditioning so every
  session works the whole body: lower main → upper-biased Part B (`upperBiasedStings`: ski/wall ball/sled
  pull/push-ups/ring rows/carry); upper main → lower-biased Part B (`lowerBiasedStings`: sled push/lunge/KB
  swing/box jump/run). Explicit station picks still override.
- **Optional running finisher** (`wgOptional(focus,pattern)`, set into `bonus` by `buildWod`): keyed to leg
  fatigue, framed as a race-building add-on (core class stays complete without it). Lower/hinge strength → easy
  Zone-2 run (don't run hard on loaded legs); upper strength (legs fresh) → quality run (4–6×400m / tempo);
  Power → no extra running (SIT covers it), just an easy flush / Roxzone + mobility. Other focuses keep the
  builder's own bonus.
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
- **Auto-login + remember-me (single source of truth = `handleSession`).** `signUp` returns a session
  (Confirm-email is OFF — verified), so `onAuthStateChange`→`handleSession` signs the new member straight in,
  creates the profile from `pendingProfile`, greets them and opens **My Hub** — no "now log in" step.
  `memberJoin`/`memberLogin` set a `memExplicitAuth` flag so `handleSession` knows an **explicit** login/signup
  (greet + `_setMode('me')`) from a **silent restore** (page reload / new browser session → just refreshes the
  chip, member stays put). `memberJoin` falls back to `signInWithPassword` if `signUp` ever returns no session.
  Persistence is the Supabase client default (`persistSession:true` + `autoRefreshToken:true`); on boot,
  `getSession` restores the member and loads their data (`loadMemberProfile`+`refreshMemberData`). Sessions
  persist across browser sessions until they sign out (the refresh token re-issues a session — verified live).
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
into the **full ranked leaderboard**. No separate "old leaderboard" + "records" split (the standalone
Strength/HYROX submit categories were folded in). Mobile-first default view of The Wall + a per-TV rotator.
**Design = clean divided LIST, brand-blue accents** (owner's call, "like the McDonald's app"): thin
divider lines (no cards/rounded rows/left-accents/grey cell bg), strong type hierarchy (big bold white feat
names, muted Men/Women labels, **bold blue values**); blue used only as a punch — **filled pill tabs +
filled blue group-pill accordion headers (dark text)** + values + buttons, never dull pastel body text. Tabs
centred; page title reads "Strength Leaderboard" / "Fitness Leaderboard" (`REC_TABS[].title`). M/F by label,
not colour. ClubFit auto-population is a future tie-in.
- **Catalog = `REC_GROUPS` → `REC_MAP`.** Feats live in **groups**, groups live in top-level **tabs**
  (`REC_TABS` = **All-Time / Strength / Fitness / Community**). Groups: Strength = Powerlifting (squat/bench/
  deadlift/`pl_total`), Olympic lifting (snatch/clean&jerk/power clean/front squat/OHS/push & strict press),
  Gymnastics & bodyweight (max pull-ups/strict/muscle-ups/T2B/HSPU/double-unders); Fitness = HYROX (open/pro/
  `hyrox_doubles` single/100 wall balls), Ergs & sprints (row 500/1k/2k, ski 500/1k, 1km run, 60s bike cals),
  Endurance (5/10/21.1/42.2 km run); Community = Personal achievements (`special:'ach'` → achievements board),
  Attendance & consistency (most classes/WODs/longest streak, `single`), Challenge champions (`special:'champions'`
  → past/current monthly-challenge winners). `REC_GROUPS.forEach` builds `g.feats` + `REC_MAP[k]={…,cat,group,gkey}`;
  `REC_CATS` = flat list; `REC_SUMMARY` = curated marquee feats for All-Time. `input` ∈ kg/time/reps/cals.
- **Entry model + helpers.** `records` holds every approved entry. `recEntries(rkey,sex)` = all rows for a
  feat+sex **deduped to each person's best** (normalised holder; empty→id), ranked dir-aware; `recBest`=#1;
  `recFor` aliases it. `recItem`/`recGroupsForCat`/`recGroupByKey`/`recFeatGroups`/`recSex` ('m'/'f' or 'x'),
  `recSecToClock`/`recClockToSec`, `recParseInput(it,raw)`→`{value,display}`, `recFmt`, `recBeats`,
  `recPL(detail)` (parses `pl_total:sq/bn/dl`), `recCount`.
- **Master page render.** `renderMaster` (in master mode, `dispIsMaster()` = no `activeScreenSlug`) → `#master`:
  title + sticky `mw-tab` strip (`recTab`). **All-Time** = `recSummaryHTML` (REC_SUMMARY marquee feats, glanceable).
  **Strength/Fitness/Community** = `recCatHTML` → one collapsible **accordion per group** (`rec-grp`,
  `recGrpToggle`/`recGroupClosed`, open by default); special groups render `masterAchHTML` / `recChampionsHTML`.
  Each feat = `recRowHTML(it,tv)` **compact row** (`rr-*`: feat + Men/Women best, blue value); tapping it →
  `recToggle`→`recLeaderboardHTML` (`reclb`, ranked top-10 per sex). Contextual CTA via `recCTA('rec'|'ach')`
  ("Set a record" / community → "Share an achievement"). `startDisplay()` early-returns in master mode.
- **What's On = a top-nav calendar icon** (`#cal-btn` in `.nav-top-acts`) → `openModal('whatson')` → `whatsonHTML`
  (upcoming events + active challenge + next benchmark window + `settings.whatson_note`). The admin edits the note
  in the Events panel (`#whatson-note-wrap` populated by `renderEvents`, `setWhatsonNote`). No "What's On" tab on
  the Wall any more.
- **Gym screen (kiosk) rotator.** When `activeScreenSlug` is set, `renderDisplay` keeps the dots rotator. Record
  slides (`s.recordsGroup`, `.rec-disp` grid, `recGroupBoardHTML(recGroupByKey(g),true)`) are added in
  `buildSlides` **per feat-group with any entry** when `vis('records')` — gated globally by `settings.show_records`
  (default true) and per-screen by the `records` key in `SCREEN_KEYS`. Legacy Strength/HYROX leaderboard slides
  only render if their `leaderboard` board actually has rows.
- **Submit = one unified flow.** Categories: **🏆 Record / PB** + Challenge (if active) + Achievement + custom
  leaderboards. Record: pick the feat from an `<optgroup>`-per-group dropdown → value input typed + labelled by
  `it.input` (kg/time/reps/cals, with a one-line help, e.g. 60s Bike → "Calories") → **required** proof; for
  **Powerlifting → Total**, the 3-lift form (squat/bench/deadlift + 3 videos, live total). The
  **Attendance & consistency** group is `adminOnly:true` — **excluded from the member submit dropdown** (owner
  sets those via the records admin panel), but still shown on the Community board + admin panel. `doSubmitRecord`
  stores `{category:'record', detail:rkey | 'pl_total:sq/bn/dl', score, unit, gender, proof_url(/2/3)}` into
  `submissions`. Members never write `records` directly. (`pl_total` is intentionally **left out of `REC_SUMMARY`**
  so the All-Time tab doesn't show it; old `doSubmitStrength`/`doSubmitHyrox` removed; `strengthProofField`/
  `onStrengthProofPick`/`subStrengthProofs` reused by the Powerlifting form. Gender select is labelled "Gender".)
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

## Cancellation hub (membership cancellation workflow — Caleb + Charley only)
A hidden, **desktop-optimised** admin section at the very bottom of the planner (`#cancel-wrap` accordion, after
Owner controls) that turns a membership cancellation into a worked, tracked **case** with all the payment maths,
the member email + ClubFit note, and a processing checklist. Built to layer ClubFit + Jotform **auto-fill** on
later (Caleb has API access requested) — for now it's **manual entry** and is fully useful that way.
- **Access = two emails only.** `CANCEL_STAFF = ['calebbrowny@gmail.com','charley@thecavegym.com.au']`;
  `isCancelStaff()` gates the UI and `emailAllowed()` includes them so Charley can OTP-sign-in as admin **without**
  being added to `admin_emails` (so Postgres `is_cave_admin()` stays false for her → she canNOT write WODs/records).
  For a non-owner cancel-staffer (Charley), `cxChrome()` adds `body.cancel-only` which hides every planner panel
  except the hub (`#planner>div:not(#cancel-wrap){display:none}`) and auto-opens it — she sees only this tool.
  Caleb (owner) sees the hub plus everything else.
- **Table `cancellations`** (RLS: SELECT/INSERT/UPDATE/DELETE all gated by `is_cancel_staff()` SECURITY DEFINER fn
  = the two emails, perf-wrapped in `(select …)`; **NOT** in the realtime publication; loaded in `fetchAll` only when
  `isCancelStaff()`). Cols: member_name/email/phone, membership_type, submission_date, contract_start, min_term_end,
  no_lock_in, payment_amount, payment_frequency ('weekly'|'fortnightly'), next_payment_date, fee_pref ('next'|
  'counter'), cancellation_reason, feedback, status ('new'|'in_progress'|'processed'|'reversed'), archive_reason,
  archive_comments, notes, task_done (jsonb {key:bool}), processed_by/at, and **future-integration** cols
  jotform_id/jotform_raw/clubfit_number/clubfit_snapshot/match_status (unused for now). Deletes pass `noUndo` so
  sensitive data never lands in the `history` undo log.
- **The engine (`cxCalc`, pure + unit-matched to the owner's worked example).** Constants `CX_TXN_FEE=0.77`,
  `CX_NOTICE_DAYS=30`, `CX_CANCEL_FEE=200`. final access = submission + 30 days. In-min-term = `!no_lock_in &&
  submission_date <= min_term_end` → $200 fee. The fee rides the FIRST scheduled payment when `fee_pref==='next'`
  AND a payment falls in the window (`calc.feeOnLine`); otherwise it's **over the counter** (`calc.feeCounter`,
  incl. the edge case where the notice window is so short there are **no** remaining payments — the fee is never
  silently dropped). Schedule: step from `next_payment_date` by 7/14 days while `<= finalAccess`; each payment with
  `remainingDays (inclusive) >= period` is a full payment, else a **pro-rata** final payment computed the owner's way
  — `daily = round2((amount − 0.77)/period)`, `prorata = round2(daily × days) + 0.77`. **Google-review discount**
  (`CX_REVIEW_DAYS=12`): `cxNoticeDays(c)=30 − (review_applied?12:0)` → an 18-day notice; everything (final access,
  schedule, pro-rata, fee placement, tasks, emails) recomputes off it. Verified: 08/06/2026 weekly $24.14 in-term →
  224.14 / 24.14 / 24.14 / 4.11, total 276.53, access 08/07/2026; with review → 224.14 / 10.79, total 234.93, access 26/06/2026.
- **Outputs (all auto, copy-to-clipboard with rich HTML + plain-text fallback via `cxCopyRich`).** Member email
  (`cxMemberEmail` — Template 1 in-term / Template 2 out-of-term, Australian English, DD/MM/YYYY, "Hi {first},",
  key parts bold, all review-aware), plus "if the member asks" replies (`cxEmailNoticeQ` / `cxEmailFeeQ`) and a
  **Google-review offer email** (`cxEmailReviewOffer`, "leave a review → 12 days off"; link from `settings.cx_review_url`
  set by the owner in the review card, `cxReviewUrl()`; `cxCopyReview` refuses to copy a blank-link placeholder).
  A `review_applied` checkbox (+ optional `review_note`) on the case applies the −12 days. Internal ClubFit note
  (`cxInternalNote` = Archive Reason / Archive Date / Comments). Archive reason auto-suggested from the reason +
  feedback text (`cxSuggestReason` over `CX_REASON_KW`, `CX_ARCHIVE_REASONS` dropdown overrides). Comments
  auto-drafted (`cxDraftComment`, editable). **Tasks checklist** (`cxTasks`) = the manual ClubFit steps: add the
  $200 fee to the right payment, set the pro-rata final payment, send the email, archive on the final-access date,
  confirm in ClubFit — each a persisted checkbox (`task_done`).
- **UI = a full-screen page** (`#cancel-page`, fixed overlay z-index 200, deep-link `#cancel`), opened by
  `openCancelPage()` from the bottom-of-planner "Cancellations" button (Caleb) or auto-opened for Charley via
  `cxChrome()`; closed by `cxClose()` (owner → back to admin; Charley → confirm + sign out). `renderCancelHub` builds
  a header with **Cases / To-do** tabs into the page. **Cases** (`cxListHTML`/`cxDetailHTML`, returns HTML strings):
  list (New, filter pills To action/Processed/Stayed/All, ★ marks a review case) ↔ detail (status pills, two-column
  `cx-cols` = editable form left, computed `#cx-out` right). **To-do** (`cxAllTodos`/`cxTodoHTML`): every outstanding
  task across **open** cases (reversed + processed excluded), soonest-first, overdue in red, tick syncs with the
  per-case checklist (`cxToggleTaskTodo`). Fields persist on change via `cxSet` (`''`→null); `cxRefreshOut` rebuilds
  only `#cx-out` and is **focus-guarded** (skips while a text input/textarea in it is focused, re-runs on blur) so
  edits/focus are never clobbered. On sign-out, `cache.cancellations` + the overlay DOM + `cancel-only`/`cx-open`
  classes are cleared (no PII residue). All emoji-free, dark theme + blue accents, desktop-optimised.
- **Cases list = leaderboard-style + tap-to-expand person dropdown (this pass).** The Cases list now mirrors The Wall's
  clean divided-row look (`cxListHTML`→`cxRowHTML`, `.cxr-*`): big bold name + inline meta (submitted / ends / term /
  tasks) + status pill. **Tapping a name** expands an inline dropdown (`cxRowDetailHTML`, accordion via
  `cxState.openRow`/`cxRowToggle`, one open at a time, reset on filter/sign-out): a **visual summary** (`cxCaseSummaryHTML`
  — a "what's happening" line (term + $fee / notice / final access / total) plus a **tickable "what needs doing" checklist**
  of the outstanding tasks, synced via `cxToggleTaskTodo`), contact links (email + `tel:`), a reason snippet, and smart
  actions — **Email ▾** (a menu via `cxState.emailMenu`: Confirmation / Google review offer / Copy — `cxEmailMenu`/
  `cxSendFromMenu`), **Call**, **ClubFit**, **View all details** (→ `cxOpen`). The Email button only shows when there's a
  sendable email.
- **Send email** (`cxSendEmail`) copies the rich+plain email to the clipboard (`cxCopyRich`) then opens the composer
  pre-filled To+Subject — the **default mail app (Outlook classic on Windows)** by default, or **Gmail web compose**
  (`settings.cx_email_client`, default `mailto`; `cxComposeUrl`); the body rides the clipboard (paste) to keep bold and
  dodge URL length limits. `cxTelHref` normalises AU mobiles to `+61`; **ClubFit** (`cxProfile`) opens
  `settings.cx_clubfit_url` (optional `{n}` = member number, toasts when absent). New tabs use `window.open` WITHOUT
  `noopener` (so a blocked pop-up is actually detectable) + `w.opener=null`.
- **Calendar tab + Clear-all (this pass).** A **Calendar** tab (`cxCalendarHTML`/`cxCalEvents`/`cxCalMove`, all cancel-staff)
  plots every outstanding task across open cases on its due date (fee changes, pro-rata final payments, emails, archive days);
  tap an item → `cxOpen`. Month nav via `cxState.calOffset`. The owner Settings tab has a **Clear ALL cases** button
  (`cxClearAll`→`cxClearAllDo`, double-confirm, deletes every `cancellations` row — Jotform untouched, re-importable via Backfill).
  `cxClearAllDo` uses `.delete().select('id')` and toasts the **real** deleted count (or "Nothing was cleared" + reload if RLS returns 0).
- **Priority, colour-coding, sort + pro-rata lead-time reminder (this pass).** One urgency function `cxPriority(c)` →
  `{tier:'urgent'|'soon'|'ontrack'|'done',color,score,dot,reason}` is the single source of truth for the row dot, the whole-row
  tint, AND the priority sort (lower `score` = more urgent). It reads the **undone dated** tasks via `cxTaskDue(t)` (=`t.remind||t.due`),
  so priority, calendar, to-do and the reminder stay in lockstep. Order: overdue (score −1000−daysLate) → all-steps-done "ready to
  process" (800) → un-costed `new` aged by submission date → days-to-next-action (in-term shifts one band via `eff=days−1`) →
  ontrack backstops → done (1e9). **Colour = red urgent / amber soon / blue ontrack** (`CX_TIER_VAR`→CSS vars); `cxPriChip` adds a
  colourblind-safe word ("2 days overdue"/"next action in 3d") so tier is never colour-only. **Sort control** = a segmented pill row
  (Priority/Oldest first/Access ends/Name, `CX_SORTS`/`cxSetSort`/`cxCmp`); choice persists per-device in `localStorage.cx_sort`
  (priority tie-breaks by oldest submission). **Lead-time reminder:** `cxTasks` gives the money-changing tasks (feepro/fee/prorata) a
  `remind` date = payment date − `cxLeadDays()` (`cx_policy.adjust_lead_days`, default 3) and appends "— set it in ClubFit by <date>";
  `cxTaskDue` prefers it, so a pro-rata a few days out automatically glows amber/red, lands on the calendar's lead-in day and rises in
  the To-do list — **no scheduler, no new table**. Settings (owner, under `cx_policy`): `pri_paint` (`dot`|`row`|`off`, `cxSetPolicyStr`),
  `pri_urgent` (default 2), `pri_soon` (default 7), `adjust_lead_days` (default 3). **Automations:** the To-do tab groups tasks into
  Overdue/Today/This week/Later/Anytime (`cxTodoHTML`) with a red overdue tab badge + an overdue banner on the Cases list; sending the
  **confirmation** email auto-nudges `new`→Contacted (`cxSendEmail`, `kind==='member'` only); a "Mark processed" button appears once every
  task is ticked (`cxCaseSummaryHTML`). Toowoomba is UTC+10 no-DST so all `YYYY-MM-DD` calendar-string compares stay calendar-correct.
- **Glance-first detail, per-case notes + attachments, refresh-first list (this pass).** Cases are **only ever ingested from Jotform** —
  the "+ New cancellation" button + the verbose intro paragraph were removed; the list top bar is **refresh-first** (`cxJotformStatusHTML`:
  a primary **↻ Refresh list** [`cxJotformRefresh`] + a small **Backfill…** [`cxJotformBackfill`] + the auto-sync status line). **Detail view
  is restructured for a glance** (`cxDetailHTML`, single-column top-down): `#cx-out` leads with a **glance card** (`cxOutHTML` → status badges +
  the payment breakdown via extracted `cxScheduleHTML(calc)` + read-only **Reason for leaving** + **Google review** status), then the actionable
  cards (email / review offer / internal note / tasks / processing notes), then **Notes & activity**, then the editable form tucked in a collapsed
  `<details>` "Edit case & billing details" (`cxFormHTML`) — so Charley gets everything key at a glance and scrolls/expands for the rest. `cxNowLine(c,calc)`
  extracted + shared with `cxCaseSummaryHTML`. **Per-case notes** = a timestamped activity log in `cancellations.notes_log` (jsonb array
  `{id,at,by,text,files:[{path,name,type,size}]}`, loaded via `select('*')`): `cxNotesHTML`/`cxAddNote`/`cxDelNote`/`cxRefreshNotes`, author via
  `cxNoteWho`, time via `cxNoteWhen`. **Attachments** live in a **private** Supabase Storage bucket **`cancellation-files`** (RLS: SELECT/INSERT/
  UPDATE/DELETE all gated by `is_cancel_staff()`, perf-wrapped; never public) — uploaded on add (`sb.storage…upload`, path `<caseId>/<noteId>_<i>_<name>`),
  opened via a short-lived **signed URL on click** (`cxOpenAttachment` → `createSignedUrl(path,300)`), and removed with the note (`cxDelNote` →
  `storage…remove`). Deleting a case doesn't purge its files (low volume; bucket is staff-only). `cxNew` is retained but unwired.
- **Fully editable email templates + Settings tab (owner-only, `cxSettingsHTML`).** All four emails are a token engine
  (`cxRender`/`cxTokens`/`cxTpl`/`cxTplDefaults`): `{token}` substitution, `**bold**`→`<b>`, XSS-safe (`\u0000` sentinels,
  escape-once). VALUE tokens (`{first_name}`…`{signature}`) + **smart clause tokens** (`{fee_clause}`/`{notice_clause}`/
  `{schedule_clause}`/`{notice_q_clause}`/`{schedule_q_clause}`/`{fee_detail_clause}`/`{notice_q_line}`) carry the
  conditional maths so the numbers/legals stay correct no matter how staff reword the prose. Owner edits subject+body per
  template with a **live preview** (`cxTplLive` renders via `cxRenderWith(key,c,{subject,body})` from the live textareas — no cache
  mutation; `cxRender(k,c)`=`cxRenderWith(k,c,cxTpl(k))`), per-template **Reset to default**, and
  a missing-token warning; only deviations are stored in `settings.cx_templates`. **Defaults reproduce the prior emails
  byte-for-byte** (regression-tested). The tab also holds the **email signature** (`cx_email_sig`), the Google-review +
  ClubFit links, the composer choice, and **editable policy values** (`settings.cx_policy`: cancellation fee / notice days /
  review-reduction days / txn fee) that back the `CX_*` constants via `cxCancelFee()/cxNoticeBase()/cxReviewDays()/cxTxnFee()`
  (blank→default, `0` honoured for fee+review, notice `0` rejected) and flow through every calc, email and task. All setters
  gated `isOwner()`; policy/signature changes refresh previews in place (`cxRefreshPreviews`) without a full re-render.
- **Jotform ingest (LIVE — read-only).** New "Cancellation Form" submissions (Jotform form `210138830976055`) flow
  into `cancellations` automatically. **Read-only by design:** the Jotform key is a **Read Access** key (GET only —
  cannot edit/delete in Jotform), held in **Supabase Vault** (`jotform_api_key`), never in client JS or git. Edge
  function **`jotform-sync`** (slug = name; `verify_jwt=false` + custom auth: a Vault `jotform_cron_secret` header for
  the scheduled run, OR a signed-in cancel-staff JWT for manual refresh) calls `GET /form/{id}/submissions?filter=
  {"created_at:gt":cursor}` (paged, `limit=100`), maps fields → a case (qid2 name, qid3 email, qid10 phone, qid18/22
  membership_type, qid11 reason, qid6 rating + qid8 factors → `feedback`; full payload → `jotform_raw`; status `new`),
  and **upserts ON CONFLICT (jotform_id) DO NOTHING** (idempotent; never overwrites a case staff have started). It
  **self-initialises** (first run, cursor null → sets the high-water mark to the latest existing submission and ingests
  nothing, so the ~3,900 historical rows are NOT dumped in). State + high-water mark live in `public.jotform_sync`
  (one row/form: `cursor_ts` raw Jotform `created_at` text [tz-agnostic], `enabled`, `last_run/last_count/last_pulled/
  last_error`; RLS select+update = cancel-staff; service role writes the cursor). Config (Vault secrets + cursor/form/
  enabled) is read by the function via the **service-role-only** SECURITY DEFINER RPC `jotform_sync_config()` (revoked
  from anon/authenticated). **Scheduled** every 3 h via `pg_cron` → `pg_net` (`net.http_post` with the cron secret read
  from Vault at run time — never stored in the job). Hub UI: a status line + **"↻ Refresh from Jotform"** + **Backfill…**
  (`cxJotformRefresh`/`cxJotformBackfill`/`cxJotformStatusHTML`/`cxReloadCancellations`, `sb.functions.invoke('jotform-sync')`);
  `cache.jotform_sync` loaded in `fetchAll` when `isCancelStaff()`, cleared on sign-out. Jotform cost is a non-issue
  (Starter = 1,000 calls/day; a poll is 1–2 requests). Source kept at `supabase/functions/jotform-sync/index.ts`.
- **Next layer (ClubFit, when API access is live):** a Supabase edge function proxies ClubFit (creds as secrets,
  admin-verified) to auto-fill membership/contract/billing fields onto a case and match a Jotform case to a member by
  member-number / email+mobile.
- **ClubFit cost discipline (owner requirement — do NOT burn API credits):** NEVER call the ClubFit API live per
  page-load / per-case. Mirror it. A scheduled edge function (`pg_cron` → `pg_net`) runs the sync **once or twice a
  day** (default daily ~3am; a second midday run is the max) into local `cf_*` mirror tables, using `fromdate`/
  `updatedate` deltas + `limit=500` paging so a ~1000-member club is only a handful of requests per run (low
  hundreds/month vs the 1M/mo Basic plan — credits are a non-issue at this cadence). The hub + cases read ONLY the
  mirror. The single allowed on-demand call is a manual **"Refresh from ClubFit"** button (admin-only, rate-limited/
  debounced) for when an operator needs a case's data refreshed immediately. Cache the OAuth token (1h) and reuse it;
  one re-token-and-retry on 401. Stay on the Basic plan.

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
