const server = Bun.serve({
    port: 3000,
    async fetch(req) {
        const url = new URL(req.url);
        let path = url.pathname;

        if (path === "/") {
            path = "/index.html";
        }

        // handle TypeScript files with bundling
        if (path.endsWith(".ts")) {
            try {
                const result = await Bun.build({
                    entrypoints: [`./example${path}`],
                    external: []
                });

                if (result.outputs.length > 0) {
                    const code = await result.outputs[0].text();
                    return new Response(code, {
                        headers: { "Content-Type": "application/javascript" }
                    });
                }
            } catch (err) {
                console.error("Build error:", err);
                return new Response(`Build error: ${err}`, { status: 500 });
            }
        }

        if (path.startsWith("/browser/")) {
            const rel = path.replace("/browser/", "");
            const dist_file = Bun.file(`./dist/browser/${rel}`);
            if (await dist_file.exists()) {
                return new Response(dist_file);
            }

            const node_modules_file = Bun.file(`./node_modules/@rel-packages/osu-beatmap-parser/dist/browser/${rel}`);
            if (await node_modules_file.exists()) {
                return new Response(node_modules_file);
            }
        }

        if (path.startsWith("/assets/")) {
            const rel = path.replace("/assets/", "");
            const example_file = Bun.file(`./example/assets/${rel}`);
            if (await example_file.exists()) {
                return new Response(example_file);
            }

            const dist_file = Bun.file(`./dist/assets/${rel}`);
            if (await dist_file.exists()) {
                return new Response(dist_file);
            }

            const src_file = Bun.file(`./src/assets/${rel}`);
            if (await src_file.exists()) {
                return new Response(src_file);
            }
        }

        const file = Bun.file(`./example${path}`);

        if (await file.exists()) {
            return new Response(file);
        }

        return new Response("Not found", { status: 404 });
    }
});

console.log(`http://localhost:${server.port}`);
