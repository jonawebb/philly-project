import type { Config, Context } from "@netlify/functions";

// Returns the Supabase URL + anon key from Netlify env vars so they
// don't have to be hardcoded in the deployed HTML. The anon key still
// reaches the browser (it has to — the client makes Supabase REST
// calls), but at least it's no longer in `view-source` of index.html
// and can be rotated by editing Netlify env vars instead of redeploying.
export const config: Config = {
  path: "/api/config",
};

export default async function handler(req: Request, _context: Context) {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return new Response(
      JSON.stringify({
        error:
          "Server config missing. Set SUPABASE_URL and SUPABASE_KEY in Netlify env.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  return new Response(
    JSON.stringify({ supabaseUrl, supabaseKey }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        // Short edge cache; if env changes, redeploy or wait a minute.
        "Cache-Control": "public, max-age=60",
      },
    },
  );
}
