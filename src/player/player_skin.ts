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
