import type { IBeatmap } from "../types/beatmap";

const AUDIO_FILE_EXTENSIONS = [".wav", ".mp3", ".ogg"];
const DEFAULT_HITSOUND_FILE_PATTERN = /^(normal|soft|drum)-(hitnormal|hitwhistle|hitfinish|hitclap|slidertick|sliderslide|sliderwhistle)\d*$/i;

export const collect_map_custom_hitsound_files = (
    beatmap: IBeatmap,
    files: Map<string, ArrayBuffer>,
    audio_filename?: string
): Map<string, ArrayBuffer> => {
    const custom_names: Set<string> = new Set();

    for (const obj of beatmap.HitObjects) {
        const filename = obj.hitSample?.filename?.trim();
        if (filename) {
            custom_names.add(filename.toLowerCase());
        }
    }

    const selected: Map<string, ArrayBuffer> = new Map();
    const audio_name = audio_filename?.toLowerCase();

    for (const [path, data] of files) {
        const lower_path = path.toLowerCase();
        if (!is_audio_file(lower_path)) {
            continue;
        }

        if (audio_name && lower_path == audio_name) {
            continue;
        }

        const file_name = get_base_file_name(lower_path);
        const sample_key = file_name.replace(/\.(wav|mp3|ogg)$/, "");
        const matches_default_pattern = DEFAULT_HITSOUND_FILE_PATTERN.test(sample_key);
        const is_referenced_custom = custom_names.has(file_name) || custom_names.has(sample_key) || custom_names.has(lower_path);

        if (matches_default_pattern || is_referenced_custom) {
            selected.set(path, data);
        }
    }

    return selected;
};

const is_audio_file = (path: string): boolean => {
    for (const ext of AUDIO_FILE_EXTENSIONS) {
        if (path.endsWith(ext)) {
            return true;
        }
    }
    return false;
};

const get_base_file_name = (path: string): string => {
    const clean = path.split("?")[0].split("#")[0];
    const file_name = clean.split("/").pop();
    return file_name ?? clean;
};
