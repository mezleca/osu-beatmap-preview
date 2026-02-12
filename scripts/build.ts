import { rmSync, mkdirSync } from "fs";

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
        external: ["jszip", "@rel-packages/osu-beatmap-parser/browser"]
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

    console.log("build complete!");
    console.log(
        "output:",
        result.outputs.map((o) => o.path)
    );
})();
