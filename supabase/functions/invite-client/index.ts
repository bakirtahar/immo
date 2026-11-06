// immo – CTB – fonction « invite-client »
// Envoie (ou renvoie) l'invitation e-mail d'un client et rattache son compte
// à sa société ; envoie un lien de réinitialisation du mot de passe ;
// retire l'accès d'une société supprimée.
// Seul l'administrateur connecté (mot de passe + code e-mail) peut l'appeler.
//
// Réglages (Edge Functions > invite-client > Secrets) :
//   SITE_URL         adresse publique du site : https://immo.cabinet-tb.tn/
//   ALLOWED_ORIGINS  origine autorisée       : https://immo.cabinet-tb.tn
// SUPABASE_URL, SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY sont fournis
// automatiquement par Supabase.
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SITE_URL = Deno.env.get("SITE_URL") ?? "";
const ALLOWED = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);

const EMAIL_RE = /^[^\s@<>()"',;:]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
const TENANT_RE = /^[A-Za-z0-9_-]{1,40}$/;

function cors(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}
function reply(status: number, body: unknown, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  const origin = (req.headers.get("Origin") ?? "").replace(/\/+$/, "");
  const okOrigin = ALLOWED.includes(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: okOrigin ? 204 : 403, headers: okOrigin ? cors(origin) : {} });
  if (!okOrigin) return new Response(JSON.stringify({ error: "Origine non autorisée." }), { status: 403, headers: { "Content-Type": "application/json" } });
  if (req.method !== "POST") return reply(405, { error: "Méthode non autorisée." }, origin);
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY || !SITE_URL) return reply(500, { error: "Fonction mal configurée (SITE_URL manquant)." }, origin);

  // 1. L'appelant doit être l'administrateur, adresse validée, double authentification active.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+$/.test(authHeader)) return reply(401, { error: "Connexion requise." }, origin);
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: who, error: whoErr } = await asCaller.rpc("whoami");
  if (whoErr || !who || who.role !== "admin" || who.admin_ok !== true) {
    return reply(403, { error: "Action réservée à l'administrateur connecté en deux étapes." }, origin);
  }

  // 2. Lecture et contrôle de la demande.
  let body: { action?: string; email?: string; tenantId?: string };
  try { body = await req.json(); } catch { return reply(400, { error: "Demande illisible." }, origin); }
  const action = String(body.action ?? "");
  const tenantId = String(body.tenantId ?? "");
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!TENANT_RE.test(tenantId)) return reply(400, { error: "Société invalide." }, origin);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const log = (act: string, detail: string) =>
    admin.from("audit_log").insert({ email: who.email, action: act, path: "clients/" + tenantId, detail: detail.slice(0, 200) });

  // Comptes existants rattachés à cette société.
  const { data: linked, error: linkErr } = await admin.from("profiles").select("user_id, email").eq("role", "client").eq("tenant_id", tenantId);
  if (linkErr) return reply(500, { error: "Lecture des accès impossible." }, origin);

  if (action === "revoke") {
    for (const p of linked ?? []) await admin.auth.admin.deleteUser(p.user_id);
    await log("accès retiré", (linked ?? []).map((p) => p.email).join(", "));
    return reply(200, { ok: true, removed: (linked ?? []).length }, origin);
  }
  if (action === "reset") {
    // Réinitialisation décidée par l'administrateur : lien envoyé à l'adresse du client.
    const target = (linked ?? [])[0];
    if (!target) return reply(404, { error: "Ce client n'a pas encore d'accès : envoyez d'abord l'invitation." }, origin);
    const { data: u } = await admin.auth.admin.getUserById(target.user_id);
    if (!u?.user?.email_confirmed_at) return reply(409, { error: "Le client n'a pas encore validé son adresse : renvoyez plutôt l'invitation." }, origin);
    const { error: rErr } = await admin.auth.resetPasswordForEmail(target.email, { redirectTo: SITE_URL });
    if (rErr && (rErr.status === 429 || /only request this after/i.test(rErr.message))) {
      return reply(429, { error: "Un e-mail vient déjà d'être envoyé à ce client : réessayez dans une minute." }, origin);
    }
    if (rErr) return reply(502, { error: "Envoi impossible : " + rErr.message }, origin);
    await log("réinitialisation du mot de passe", target.email);
    return reply(200, { ok: true, email: target.email }, origin);
  }
  if (action !== "invite") return reply(400, { error: "Action inconnue." }, origin);
  if (!EMAIL_RE.test(email)) return reply(400, { error: "Adresse e-mail invalide." }, origin);

  // La société doit exister dans le registre.
  const { data: reg } = await admin.from("docs").select("data").eq("path", "clients/" + tenantId).maybeSingle();
  if (!reg) return reply(404, { error: "Client introuvable dans le registre." }, origin);
  if (reg.data?.actif === false) return reply(409, { error: "L'accès de ce client est désactivé : réactivez-le avant d'envoyer l'invitation." }, origin);

  // L'adresse ne doit appartenir ni à l'administrateur ni à une autre société.
  const { data: other } = await admin.from("profiles").select("user_id, role, tenant_id").ilike("email", email.replace(/[\\%_]/g, "\\$&")).maybeSingle();
  if (other && (other.role !== "client" || other.tenant_id !== tenantId)) {
    return reply(409, { error: "Cette adresse e-mail est déjà utilisée par un autre compte." }, origin);
  }

  // Changement d'adresse : l'ancien compte de la société est supprimé.
  for (const p of linked ?? []) {
    if (p.email.toLowerCase() !== email) await admin.auth.admin.deleteUser(p.user_id);
  }

  // Compte déjà validé : pas de nouvelle invitation.
  if (other) {
    const { data: u } = await admin.auth.admin.getUserById(other.user_id);
    if (u?.user?.email_confirmed_at) {
      return reply(409, { error: "Ce client a déjà validé son adresse. En cas d'oubli, il utilise « Mot de passe oublié ? »." }, origin);
    }
  }

  const { data: inv, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: SITE_URL });
  if (invErr || !inv?.user) {
    return reply(502, { error: "Envoi de l'invitation impossible : " + (invErr?.message ?? "erreur inconnue") }, origin);
  }
  const { error: upErr } = await admin.from("profiles").upsert(
    { user_id: inv.user.id, email, role: "client", tenant_id: tenantId },
    { onConflict: "user_id" },
  );
  if (upErr) {
    await admin.auth.admin.deleteUser(inv.user.id);
    return reply(500, { error: "Rattachement du compte impossible." }, origin);
  }
  await log(other ? "invitation renvoyée" : "invitation envoyée", email);
  return reply(200, { ok: true, email }, origin);
});
