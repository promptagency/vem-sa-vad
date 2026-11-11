// The two Cloudflare types functions/proxy.php.ts names, so the tests program can
// type-check it without @cloudflare/workers-types (which clashes with the DOM types).
interface Fetcher {
  fetch(input: string): Promise<Response>;
}
type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => Response | Promise<Response>;
