import type { Config } from "@netlify/functions";

// Runs every Sunday at midnight Eastern (05:00 UTC, accounting for ET = UTC-5 in winter)
// Cron is in UTC. ET is UTC-5 (EST) / UTC-4 (EDT).
// "0 5 * * 0" = 5:00 AM UTC every Sunday = midnight EST Sunday
// We use 5:00 UTC which is midnight EST; in EDT (summer) this is 1:00 AM ET.
// If you want strictly midnight ET year-round you'd need a timezone-aware scheduler,
// but this is close enough for a community calendar.
export const config: Config = {
  schedule: "0 5 * * 0",
};

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_KEY!;
const FB_PAGE_ID = process.env.FACEBOOK_PAGE_ID!;
const FB_TOKEN = process.env.FACEBOOK_ACCESS_TOKEN!;

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${DAYS[date.getDay()]}, ${MONTHS[m - 1]} ${d}`;
}

function formatTime(timeStr: string): string {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

function formatTimeRange(start: string, end: string): string {
  if (!end) return formatTime(start);
  return `${formatTime(start)}–${formatTime(end)}`;
}

async function fetchEventsThisWeek() {
  // Get today and 7 days from now in ET (approximate with UTC offset)
  const now = new Date();
  // Shift to ET by subtracting 5 hours (EST; close enough for date purposes)
  const etNow = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  const today = etNow.toISOString().slice(0, 10);
  const nextWeek = new Date(etNow.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const url = `${SUPABASE_URL}/rest/v1/events?status=eq.approved&date=gte.${today}&date=lte.${nextWeek}&order=date.asc,time.asc`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase error: ${await res.text()}`);
  return res.json();
}

function buildWeeklyPost(events: any[]): string {
  const now = new Date(new Date().getTime() - 5 * 60 * 60 * 1000);
  const today = now.toISOString().slice(0, 10);
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [ty, tm, td] = today.split("-").map(Number);
  const [ny, nm, nd] = nextWeek.split("-").map(Number);

  const header = `📅 PHILLY ACTIONS THIS WEEK\n${MONTHS[tm-1]} ${td} – ${MONTHS[nm-1]} ${nd}, ${ny}\n\nHere's what's happening in Philadelphia this week:\n`;

  if (events.length === 0) {
    return header + "\nNo events listed this week — check back soon, or submit your event at phillyactions.org!\n\n#PhillyActions #Philadelphia #Activism";
  }

  // Group events by date
  const byDate: Record<string, any[]> = {};
  for (const ev of events) {
    (byDate[ev.date] = byDate[ev.date] || []).push(ev);
  }

  let body = "";
  for (const [date, dayEvents] of Object.entries(byDate)) {
    body += `\n📍 ${formatDate(date)}\n`;
    for (const ev of dayEvents) {
      body += `\n▸ ${ev.name}\n`;
      body += `  🕐 ${formatTimeRange(ev.time, ev.time_end)}\n`;
      body += `  📌 ${ev.location}\n`;
      body += `  🏳️ ${ev.organizer}\n`;
      if (ev.url) body += `  🔗 ${ev.url}\n`;
    }
  }

  const footer = `\nSee all upcoming events and submit your own at phillyactions.org\n\n#PhillyActions #Philadelphia #Activism #Protest #CommunityOrganizing`;

  return header + body + footer;
}

async function postToFacebook(message: string): Promise<void> {
  const res = await fetch(`https://graph.facebook.com/v19.0/${FB_PAGE_ID}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      access_token: FB_TOKEN,
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Facebook API error: ${JSON.stringify(err)}`);
  }
  const data = await res.json();
  console.log("Posted successfully, post ID:", data.id);
}

export default async function handler() {
  console.log("Weekly post function triggered");
  try {
    const events = await fetchEventsThisWeek();
    console.log(`Found ${events.length} events this week`);
    const message = buildWeeklyPost(events);
    console.log("Post preview:\n", message);
    await postToFacebook(message);
    console.log("Weekly post published successfully");
  } catch (err) {
    console.error("Weekly post failed:", err);
    // Don't throw — Netlify will mark the function as failed but we want clean logs
  }
}
