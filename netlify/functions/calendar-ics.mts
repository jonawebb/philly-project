import type { Config, Context } from "@netlify/functions";

// Public ICS feed of approved events. Subscribable from Google Calendar,
// Apple Calendar, Outlook, etc.
export const config: Config = {
  path: "/api/calendar.ics",
};

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_KEY!;

const PRODID = "-//Philly Actions//Calendar//EN";
const CAL_NAME = "Philly Actions";
const CAL_DESC = "Protests, rallies, marches and direct actions in Philadelphia";
const TZID = "America/New_York";
const ORIGIN_HOST = "phillyactions.org";

type EventRow = {
  id: string;
  name: string;
  date: string;
  time: string;
  time_end?: string | null;
  location: string;
  organizer: string;
  url?: string | null;
  description?: string | null;
  status: string;
  recur_type?: string | null;
  recur_monthly_mode?: string | null;
  recur_end_date?: string | null;
  recur_no_end?: boolean | null;
  created_at?: string | null;
};

const DOW_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** Escape TEXT property value per RFC 5545: backslash, comma, semicolon, newline. */
function escText(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/** URI properties don't get TEXT escaping, but strip control chars defensively. */
function cleanUri(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/[\r\n\\]/g, "").trim();
}

/** Add https:// to bare URLs like "example.org". Leaves real schemes alone. */
function normalizeUrl(s: string | null | undefined): string {
  const trimmed = cleanUri(s);
  if (!trimmed) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return "https://" + trimmed;
}

/** Fold a logical line to <=75 octets per physical line (UTF-8 safe). */
function foldLine(line: string): string {
  const enc = new TextEncoder();
  const bytes = enc.encode(line);
  if (bytes.length <= 75) return line;

  const dec = new TextDecoder();
  const pieces: string[] = [];
  let i = 0;
  // First physical line: 75 octets. Continuations: 74 octets of content
  // (plus the leading space = 75 octets total).
  let limit = 75;
  while (i < bytes.length) {
    let end = Math.min(i + limit, bytes.length);
    // Don't split in the middle of a UTF-8 multi-byte character.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end--;
    }
    pieces.push(dec.decode(bytes.slice(i, end)));
    i = end;
    limit = 74;
  }
  return pieces.join("\r\n ");
}

/** Format ET-local date+time as "YYYYMMDDTHHMMSS" (used with TZID). */
function fmtLocalDateTime(dateStr: string, timeStr: string): string {
  const [y, m, d] = dateStr.split("-");
  const [hh, mm] = (timeStr || "00:00").split(":");
  return `${y}${m}${d}T${pad(Number(hh))}${pad(Number(mm))}00`;
}

