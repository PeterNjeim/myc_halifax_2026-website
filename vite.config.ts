import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import devtools from "solid-devtools/vite";
import simpleHtmlPlugin from "vite-plugin-simple-html";
import { ViteImageOptimizer } from 'vite-plugin-image-optimizer';

export default defineConfig({
  plugins: [devtools(), solidPlugin(), simpleHtmlPlugin({ minify: true }), ViteImageOptimizer({
    svg: {
      multipass: true,
      plugins: [
        {
          name: 'preset-default',
          params: {
            overrides: {
              // cleanupNumericValues: false,
              cleanupIds: {
                minify: true,
                remove: true,
              },
              // convertPathData: false,
            },
          },
        },
        'sortAttrs',
        {
          name: 'addAttributesToSVGElement',
          params: {
            attributes: [{ xmlns: 'http://www.w3.org/2000/svg' }],
          },
        },
      ],
    },
    png: {
      quality: 50,
    },
    webp: {
      lossless: false,
    },
  })],
  // base: "/myc_halifax_2026-schedule/",
  server: {
    port: 3000,
  },
  build: {
    target: ['es2020', 'safari16'],
  },
});
