import type { IBeatmap, IBeatmapInfo } from "../types/beatmap";
import { GameMode } from "../types/beatmap";
import {
    init_wasm,
    is_wasm_ready,
    parse as wasm_parse,
    get_property as wasm_get_property,
    get_properties as wasm_get_properties,
    get_section as wasm_get_section,
    set_wasm_factory
} from "@rel-packages/osu-beatmap-parser/dist/lib/wasm-wrapper.js";
import type { OsuFileFormat } from "@rel-packages/osu-beatmap-parser/dist/types/types";

type wasm_parser_options = {
    script_url?: string;
    global_name?: string;
    module_config?: Record<string, unknown>;
    factory?: (module_config?: Record<string, unknown>) => any;
};

let wasm_options: wasm_parser_options | null = null;
let wasm_init_promise: Promise<void> | null = null;
const encoder = new TextEncoder();
export const configure_wasm_parser = (options: wasm_parser_options): void => {
    wasm_options = options;

    if (options.factory) {
        set_wasm_factory(options.factory, options.global_name);
    }
};

const ensure_wasm_ready = async (): Promise<void> => {
    if (is_wasm_ready()) return;
    if (wasm_init_promise) return wasm_init_promise;

    const options = wasm_options ?? {};
    wasm_init_promise = init_wasm({
        factory: options.factory,
        module_config: options.module_config ?? {},
        global_name: options.global_name
    });

    return wasm_init_promise;
};

export const init_wasm_parser = async (options?: wasm_parser_options): Promise<void> => {
    if (options) {
        configure_wasm_parser(options);
    }
    return ensure_wasm_ready();
};

const assert_wasm_ready = (): void => {
    if (!is_wasm_ready()) {
        throw new Error("WASM parser not initialized. Call init_wasm_parser or configure_wasm_parser.");
    }
};

const to_bytes = (content: string): Uint8Array => encoder.encode(content);
const to_data = (content: string | Uint8Array): Uint8Array => (typeof content === "string" ? to_bytes(content) : content);

const parse_video_info = (lines: string[]): { filename: string; offset: number } | null => {
    for (const line of lines) {
        const parts = line.split(",");
        if (parts.length < 3) continue;

        const event_type = parts[0].trim();
        if (event_type !== "Video" && event_type !== "1") continue;

        const offset = parseInt(parts[1]);
        const filename = parts[2].replace(/^"|"$/g, "");
        if (!filename) continue;

        return { filename, offset: Number.isFinite(offset) ? offset : 0 };
    }

    return null;
};

export class BeatmapParser {
    parse(content: string | Uint8Array): IBeatmap {
        assert_wasm_ready();
        const data = to_data(content);
        const file = wasm_parse(data) as OsuFileFormat;
        return file;
    }

    parse_info(content: string | Uint8Array, filename: string): IBeatmapInfo {
        assert_wasm_ready();
        const data = to_data(content);
        const props = wasm_get_properties(data, [
            "Title",
            "Artist",
            "Version",
            "Mode",
            "ApproachRate",
            "CircleSize",
            "OverallDifficulty",
            "HPDrainRate"
        ]);

        const ar = parseFloat(props.ApproachRate ?? "-1");
        const od = parseFloat(props.OverallDifficulty ?? "5");

        return {
            filename,
            title: props.Title ?? "",
            artist: props.Artist ?? "",
            version: props.Version ?? "",
            mode: parseInt(props.Mode ?? "0") as GameMode,
            ar: Number.isFinite(ar) && ar >= 0 ? ar : od,
            cs: parseFloat(props.CircleSize ?? "5"),
            od,
            hp: parseFloat(props.HPDrainRate ?? "5")
        };
    }
}

export const extract_preview_time = (content: string | Uint8Array): number => {
    assert_wasm_ready();
    const data = to_data(content);
    const value = wasm_get_property(data, "PreviewTime");
    const num = parseInt(value);
    return Number.isFinite(num) ? num : -1;
};

export const extract_audio_filename = (content: string | Uint8Array): string | null => {
    assert_wasm_ready();
    const data = to_data(content);
    const value = wasm_get_property(data, "AudioFilename");
    return value ? value : null;
};

export const extract_background_filename = (content: string | Uint8Array): string | null => {
    assert_wasm_ready();
    const data = to_data(content);
    const value = wasm_get_property(data, "Background");
    return value ? value : null;
};

export const extract_video_info = (content: string | Uint8Array): { filename: string; offset: number } | null => {
    assert_wasm_ready();
    const data = to_data(content);
    const events = wasm_get_section(data, "Events");
    return parse_video_info(events);
};

export const get_wasm_ready = (): boolean => is_wasm_ready();
