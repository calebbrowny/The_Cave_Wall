// Edge function: jotform-sync
// READ-ONLY pull of new "Cancellation Form" submissions from Jotform into `cancellations`.
//  - GET only against Jotform (the API key is read-only); never writes/edits/deletes in Jotform.
//  - Idempotent: inserts NEW cases only (ON CONFLICT (jotform_id) DO NOTHING); never overwrites
//    a case staff have already started.
//  - Self-initialising: on the very first run (cursor null) it sets the high-water mark to the
//    latest existing submission and ingests nothing, so years of history are not dumped in.
//  - Auth (verify_jwt is false, custom auth here): a cron-secret header (scheduled) OR a
//    signed-in cancel-staff JWT (manual refresh from the hub). Secrets live in Supabase Vault.
//
// Optional body: { "since": "YYYY-MM-DD" } -> one-off backfill from that date (manual refresh only).
//
// Deploy:
//   supabase functions deploy jotform-sync --project-ref unfoqmfislfcnzxoivta --no-verify-jwt
//   (or via the Supabase MCP / dashboard). Slug = jotform-sync.
//
// Required Vault secrets (set once): jotform_api_key (read-only key), jotform_cron_secret.
// Config + cursor come from public.jotform_sync via the service-role-only RPC jotform_sync_config().

import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}

const JF_BASE = "https://api.jotform.com";

function strv(f: any): string {
  if (!f) return "";
  const v = f.answer;
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return v.filter(Boolean).join(", ").trim();
  if (typeof v === "object") {
    if (f.prettyFormat) return String(f.prettyFormat).trim();
    return Object.values(v).filter(Boolean).join(" ").trim();
  }
  return String(v).trim();
}
function pretty(f: any): string {
  return f && f.prettyFormat ? String(f.prettyFormat).trim() : strv(f);
}

