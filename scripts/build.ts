import { rmSync, mkdirSync, cpSync } from "fs";
import { existsSync, copyFileSync } from "fs";
import { dirname, join } from "path";

const OUT_DIR = "./dist";

(async () => {
    try {
        rmSync(OUT_DIR, { recursive: true });
    } catch {
        console.log("[warn] failed to clean dist directory");
    }

    mkdirSync(OUT_DIR, { recursive: true });

    const result = await Bun.build({
        entrypoints: ["./src/index.ts"],
        outdir: OUT_DIR,
        target: "browser",
        format: "esm",
        minify: true,
        sourcemap: "external",
        external: ["jszip"]
    });

    if (!result.success) {
        console.error("build failed:");
        for (const log of result.logs) {
            console.error(log);
        }
        process.exit(1);
    }

    const tsc = Bun.spawn(["bun", "run", "tsc", "-p", "src/tsconfig.json", "--declaration", "--emitDeclarationOnly", "--outDir", "dist"], {
        stdout: "inherit",
        stderr: "inherit"
    });

    const exit_code = await tsc.exited;

    if (exit_code !== 0) {
        console.error(`tsc failed with exit code ${exit_code}`);
        process.exit(1);
    }

    await tsc.exited;

    const wasm_source = join("node_modules", "@rel-packages", "osu-beatmap-parser", "dist", "browser", "osu-parser.browser.js");
    const wasm_target = join(OUT_DIR, "browser", "osu-parser.browser.js");

    if (existsSync(wasm_source)) {
        mkdirSync(dirname(wasm_target), { recursive: true });
        copyFileSync(wasm_source, wasm_target);
    } else {
        console.warn("[warn] wasm bundle not found. run bun install or ensure @rel-packages/osu-beatmap-parser is installed.");
    }

    const assets_source = join("src", "assets");
    const assets_target = join(OUT_DIR, "assets");
    if (existsSync(assets_source)) {
        cpSync(assets_source, assets_target, { recursive: true });
    }

    console.log("build complete!");
    console.log(
        "output:",
        result.outputs.map((o) => o.path)
    );
})();
