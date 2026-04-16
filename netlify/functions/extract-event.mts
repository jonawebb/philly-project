import type { Config, Context } from "@netlify/functions";

export const config: Config = {
  path: "/api/extract-event",
};

export default async function handler(req: Request, context: Context) {
  // Only allow POST
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  if (!ANTHROPIC_KEY) {
    return new Response(JSON.stringify({ error: "Anthropic API key not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { imageBase64, mediaType, year } = body;
  if (!imageBase64 || !mediaType) {
    return new Response(JSON.stringify({ error: "Missing imageBase64 or mediaType" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-opus-4-5",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: imageBase64 },
            },
            {
              type: "text",
              text: `Extract event details from this image and return ONLY a JSON object with these exact fields:
{
  "name": "event name",
  "date": "YYYY-MM-DD or empty string if not found",
  "time": "HH:MM in 24h format or empty string if not found",
  "timeEnd": "HH:MM in 24h format or empty string if not found",
  "location": "venue and/or address or empty string if not found",
  "organizer": "organizing group or person or empty string if not found",
  "url": "website URL if present or empty string",
  "desc": "brief description of the event, 1-2 sentences max, or empty string"
}
Return only the JSON, no other text. If the image does not appear to be an event announcement, return all empty strings. For the date, use the current year ${year || new Date().getFullYear()} if only month and day are given.`,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    return new Response(JSON.stringify({ error: err.error?.message || "Anthropic API error" }), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const data = await response.json();
  const text = data.content[0].text.trim();

  let extracted: any;
  try {
    extracted = JSON.parse(text.replace(/^```json|```$/g, "").trim());
  } catch (e) {
    return new Response(JSON.stringify({ error: "Could not parse response: " + text.slice(0, 100) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(extracted), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
