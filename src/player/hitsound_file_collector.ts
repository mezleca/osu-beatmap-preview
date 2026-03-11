import type { IBeatmap } from "../types/beatmap";

const AUDIO_FILE_EXTENSIONS = [".wav", ".mp3", ".ogg"];
const DEFAULT_HITSOUND_SETS = new Set(["normal", "soft", "drum"]);
const DEFAULT_HITSOUND_TYPES = new Set(["hitnormal", "hitwhistle", "hitfinish", "hitclap", "slidertick", "sliderslide", "sliderwhistle"]);
const NIGHTCORE_TYPES = new Set(["hat", "clap", "kick", "finish"]);
const NIGHTCORE_PREFIX = "nightcore-";

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
        const sample_key = strip_audio_extension(file_name);
        const matches_default_pattern = is_default_hitsound_key(sample_key) || is_nightcore_hitsound_key(sample_key);
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

const strip_audio_extension = (file_name: string): string => {
    for (const ext of AUDIO_FILE_EXTENSIONS) {
        if (file_name.endsWith(ext)) {
            return file_name.slice(0, -ext.length);
        }
    }
    return file_name;
};

const strip_trailing_digits = (value: string): string => {
    let end = value.length;
    while (end > 0) {
        const code = value.charCodeAt(end - 1);
        if (code < 48 || code > 57) {
            break;
        }
        end -= 1;
    }
    return value.slice(0, end);
};

const is_default_hitsound_key = (sample_key: string): boolean => {
    const dash = sample_key.indexOf("-");
    if (dash <= 0) {
        return false;
    }
    const set_name = sample_key.slice(0, dash);
    if (!DEFAULT_HITSOUND_SETS.has(set_name)) {
        return false;
    }
    const type = strip_trailing_digits(sample_key.slice(dash + 1));
    return DEFAULT_HITSOUND_TYPES.has(type);
};

const is_nightcore_hitsound_key = (sample_key: string): boolean => {
    if (!sample_key.startsWith(NIGHTCORE_PREFIX)) {
        return false;
    }
    const type = strip_trailing_digits(sample_key.slice(NIGHTCORE_PREFIX.length));
    return NIGHTCORE_TYPES.has(type);
};
