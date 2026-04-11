import type { Config } from "@netlify/functions";

// Runs every day at 1:00 AM Eastern (06:00 UTC)
// Slightly offset from the daily post (which runs at 05:00 UTC) so they don't overlap
export const config: Config = {
  schedule: "0 6 * * *",
};

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_KEY!;

async function dbFetch(path: string, opts: any = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: opts.prefer || "return=representation",
    },
    method: opts.method || "GET",
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase error ${res.status}: ${err}`);
  }
  if (opts.method === "DELETE" || opts.method === "PATCH" || res.status === 204) return null;
  return res.json();
}

export default async function handler() {
  console.log("Cleanup function triggered");

  try {
    // Get today's date in ET (UTC-5, close enough for date purposes)
    const now = new Date(Date.now() - 5 * 60 * 60 * 1000);
    const today = now.toISOString().slice(0, 10);
    console.log(`Cleaning up events before ${today}`);

    // 1. Delete non-recurring events whose date has passed
    await dbFetch(
      `events?recur_type=eq.none&date=lt.${today}`,
      { method: "DELETE", prefer: "return=minimal" }
    );
    console.log("Deleted old non-recurring events");

    // 2. Delete recurring events that have an end date in the past
    await dbFetch(
      `events?recur_type=neq.none&recur_no_end=eq.false&recur_end_date=lt.${today}`,
      { method: "DELETE", prefer: "return=minimal" }
    );
    console.log("Deleted expired recurring events");

    // 3. Leave recurring events with no end date untouched — they're still active

    console.log("Cleanup complete");
  } catch (err) {
    console.error("Cleanup failed:", err);
  }
}
