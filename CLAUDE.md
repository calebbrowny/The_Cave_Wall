# The Cave Wall — working notes for Claude

A self-contained operations + member-engagement dashboard for **The Cave Gym, Toowoomba**
(Australia's first HYROX HTCx). One `index.html` file — all HTML, CSS and JS inline, no build
step — backed by Supabase and hosted on Netlify.

## Stack & deploy

- **Frontend:** vanilla HTML/CSS/JS in a single `index.html`. No framework, no bundler.
- **Backend:** Supabase (Postgres + Auth + Storage). Project **`unfoqmfislfcnzxoivta`** ("cave-ops").
  Tables: `leaderboard`, `achievements`, `events`, `todos`, `kpis`, `challenges`, `submissions`,
  `wods`, `ads`, `boards`, `app_state`, `activity_log`, `history`, `row500`, `benchmarks`,
  `benchmark_phones`, `member_profiles`, `workout_logs`, `body_metrics`.
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
  Cave logo is hidden (`@media(max-width:760px) .nav .logo{display:none}`) so tabs get full width.

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
  password value is the member's mobile digits (`memNorm`). Join = `sb.auth.signUp({email,password:phone})` +
  upsert `member_profiles`; Login = `sb.auth.signInWithPassword`. **Requires Supabase Auth → Email →
  "Confirm email" OFF** (no signup email/code is sent; not settable via MCP — dashboard only). Low-entropy
  password is a documented tradeoff for low-stakes data; phone is the password only (never stored in a
  readable column). Reset (changed number) = owner resets in the Supabase dashboard.
- **handleSession** branches: authed + `emailAllowed()` → admin (unchanged); authed + not admin → **member**
  (`currentMember`, `memberProfile` via `loadMemberProfile`), NOT signed out. `isMember()`; members are never
  admins (`is_cave_admin()` stays false). `boot`'s getSession restores either tier.
- **Tables (per-member RLS, `auth.uid()`):** `member_profiles` (id=auth.uid; name/sex/age — no phone),
  `workout_logs` (member_id, date, wod_ref; unique(member_id,date) → idempotent one-tap-per-day),
  `body_metrics` (member_id, date, kind bodyweight/squat/bench/deadlift/note, value, unit). RLS: all
  CRUD `member_id=auth.uid()`; SELECT also `OR is_cave_admin()` (coach view). NOT in realtime publication
  (writes update `cache` directly via `refreshMemberData`). Fetched in `fetchAll` only when `currentMember`.
- **UI:** nav greeting chip `#member-chip` (`renderMemberChip`: "Log in" → `openMemberAuth`, or "Hey {name}"
  → My Hub); member auth modal `openModal('member')` (`memberAuthHTML`, login/join toggle). WOD page shows
  `#wod-member` (`renderWodMember`): ✓ Mark complete (`wmComplete` upsert) + optional metrics (`wmSaveMetrics`).
  **My Hub** dashboard = mode `'me'` (`#member` section, nav tab `#m-me`, hash `#me`/`#hub`): streak calendar
  (`memCalendarHTML`), stats (`streakInfo`/`thisWeekCount`), metric sparklines (`memSpark`), auto badges
  (`BADGES`/`memBadgesHTML` — derived, no table), and the how-to (`settings.howto`, editable in Owner controls).

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
