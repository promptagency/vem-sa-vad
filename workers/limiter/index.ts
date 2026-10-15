// Counts podcast-proxy requests per visitor for functions/proxy.php.ts, which
// reaches this Worker through a service binding: Pages Functions can't hold a
// rate-limit binding themselves. Not reachable from the internet (no route,
// workers_dev off). Answers 204 to go ahead, 429 when the visitor is over.

interface Env {
  PROXY: RateLimit;
}

export default {
  async fetch(request, env): Promise<Response> {
    const key = new URL(request.url).searchParams.get("key") ?? "";
    const { success } = await env.PROXY.limit({ key });
    return new Response(null, { status: success ? 204 : 429 });
  },
} satisfies ExportedHandler<Env>;
