import type { IBeatmap, IHitObject, ICircleData, ISliderData, ISpinnerData, IHoldData, SliderPathType, IBeatmapInfo } from "../types/beatmap";
import { GameMode, HitObjectType } from "../types/beatmap";

export class BeatmapParser {
    private beatmap!: IBeatmap;
    private section: string = "";

    parse(content: string): IBeatmap {
        this.beatmap = this.create_empty_beatmap();
        this.section = "";

        const lines = content.split("\n");

        for (const line of lines) {
            this.parse_line(line);
        }

        // fallback: old maps have no AR, use OD
        if (this.beatmap.ar === -1) {
            this.beatmap.ar = this.beatmap.od;
        }

        return this.beatmap;
    }

    parse_info(content: string, filename: string): IBeatmapInfo {
        this.beatmap = this.create_empty_beatmap();
        this.section = "";

        const lines = content.split("\n");

        for (const line of lines) {
            this.parse_line(line);
            // stop after difficulty section to save time
            if (this.section === "Events" || this.section === "TimingPoints" || this.section === "Colours" || this.section === "HitObjects") {
                break;
            }
        }

        if (this.beatmap.ar === -1) {
            this.beatmap.ar = this.beatmap.od;
        }

        return {
            filename,
            title: this.beatmap.title,
            artist: this.beatmap.artist,
            version: this.beatmap.version,
            mode: this.beatmap.mode,
            ar: this.beatmap.ar,
            cs: this.beatmap.cs,
            od: this.beatmap.od,
            hp: this.beatmap.hp
        };
    }

    private create_empty_beatmap(): IBeatmap {
        return {
            format_version: 1,
            mode: GameMode.Standard,
            title: "",
            title_unicode: "",
            artist: "",
            artist_unicode: "",
            creator: "",
            version: "",
            ar: -1,
            cs: 5,
            od: 5,
            hp: 5,
            sv: 1,
            tick_rate: 1,
            timing_points: [],
            objects: [],
            circle_count: 0,
            slider_count: 0,
            spinner_count: 0,
            hold_count: 0
        };
    }

    private parse_line(raw_line: string): void {
        if (raw_line.startsWith(" ") || raw_line.startsWith("_")) return;

        const line = raw_line.trim();
        if (line.length === 0 || line.startsWith("//")) return;

        if (line.startsWith("[") && line.endsWith("]")) {
            this.section = line.slice(1, -1);
            return;
        }

        const format_match = line.match(/osu file format v(\d+)/);
        if (format_match) {
            this.beatmap.format_version = parseInt(format_match[1]);
            return;
        }

        switch (this.section) {
            case "General":
                this.parse_general(line);
                break;
            case "Metadata":
                this.parse_metadata(line);
                break;
            case "Difficulty":
                this.parse_difficulty(line);
                break;
            case "TimingPoints":
                this.parse_timing_point(line);
                break;
            case "HitObjects":
                this.parse_hit_object(line);
                break;
        }
    }

    private parse_general(line: string): void {
        const [key, value] = this.split_property(line);
        if (key === "Mode") this.beatmap.mode = parseInt(value) as GameMode;
    }

    private parse_metadata(line: string): void {
        const [key, value] = this.split_property(line);
        switch (key) {
            case "Title":
                this.beatmap.title = value;
                break;
            case "TitleUnicode":
                this.beatmap.title_unicode = value;
                break;
            case "Artist":
                this.beatmap.artist = value;
                break;
            case "ArtistUnicode":
                this.beatmap.artist_unicode = value;
                break;
            case "Creator":
                this.beatmap.creator = value;
                break;
            case "Version":
                this.beatmap.version = value;
                break;
        }
    }

    private parse_difficulty(line: string): void {
        const [key, value] = this.split_property(line);
        const num = parseFloat(value);
        switch (key) {
            case "CircleSize":
                this.beatmap.cs = num;
                break;
            case "OverallDifficulty":
                this.beatmap.od = num;
                break;
            case "ApproachRate":
                this.beatmap.ar = num;
                break;
            case "HPDrainRate":
                this.beatmap.hp = num;
                break;
            case "SliderMultiplier":
                this.beatmap.sv = num;
                break;
            case "SliderTickRate":
                this.beatmap.tick_rate = num;
                break;
        }
    }

    private current_beat_length: number = 500;

    private parse_timing_point(line: string): void {
        const parts = line.split(",");
        if (parts.length < 2) return;

        const time = parseFloat(parts[0]);
        const ms_per_beat = parseFloat(parts[1]);
        const sample_set = parseInt(parts[3] ?? "0");
        const sample_index = parseInt(parts[4] ?? "0");
        const volume = parseInt(parts[5] ?? "100");
        const change = parts.length >= 7 ? parts[6].trim() !== "0" : true;
        const kiai = parts.length >= 8 ? (parseInt(parts[7]) & 1) !== 0 : false;

        // inherited points have negative ms_per_beat
        const is_inherited = ms_per_beat < 0;
        const velocity = is_inherited ? -100 / ms_per_beat : 1.0;

        // beat_length comes from uninherited (red) points only
        if (!is_inherited && ms_per_beat > 0) {
            this.current_beat_length = ms_per_beat;
        }

        this.beatmap.timing_points.push({
            time,
            ms_per_beat,
            change,
            sample_set,
            sample_index,
            volume,
            kiai,
            velocity,
            beat_length: this.current_beat_length
        });
    }

