import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

const resolutionsPath = fileURLToPath(new URL("../config/resolutions.json", import.meta.url));

function exposeResolutions(): Plugin {
  return {
    name: "expose-resolutions",
    configureServer(server) {
      server.middlewares.use("/resolutions.json", (_request, response) => {
        response.setHeader("Content-Type", "application/json");
        response.end(readFileSync(resolutionsPath, "utf-8"));
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "resolutions.json",
        source: readFileSync(resolutionsPath, "utf-8"),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), exposeResolutions()],
  publicDir: "../data/output",
});
