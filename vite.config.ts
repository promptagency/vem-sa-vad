import { readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev-only: serves `/proxy.php` with the hosted proxy itself (functions/proxy.php.ts),
// so `npm run dev` gets exactly its rules — same-origin callers, no private hosts,
// redirects checked per hop, feeds and media only, inert content types.
function devPodcastProxy(): PluginOption {
  return {
    name: 'dev-podcast-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/proxy.php')) return next()
        try {
          // Loaded through Vite, not imported: the file is typed for Cloudflare, not Node.
          const { onRequestGet } = await server.ssrLoadModule('/functions/proxy.php.ts')
          const site = req.headers['sec-fetch-site']
          const request = new Request(new URL(req.url, 'http://localhost'), {
            headers: typeof site === 'string' ? { 'Sec-Fetch-Site': site } : {},
          })
          const response: Response = await onRequestGet({ request })
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          if (response.body) Readable.fromWeb(response.body as NodeReadableStream).pipe(res)
          else res.end()
        } catch (err) {
          res.statusCode = 502
          res.end('Dev proxy error: ' + ((err as Error)?.message ?? String(err)))
        }
      })
    },
  }
}

// onnxruntime-web references its WebAssembly binary with `new URL(…, import.meta.url)`,
// so Vite copies a ~26 MB .wasm into dist/. It is only a fallback for when no
// `wasmPaths` is set — and Transformers.js always sets it, loading the runtime
// from jsDelivr (and caching it). The copy is never fetched, and it is over
// Cloudflare Pages' 25 MiB per-file limit, so it is left out of the build.
function dropUnusedOrtWasm(): PluginOption {
  return {
    name: 'drop-unused-ort-wasm',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const name of Object.keys(bundle)) {
        if (/(^|\/)ort-wasm[\w.-]*\.wasm$/.test(name)) delete bundle[name]
      }
    },
  }
}

// Relative base ('./') so the static build can be dropped into ANY folder on the
// Apache/LAMP web root (root or a subfolder) without rewriting asset URLs.
// The version shown in the footer: package.json's, which a release tag must match.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
if (typeof version !== 'string' || !version) throw new Error('package.json has no version')

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react(), tailwindcss(), devPodcastProxy(), dropUnusedOrtWasm()],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // onnxruntime-web (pulled in by transformers.js) ships its own wasm and does
    // not pre-bundle cleanly; let Vite load it as-is.
    exclude: ['@huggingface/transformers'],
  },
  server: {
    headers: {
      // Enable cross-origin isolation in dev so multi-threaded WASM (SharedArrayBuffer)
      // is available. 'credentialless' still allows no-cors fetches of model weights
      // from the Hugging Face CDN.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
})