    private parse_hit_object(line: string): void {
        const parts = line.split(",");
        if (parts.length < 4) return;

        const x = parseFloat(parts[0]);
        const y = parseFloat(parts[1]);
        const time = parseFloat(parts[2]);
        const type = parseInt(parts[3]);
        const hit_sound = parseInt(parts[4] ?? "0");

        const obj: IHitObject = {
            time,
            type,
            hit_sound,
            end_time: time,
            end_pos: [x, y],
            combo_number: 0,
            combo_count: 0,
            data: { pos: [x, y] } as ICircleData
        };

        if (type & HitObjectType.Circle) {
            this.beatmap.circle_count++;
            obj.data = { pos: [x, y] } as ICircleData;
            this.parse_extras(parts, 5, obj);
        } else if (type & HitObjectType.Slider) {
            if (parts.length < 8) return;
            this.beatmap.slider_count++;
            const slider_data = this.parse_slider_data(parts, x, y);
            obj.data = slider_data;

            // sliders have variable length fields (edgeSounds, edgeSets) before hitSample
            // usually: curve, slides, length, edgeSounds, edgeSets, hitSample
            // hitSample is strictly the last part if present

            // edgeSounds
            if (parts.length > 8) {
                obj.edge_sounds = parts[8].split("|").map((s) => parseInt(s));
            }

            // edgeSets
            if (parts.length > 9) {
                obj.edge_sets = parts[9].split("|").map((s) => {
                    const sets = s.split(":");
                    return [parseInt(sets[0]), parseInt(sets[1])];
                });
            }

            this.parse_extras(parts, 10, obj);
        } else if (type & HitObjectType.Spinner) {
            this.beatmap.spinner_count++;
            const end_time = parseInt(parts[5]);
            obj.data = { end_time } as ISpinnerData;
            obj.end_time = end_time;
            obj.end_pos = [256, 192];
            this.parse_extras(parts, 6, obj);
        } else if (type & HitObjectType.Hold) {
            this.beatmap.hold_count++;
            const end_time = parseInt(parts[5].split(":")[0]);
            obj.data = { pos: [x, y], end_time } as IHoldData;
            obj.end_time = end_time;
            this.parse_extras(parts, 6, obj);
        }

        this.beatmap.objects.push(obj);
    }

    private parse_extras(parts: string[], index: number, obj: IHitObject): void {
        if (index < parts.length) {
            const sample_str = parts[index];
            if (sample_str && sample_str.includes(":")) {
                const sample_parts = sample_str.split(":");
                obj.hit_sample = {
                    normal_set: parseInt(sample_parts[0]),
                    addition_set: parseInt(sample_parts[1]),
                    index: parseInt(sample_parts[2]),
                    volume: parseInt(sample_parts[3]),
                    filename: sample_parts[4] || undefined
                };
            }
        }
    }

    private parse_slider_data(parts: string[], x: number, y: number): ISliderData {
        const curve_data = parts[5].split("|");
        const path_type = curve_data[0] as SliderPathType;

        const control_points: [number, number][] = [];
        for (let i = 1; i < curve_data.length; i++) {
            const point = curve_data[i].split(":");
            control_points.push([parseInt(point[0]), parseInt(point[1])]);
        }

        const repetitions = parseInt(parts[6]);
        const distance = parseFloat(parts[7]);

        return {
            pos: [x, y],
            path_type,
            control_points,
            repetitions,
            distance
        };
    }

    private split_property(line: string): [string, string] {
        const idx = line.indexOf(":");
        if (idx === -1) return [line, ""];
        return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    }
}

const HEADER_LIMIT = 4096;

export const extract_preview_time = (content: string): number => {
    const match = content.slice(0, HEADER_LIMIT).match(/PreviewTime:\s*([+-]?\d+)/);
    return match ? parseInt(match[1]) : -1;
};

export const extract_audio_filename = (content: string): string | null => {
    const match = content.slice(0, HEADER_LIMIT).match(/AudioFilename:\s*(.+)/);
    return match ? match[1].trim() : null;
};

export const extract_background_filename = (content: string): string | null => {
    const match = content.slice(0, HEADER_LIMIT).match(/0,0,"([^"]+)"/);
    return match ? match[1] : null;
};

export const extract_video_info = (content: string): { filename: string; offset: number } | null => {
    const match = content.slice(0, HEADER_LIMIT).match(/(?:Video|1),(-?\d+),"([^"]+)"/);
    if (!match) return null;
    return { offset: parseInt(match[1]), filename: match[2] };
};
