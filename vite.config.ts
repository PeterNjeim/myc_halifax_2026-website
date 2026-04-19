import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import devtools from "solid-devtools/vite";
import simpleHtmlPlugin from "vite-plugin-simple-html";

export default defineConfig({
  plugins: [devtools(), solidPlugin(), simpleHtmlPlugin({ minify: true })],
  base: "/myc_halifax_2026-schedule/solidjs",
  server: {
    port: 3000,
  },
  build: {
    target: "esnext",
  },
});
