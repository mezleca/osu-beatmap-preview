import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(CURRENT_DIR, "..");

export default defineConfig({
    plugins: [svelte()],
    build: {
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes("node_modules/pixi.js")) {
                        return "pixi";
                    }
                    if (id.includes("node_modules/jszip")) {
                        return "jszip";
                    }
                    if (id.includes("@rel-packages/osu-beatmap-parser")) {
                        return "beatmap-parser";
                    }
                    return undefined;
                }
            }
        }
    },
    optimizeDeps: {
        exclude: ["@rel-packages/osu-beatmap-parser", "@rel-packages/osu-beatmap-parser/browser"]
    },
    resolve: {
        alias: {
            "@": path.join(REPO_ROOT, "src")
        }
    },
    server: {
        fs: {
            allow: [REPO_ROOT]
        }
    }
});
