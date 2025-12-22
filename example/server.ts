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

        const file = Bun.file(`./example${path}`);

        if (await file.exists()) {
            return new Response(file);
        }

        return new Response("Not found", { status: 404 });
    }
});

console.log(`http://localhost:${server.port}`);
