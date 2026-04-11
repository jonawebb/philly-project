import type { Config } from "@netlify/functions";

// Runs every day at midnight Eastern (05:00 UTC / EST)
// Only posts if there are events today — otherwise exits silently
export const config: Config = {
  schedule: "0 5 * * *",
};

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_KEY!;
const FB_PAGE_ID = process.env.FACEBOOK_PAGE_ID!;
const FB_TOKEN = process.env.FACEBOOK_ACCESS_TOKEN!;

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

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

async function fetchEventsToday(): Promise<any[]> {
  const now = new Date();
  const etNow = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  const today = etNow.toISOString().slice(0, 10);

  const url = `${SUPABASE_URL}/rest/v1/events?status=eq.approved&date=eq.${today}&order=time.asc`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase error: ${await res.text()}`);
  return res.json();
}

function buildDailyPost(events: any[], dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const dayName = DAYS[date.getDay()];
  const monthName = MONTHS[m - 1];
  const count = events.length;

  let post = `✊ ${count} ACTION${count !== 1 ? "S" : ""} IN PHILLY TODAY\n`;
  post += `${dayName}, ${monthName} ${d}\n`;
  post += `${"─".repeat(28)}\n`;

  for (const ev of events) {
    const timeStr = formatTimeRange(ev.time, ev.time_end);
    post += `\n🔥 ${ev.name}\n`;
    post += `⏰ ${timeStr}\n`;
    post += `📍 ${ev.location}\n`;
    if (ev.organizer) post += `👥 ${ev.organizer}\n`;
    // Include description if it's short enough to read on mobile
    if (ev.description && ev.description.length <= 120) {
      post += `\n${ev.description}\n`;
    }
    if (ev.url) post += `🔗 ${ev.url}\n`;
  }

  post += `\n${"─".repeat(28)}\n`;
  post += `More upcoming events 👇\nphillyactions.org\n`;
  post += `\n#PhillyActions #Philadelphia #TakeAction #Protest #Activism`;

  return post;
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
  console.log("Daily post function triggered");
  try {
    const now = new Date(new Date().getTime() - 5 * 60 * 60 * 1000);
    const today = now.toISOString().slice(0, 10);

    const events = await fetchEventsToday();
    console.log(`Found ${events.length} events today (${today})`);

    if (events.length === 0) {
      console.log("No events today — skipping post");
      return;
    }

    const message = buildDailyPost(events, today);
    console.log("Post preview:\n", message);
    await postToFacebook(message);
    console.log("Daily post published successfully");
  } catch (err) {
    console.error("Daily post failed:", err);
  }
}
