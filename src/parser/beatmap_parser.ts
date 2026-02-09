import type { IBeatmap, IHitObject, ICircleData, ISliderData, ISpinnerData, IHoldData, SliderPathType, IBeatmapInfo } from "../types/beatmap";
import { GameMode, HitObjectType, SampleSet } from "../types/beatmap";
import {
    init_wasm_from_url,
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
const get_default_wasm_url = (): string => {
    try {
        return new URL("./browser/osu-parser.browser.js", import.meta.url).toString();
    } catch {
        if (typeof window !== "undefined") {
            return new URL("/browser/osu-parser.browser.js", window.location.origin).toString();
        }
    }
    return "./browser/osu-parser.browser.js";
};

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
    const script_url = options.script_url ?? get_default_wasm_url();
    wasm_init_promise = init_wasm_from_url(script_url, options.module_config ?? {}, options.global_name);

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

const parse_hit_sample = (sample: { normalSet: number; additionSet: number; index: number; volume: number; filename: string }) => {
    return {
        normal_set: sample.normalSet as SampleSet,
        addition_set: sample.additionSet as SampleSet,
        index: sample.index,
        volume: sample.volume,
        filename: sample.filename || undefined
    };
};

const build_timing_points = (file: OsuFileFormat) => {
    const result = [] as IBeatmap["timing_points"];
    const timing_points = [...file.TimingPoints].sort((a, b) => {
        if (a.time !== b.time) return a.time - b.time;
        return b.uninherited - a.uninherited;
    });
    let current_beat_length = 500;
    const first_red = timing_points.find((tp) => tp.uninherited === 1 && tp.beatLength > 0);
    if (first_red && first_red.beatLength > 0) {
        current_beat_length = first_red.beatLength;
    }

    for (const tp of timing_points) {
        const ms_per_beat = tp.beatLength;
        const is_inherited = tp.uninherited === 0 || ms_per_beat < 0;

        if (!is_inherited && ms_per_beat > 0) {
            current_beat_length = ms_per_beat;
        }

        result.push({
            time: tp.time,
            ms_per_beat,
            change: !is_inherited,
            sample_set: tp.sampleSet as SampleSet,
            sample_index: tp.sampleIndex,
            volume: tp.volume,
            kiai: (tp.effects & 1) !== 0,
            velocity: is_inherited ? -100 / ms_per_beat : 1.0,
            beat_length: current_beat_length
        });
    }

    return result;
};

const build_hit_objects = (file: OsuFileFormat): IHitObject[] => {
    const objects: IHitObject[] = [];

    for (const ho of file.HitObjects) {
        const obj: IHitObject = {
            time: ho.time,
            type: ho.type,
            hit_sound: ho.hitSound,
            end_time: ho.endTime || ho.time,
            end_pos: [ho.x, ho.y],
            combo_number: 0,
            combo_count: 0,
            data: { pos: [ho.x, ho.y] } as ICircleData
        };

        if (ho.hitSample) {
            obj.hit_sample = parse_hit_sample(ho.hitSample);
        }

        if (ho.edgeSounds?.length) {
            obj.edge_sounds = [...ho.edgeSounds];
        }

        if (ho.edgeSets?.length) {
            obj.edge_sets = ho.edgeSets.map((set) => [set.normalSet as SampleSet, set.additionSet as SampleSet]);
        }

        if (ho.type & HitObjectType.Circle) {
            obj.data = { pos: [ho.x, ho.y] } as ICircleData;
        } else if (ho.type & HitObjectType.Slider) {
            const slider_data: ISliderData = {
                pos: [ho.x, ho.y],
                path_type: (ho.curveType || "L") as SliderPathType,
                control_points: ho.curvePoints.map((p) => [p.x, p.y] as [number, number]),
                repetitions: ho.slides || 1,
                distance: ho.length || 0
            };

            obj.data = slider_data;
        } else if (ho.type & HitObjectType.Spinner) {
            const end_time = ho.endTime || ho.time;
            obj.data = { end_time } as ISpinnerData;
            obj.end_time = end_time;
            obj.end_pos = [256, 192];
        } else if (ho.type & HitObjectType.Hold) {
            const end_time = ho.endTime || ho.time;
            obj.data = { pos: [ho.x, ho.y], end_time } as IHoldData;
            obj.end_time = end_time;
        }

        objects.push(obj);
    }

    return objects;
};

const build_beatmap = (file: OsuFileFormat): IBeatmap => {
    const beatmap: IBeatmap = {
        format_version: file.version,
        mode: file.General.Mode as GameMode,
        title: file.Metadata.Title,
        title_unicode: file.Metadata.TitleUnicode,
        artist: file.Metadata.Artist,
        artist_unicode: file.Metadata.ArtistUnicode,
        creator: file.Metadata.Creator,
        version: file.Metadata.Version,
        ar: file.Difficulty.ApproachRate,
        cs: file.Difficulty.CircleSize,
        od: file.Difficulty.OverallDifficulty,
        hp: file.Difficulty.HPDrainRate,
        sv: file.Difficulty.SliderMultiplier,
        tick_rate: file.Difficulty.SliderTickRate,
        timing_points: [],
        objects: [],
        circle_count: 0,
        slider_count: 0,
        spinner_count: 0,
        hold_count: 0
    };

    beatmap.timing_points = build_timing_points(file);
    beatmap.objects = build_hit_objects(file);

    for (const obj of beatmap.objects) {
        if (obj.type & HitObjectType.Circle) beatmap.circle_count++;
        else if (obj.type & HitObjectType.Slider) beatmap.slider_count++;
        else if (obj.type & HitObjectType.Spinner) beatmap.spinner_count++;
        else if (obj.type & HitObjectType.Hold) beatmap.hold_count++;
    }

    if (beatmap.ar === -1) {
        beatmap.ar = beatmap.od;
    }

    return beatmap;
};

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
        const file = wasm_parse(data);
        return build_beatmap(file);
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
