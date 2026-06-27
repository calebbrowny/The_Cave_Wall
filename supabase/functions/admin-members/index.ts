// Edge function: admin-members
// Lets a signed-in Cave admin reset a member's password (their mobile number)
// or permanently delete a member account. Uses the service role, but ONLY after
// verifying the caller is an admin via the SECURITY DEFINER is_cave_admin() RPC.
//
// Deploy (one of):
//   supabase functions deploy admin-members --project-ref unfoqmfislfcnzxoivta
//   or paste this into Supabase Dashboard → Edge Functions → New function.
//
// No secrets live here — SUPABASE_SERVICE_ROLE_KEY is auto-injected by Supabase
// and never leaves the function. Deploy with verify_jwt = true.

import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";

    // 1) Verify the caller is a signed-in admin (their JWT + SECURITY DEFINER is_cave_admin()).
    const caller = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: who } = await caller.auth.getUser();
    if (!who?.user) return json({ error: "Not signed in" }, 401);
    const { data: isAdmin, error: rpcErr } = await caller.rpc("is_cave_admin");
    if (rpcErr) return json({ error: "Auth check failed" }, 403);
    if (isAdmin !== true) return json({ error: "Admin only" }, 403);

    // 2) Perform the privileged action with the service role.
    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const member_id = body?.member_id;
    const password = body?.password;
    if (!member_id) return json({ error: "Missing member_id" }, 400);

    const admin = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (action === "reset") {
      const pw = String(password || "").replace(/\D/g, "");
      if (!/^04\d{8}$/.test(pw)) return json({ error: "Invalid mobile number" }, 400);
      const { error } = await admin.auth.admin.updateUserById(member_id, { password: pw });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    if (action === "delete") {
      // member tables FK auth.users ON DELETE CASCADE → all member data is removed too.
      const { error } = await admin.auth.admin.deleteUser(member_id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
