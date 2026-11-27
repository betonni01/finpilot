import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';

/** Copie le moteur ONNX (WebAssembly) dans public/ort pour la reconnaissance vocale privée, sans CDN externe. */
function copyOrt() {
  return {
    name: 'finpilot-copy-ort',
    buildStart() {
      const src = 'node_modules/onnxruntime-web/dist/';
      if (!existsSync(src)) return;
      mkdirSync('public/ort', { recursive: true });
      for (const f of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
        if (!existsSync('public/ort/' + f)) copyFileSync(src + f, 'public/ort/' + f);
      }
    },
  };
}
const isolation = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    resolve: single ? { alias: { 'virtual:pwa-register': '/src/stubs/pwa-register.ts', '@huggingface/transformers': '/src/stubs/transformers.ts' } } : undefined,
    worker: { format: 'es' },
    define: { __SINGLE__: JSON.stringify(single) },
    plugins: [
      react(),
      tailwindcss(),
      ...(single
        ? [viteSingleFile()]
        : [
            copyOrt(),
            VitePWA({
              registerType: 'autoUpdate',
              includeAssets: ['icon.svg'],
              manifest: {
                name: 'FINPILOT, pilotage financier personnel',
                short_name: 'FINPILOT',
                description: 'Pilotage, simulation et planification financière personnelle et de projets',
                lang: 'fr',
                theme_color: '#0f172a',
                background_color: '#0f172a',
                display: 'standalone',
                start_url: './',
                scope: './',
                icons: [
                  { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
                  { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
                  { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
                ],
              },
              workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'], globIgnores: ['ort/**', 'models/**'], maximumFileSizeToCacheInBytes: 6_000_000, importScripts: ['push-sw.js'], navigateFallbackDenylist: [/^\/api\//], runtimeCaching: [{ urlPattern: ({ url }: { url: URL }) => /\/ort\//.test(url.pathname), handler: 'CacheFirst', options: { cacheName: 'finpilot-ort', expiration: { maxEntries: 8 } } }] },
            }),
          ]),
    ],
    build: { outDir: single ? 'dist-single' : 'dist', chunkSizeWarningLimit: 3000 },
    server: { headers: isolation, proxy: { '/api': process.env.FINPILOT_API ?? 'http://localhost:8000' } },
    preview: { headers: isolation, proxy: { '/api': process.env.FINPILOT_API ?? 'http://localhost:8000' } },
    test: { environment: 'node' },
  };
});