/** Format a JS Date as UTC "YYYYMMDDTHHMMSSZ". */
function fmtUtc(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** HH:MM + hours → HH:MM (clamped within same day for our purposes). */
function addHoursToTime(timeStr: string, hours: number): string {
  const [h, m] = timeStr.split(":").map(Number);
  const total = Math.min(h * 60 + m + hours * 60, 23 * 60 + 59);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** Is a given ET date in DST? US rules: 2nd Sunday of March → 1st Sunday of November. */
function isEtDst(y: number, m: number, d: number): boolean {
  if (m < 3 || m > 11) return false;
  if (m > 3 && m < 11) return true;
  // March or November — need to compute the transition day.
  const firstOfMonth = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0=Sun
  if (m === 3) {
    // Second Sunday
    const secondSunday = ((7 - firstOfMonth) % 7) + 8;
    return d >= secondSunday;
  } else {
    // November: first Sunday
    const firstSunday = ((7 - firstOfMonth) % 7) + 1;
    return d < firstSunday;
  }
}

/** Convert an ET local YYYY-MM-DD + HH:MM to a UTC Date. */
function etToUtc(dateStr: string, timeStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = (timeStr || "00:00").split(":").map(Number);
  const offsetHours = isEtDst(y, m, d) ? 4 : 5; // ET = UTC - offset
  return new Date(Date.UTC(y, m - 1, d, hh + offsetHours, mm, 0));
}

function dayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function weekOfMonth(dateStr: string): number {
  const d = Number(dateStr.split("-")[2]);
  return Math.floor((d - 1) / 7) + 1;
}

/** RRULE line or empty string. */
function buildRrule(ev: EventRow): string {
  const t = ev.recur_type;
  if (!t || t === "none") return "";
  const parts: string[] = [];

  if (t === "daily") {
    parts.push("FREQ=DAILY");
  } else if (t === "weekly") {
    parts.push("FREQ=WEEKLY");
  } else if (t === "monthly") {
    parts.push("FREQ=MONTHLY");
    if (ev.recur_monthly_mode === "weekday") {
      const dow = dayOfWeek(ev.date);
      const wk = weekOfMonth(ev.date);
      parts.push(`BYDAY=${wk}${DOW_CODES[dow]}`);
    }
    // For "date" mode, DTSTART carries the day-of-month implicitly.
  } else {
    return "";
  }

  if (!ev.recur_no_end && ev.recur_end_date) {
    // When DTSTART uses TZID, UNTIL must be in UTC per RFC 5545.
    const endUtc = etToUtc(ev.recur_end_date, "23:59");
    // Bump to 23:59:59 for safety
    endUtc.setUTCSeconds(59);
    parts.push(`UNTIL=${fmtUtc(endUtc)}`);
  }

  return `RRULE:${parts.join(";")}`;
}

function buildVevent(ev: EventRow, now: Date): string[] {
  const uid = `${ev.id}@${ORIGIN_HOST}`;
  const dtstamp = fmtUtc(now);

  const startTime = (ev.time || "00:00").slice(0, 5);
  const endTime =
    ev.time_end && ev.time_end.trim()
      ? ev.time_end.slice(0, 5)
      : addHoursToTime(startTime, 1);

  const startLocal = fmtLocalDateTime(ev.date, startTime);
  const endLocal = fmtLocalDateTime(ev.date, endTime);

  const lines: string[] = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;TZID=${TZID}:${startLocal}`,
    `DTEND;TZID=${TZID}:${endLocal}`,
    `SUMMARY:${escText(ev.name)}`,
  ];

  if (ev.location) lines.push(`LOCATION:${escText(ev.location)}`);

  const normalizedUrl = normalizeUrl(ev.url);

  const descParts: string[] = [];
  if (ev.description) descParts.push(ev.description);
  if (ev.organizer) descParts.push(`Organizer: ${ev.organizer}`);
  if (normalizedUrl) descParts.push(`More info: ${normalizedUrl}`);
  if (descParts.length) {
    lines.push(`DESCRIPTION:${escText(descParts.join("\n\n"))}`);
  }

  if (normalizedUrl) lines.push(`URL:${normalizedUrl}`);

  const rrule = buildRrule(ev);
  if (rrule) lines.push(rrule);

  lines.push("END:VEVENT");
  return lines;
}

// America/New_York VTIMEZONE with current DST rules. Modern clients recognize
// the TZID by name, but RFC 5545 wants the block included for portability.
const VTIMEZONE_ET = [
  "BEGIN:VTIMEZONE",
  `TZID:${TZID}`,
  "X-LIC-LOCATION:America/New_York",
  "BEGIN:DAYLIGHT",
  "DTSTART:19700308T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
  "TZOFFSETFROM:-0500",
  "TZOFFSETTO:-0400",
  "TZNAME:EDT",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "DTSTART:19701101T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
  "TZOFFSETFROM:-0400",
  "TZOFFSETTO:-0500",
  "TZNAME:EST",
  "END:STANDARD",
  "END:VTIMEZONE",
];

export function buildIcs(events: EventRow[]): string {
  const now = new Date();
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escText(CAL_NAME)}`,
    `X-WR-CALDESC:${escText(CAL_DESC)}`,
    `X-WR-TIMEZONE:${TZID}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...VTIMEZONE_ET,
  ];

  for (const ev of events) {
    if (!ev.id || !ev.date || !ev.time || !ev.name) continue;
    lines.push(...buildVevent(ev, now));
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

async function fetchApprovedEvents(): Promise<EventRow[]> {
  const url = `${SUPABASE_URL}/rest/v1/events?status=eq.approved&order=date.asc,time.asc`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Supabase error: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export default async function handler(req: Request, _context: Context) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const events = await fetchApprovedEvents();
    const ics = buildIcs(events);
    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="phillyactions.ics"',
        // 15 min — Netlify edge will cache between subscriber polls.
        // Google Calendar ignores this and refreshes on its own (hours-scale),
        // but for occasional direct-browser downloads the cache is nice.
        "Cache-Control": "public, max-age=900",
      },
    });
  } catch (err: any) {
    console.error("Calendar feed error:", err);
    return new Response(`Error generating calendar: ${err.message}`, {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
  }
}
