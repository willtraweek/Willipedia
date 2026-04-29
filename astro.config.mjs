import { defineConfig } from "astro/config";
import node from "@astrojs/node";

export default defineConfig({
  adapter: node({
    mode: "standalone"
  }),
  base: "/wiki",
  output: "server",
  scopedStyleStrategy: "where",
  server: {
    host: true
  },
  vite: {
    resolve: {
      alias: {
        "@": new URL("./src", import.meta.url).pathname
      }
    }
  }
});
