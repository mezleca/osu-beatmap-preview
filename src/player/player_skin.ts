import JSZip from "jszip";

type SkinFileValue = ArrayBuffer | string;

export const convert_skin_files = (files: Map<string, SkinFileValue>): Map<string, ArrayBuffer> => {
    const converted = new Map<string, ArrayBuffer>();
    for (const [name, value] of files) {
        if (value instanceof ArrayBuffer) {
            converted.set(name, value);
            continue;
        }

        converted.set(name, new TextEncoder().encode(value).buffer as ArrayBuffer);
    }
    return converted;
};

export const load_skin_osk_files = async (data: ArrayBuffer): Promise<Map<string, ArrayBuffer>> => {
    const zip = await JSZip.loadAsync(data);
    const files = new Map<string, ArrayBuffer>();
    const entries = Object.entries(zip.files);

    for (let i = 0; i < entries.length; i++) {
        const [name, file] = entries[i];
        if (file.dir) {
            continue;
        }
        files.set(name, await file.async("arraybuffer"));
    }

    return files;
};

export const merge_skin_sources = (
    default_skin_files: Map<string, ArrayBuffer> | null,
    custom_skin_files: Map<string, ArrayBuffer> | null
): Map<string, ArrayBuffer> => {
    const merged = new Map<string, ArrayBuffer>();

    if (default_skin_files) {
        for (const [name, data] of default_skin_files) {
            merged.set(name, data);
        }
    }

    if (custom_skin_files) {
        for (const [name, data] of custom_skin_files) {
            merged.set(name, data);
        }
    }

    return merged;
};

export const merge_hitsound_sources = (
    map_files: Map<string, ArrayBuffer>,
    custom_skin_files: Map<string, ArrayBuffer> | null,
    default_skin_files: Map<string, ArrayBuffer> | null
): Map<string, ArrayBuffer> => {
    const merged = new Map<string, ArrayBuffer>(map_files);

    if (custom_skin_files) {
        for (const [name, data] of custom_skin_files) {
            if (!merged.has(name)) {
                merged.set(name, data);
            }
        }
    }

    if (default_skin_files) {
        for (const [name, data] of default_skin_files) {
            if (!merged.has(name)) {
                merged.set(name, data);
            }
        }
    }

    return merged;
};

export const load_default_skin_folder_files = async (
    base_urls: string[],
    resolve_asset_url: (name: string, base_url?: string) => string
): Promise<Map<string, ArrayBuffer> | null> => {
    for (let base_index = 0; base_index < base_urls.length; base_index++) {
        const base_url = base_urls[base_index];
        try {
            const manifest_response = await fetch(resolve_asset_url("manifest.json", base_url));
            if (!manifest_response.ok) {
                continue;
            }

            const manifest = (await manifest_response.json()) as string[];
            if (!Array.isArray(manifest) || manifest.length === 0) {
                continue;
            }

            const files = new Map<string, ArrayBuffer>();
            const targets = manifest.filter((name) => !!name && !name.endsWith("/"));
            const batch_size = 24;

            for (let i = 0; i < targets.length; i += batch_size) {
                const batch = targets.slice(i, i + batch_size);
                const loaded = await Promise.all(
                    batch.map(async (name) => {
                        try {
                            const response = await fetch(resolve_asset_url(name, base_url));
                            if (!response.ok) {
                                return null;
                            }
                            return { name, data: await response.arrayBuffer() };
                        } catch {
                            return null;
                        }
                    })
                );

                for (let j = 0; j < loaded.length; j++) {
                    const entry = loaded[j];
                    if (!entry) {
                        continue;
                    }
                    files.set(entry.name, entry.data);
                }
            }

            if (files.size > 0) {
                return files;
            }
        } catch {
            continue;
        }
    }

    return null;
};
