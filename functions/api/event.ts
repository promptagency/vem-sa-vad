// Cloudflare Pages Function: forwards the page view from src/lib/analytics.ts
// to Prompt Agency's Plausible, so the page only ever talks to its own origin
// and the CSP needs no analytics host. Nothing is logged, stored or cached.

const PLAUSIBLE_EVENT = "https://plausible.app.promptagency.se/api/event";

export const onRequest: PagesFunction = async ({ request }) => {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const upstream = await fetch(PLAUSIBLE_EVENT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": request.headers.get("User-Agent") ?? "",
      // Plausible derives country and its daily visitor hash from the visitor's IP.
      "X-Forwarded-For": request.headers.get("CF-Connecting-IP") ?? "",
    },
    body: await request.text(),
  });
  return new Response(null, { status: upstream.status });
};
