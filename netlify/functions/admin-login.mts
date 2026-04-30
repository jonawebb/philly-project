import type { Config, Context } from "@netlify/functions";

// POST /api/admin-login with { password: string } — checks against the
// ADMIN_PASSWORD env var. Returns { ok: true } on match.
//
// Security note: this only gates the admin UI. Because the browser still
// holds the Supabase anon key (and our RLS policy is open for now), a
// determined attacker can write to the DB without going through the UI.
// Hardening that requires either narrowing RLS or moving all writes
// through Netlify Functions with a service-role key — out of scope here.
export const config: Config = {
  path: "/api/admin-login",
};

// Constant-time string compare to avoid leaking length / prefix info via
// response timing. Returns false fast if lengths differ but that's fine —
// length itself is not the secret.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export default async function handler(req: Request, _context: Context) {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return new Response(
      JSON.stringify({ ok: false, error: "ADMIN_PASSWORD env var not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  let body: any = null;
  try { body = await req.json(); } catch (_) {}
  const supplied = (body && typeof body.password === "string") ? body.password : "";

  const ok = safeEqual(supplied, expected);

  return new Response(
    JSON.stringify({ ok }),
    {
      status: ok ? 200 : 401,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );
}
