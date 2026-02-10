export const load_default_hitsounds = async (base_url: string): Promise<Map<string, ArrayBuffer>> => {
    const files = new Map<string, ArrayBuffer>();

    if (typeof fetch === "undefined") {
        return files;
    }

    let manifest: string[] = [];

    try {
        const response = await fetch(`${base_url}/manifest.json`);
        if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data)) {
                manifest = data.filter((name) => typeof name == "string");
            }
        }
    } catch {}

    if (manifest.length == 0) {
        return files;
    }

    await Promise.all(
        manifest.map(async (name) => {
            try {
                const response = await fetch(`${base_url}/${name}`);
                if (!response.ok) {
                    return;
                }
                const buffer = await response.arrayBuffer();
                files.set(name, buffer);
            } catch {}
        })
    );

    return files;
};