// Map one Jotform submission of the Cancellation Form (form 210138830976055) to a cancellations row.
function mapSubmission(s: any) {
  const a = s.answers || {};
  const name = pretty(a["2"]) || strv(a["2"]);   // qid2  full name
  const email = strv(a["3"]);                      // qid3  email
  const phone = strv(a["10"]);                     // qid10 phone
  const memType = pretty(a["18"]) || pretty(a["22"]) || ""; // qid18 radio / qid22 checkbox
  const reason = strv(a["11"]);                    // qid11 reason
  const rating = strv(a["6"]);                     // qid6  experience rating
  const factors = strv(a["8"]);                    // qid8  factors behind the rating
  const gf = strv(a["14"]);                        // qid14 used group fitness/yoga
  const creche = strv(a["15"]);                    // qid15 used crèche
  const fb: string[] = [];
  if (rating) fb.push("Experience rating: " + rating + "/5");
  if (factors) fb.push(factors);
  const used: string[] = [];
  if (gf) used.push("Group fitness/Yoga: " + gf);
  if (creche) used.push("Crèche: " + creche);
  if (used.length) fb.push(used.join(" · "));
  const subDate = String(s.created_at || "").slice(0, 10) || null;
  return {
    jotform_id: String(s.id),
    member_name: name || null,
    member_email: email || null,
    member_phone: phone || null,
    membership_type: memType || null,
    cancellation_reason: reason || null,
    feedback: fb.join("\n") || null,
    submission_date: subDate,
    status: "new",
    match_status: "unmatched",
    jotform_raw: s,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

    // config: Vault secrets + cursor/form/enabled (service-role-only RPC)
    const { data: cfg, error: cfgErr } = await admin.rpc("jotform_sync_config");
    if (cfgErr || !cfg) return json({ error: "config unavailable" }, 500);
    const apiKey = (cfg as any).api_key as string;
    const cronSecret = (cfg as any).cron_secret as string;
    const formId = (cfg as any).form_id as string;
    const enabled = (cfg as any).enabled !== false;
    let cursor = (cfg as any).cursor as string | null;
    if (!apiKey || !formId) return json({ error: "Jotform not configured" }, 400);

    // ---- auth: cron secret OR cancel-staff JWT ----
    const hdrSecret = req.headers.get("x-cron-secret") || "";
    let mode = "";
    if (cronSecret && hdrSecret && hdrSecret === cronSecret) {
      mode = "cron";
    } else {
      const authHeader = req.headers.get("Authorization") || "";
      if (authHeader) {
        const caller = createClient(url, anon, {
          global: { headers: { Authorization: authHeader } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: who } = await caller.auth.getUser();
        if (who?.user) {
          const { data: ok } = await caller.rpc("is_cancel_staff");
          if (ok === true) mode = "manual";
        }
      }
    }
    if (!mode) return json({ error: "Not authorised" }, 403);

    // scheduled runs respect the enabled flag; a manual refresh always runs
    if (mode === "cron" && !enabled) return json({ ok: true, skipped: "disabled" });

    const body = await req.json().catch(() => ({} as any));
    const headers = { APIKEY: apiKey };

    // one-off backfill (manual only): { since: 'YYYY-MM-DD' }
    if (mode === "manual" && body && typeof body.since === "string" && /^\d{4}-\d{2}-\d{2}/.test(body.since)) {
      cursor = body.since.slice(0, 10) + " 00:00:00";
    }

    // first run with no cursor: set the high-water mark to the latest existing submission, ingest nothing
    if (!cursor) {
      const r = await fetch(`${JF_BASE}/form/${formId}/submissions?limit=1`, { headers });
      if (!r.ok) return json({ error: "jotform fetch " + r.status }, 502);
      const j = await r.json();
      const latest = j.content && j.content[0] ? j.content[0].created_at : null;
      const init = latest || new Date().toISOString().slice(0, 19).replace("T", " ");
      await admin.from("jotform_sync").update({ cursor_ts: init, last_run: new Date().toISOString(), last_count: 0, last_pulled: 0, last_error: null }).eq("form_id", formId);
      return json({ ok: true, initialized: true, cursor: init, pulled: 0, inserted: 0 });
    }

    // read-only paged pull of submissions newer than the cursor
    const limit = 100;
    let offset = 0, pulled = 0, maxCreated = cursor;
    const rows: any[] = [];
    const seen = new Set<string>();
    for (let page = 0; page < 20; page++) { // hard cap 2000/run
      const filter = "&filter=" + encodeURIComponent(JSON.stringify({ "created_at:gt": cursor }));
      const u = `${JF_BASE}/form/${formId}/submissions?limit=${limit}&offset=${offset}&orderby=created_at${filter}`;
      const r = await fetch(u, { headers });
      if (!r.ok) {
        await admin.from("jotform_sync").update({ last_run: new Date().toISOString(), last_error: `jotform ${r.status}` }).eq("form_id", formId);
        return json({ error: "jotform fetch " + r.status }, 502);
      }
      const j = await r.json();
      const list = Array.isArray(j.content) ? j.content : [];
      for (const s of list) {
        const id = String(s.id);
        if (seen.has(id)) continue;
        seen.add(id);
        rows.push(mapSubmission(s));
        const c = String(s.created_at || "");
        if (c > maxCreated) maxCreated = c;
      }
      pulled += list.length;
      if (list.length < limit) break;
      offset += limit;
    }

    let inserted = 0;
    if (rows.length) {
      const { data: ins, error: insErr } = await admin
        .from("cancellations")
        .upsert(rows, { onConflict: "jotform_id", ignoreDuplicates: true })
        .select("id");
      if (insErr) {
        await admin.from("jotform_sync").update({ last_run: new Date().toISOString(), last_error: insErr.message }).eq("form_id", formId);
        return json({ error: insErr.message }, 500);
      }
      inserted = (ins || []).length;
    }

    const newCursor = maxCreated || cursor;
    await admin.from("jotform_sync").update({ cursor_ts: newCursor, last_run: new Date().toISOString(), last_count: inserted, last_pulled: pulled, last_error: null }).eq("form_id", formId);
    return json({ ok: true, mode, pulled, inserted, cursor: newCursor });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
