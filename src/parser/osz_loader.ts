import JSZip from "jszip";
import type { IBeatmap, IBeatmapInfo } from "../types/beatmap";
import type { IBeatmapResources } from "../types/resources";
import { AsyncBeatmapParser } from "./async_parser";

export interface IOszLoaderOptions {
    // select difficulty by index or version name
    difficulty?: number | string;
}

export class OszLoader {
    private parser = new AsyncBeatmapParser();

    // load from .osz archive (ArrayBuffer)
    async load_osz(data: ArrayBuffer, options?: IOszLoaderOptions): Promise<IBeatmapResources> {
        const zip = await JSZip.loadAsync(data);
        const files = new Map<string, ArrayBuffer>();

        for (const [name, file] of Object.entries(zip.files)) {
            if (!file.dir) {
                files.set(name, await file.async("arraybuffer"));
            }
        }

        return this.load_from_files(files, options);
    }

    // load from pre-extracted files (for direct file access without .osz)
    async load_from_files(files: Map<string, ArrayBuffer | string>, options?: IOszLoaderOptions): Promise<IBeatmapResources> {
        // find all .osu files
        const osu_files = [...files.keys()].filter((f) => f.toLowerCase().endsWith(".osu"));

        if (osu_files.length === 0) {
            throw new Error("No .osu files found in beatmap");
        }

        // list all difficulties (async via worker)
        const available_difficulties = await Promise.all(
            osu_files.map(async (file) => {
                const content = files.get(file)!;
                const data = this.to_bytes(content);
                return this.parser.parse_info(data, file);
            })
        );

        // select difficulty
        const selected_file = this.select_difficulty(osu_files, available_difficulties, options?.difficulty);
        const osu_content = files.get(selected_file)!;
        const osu_bytes = this.to_bytes(osu_content);

        // parse full beatmap (async via worker)
        const beatmap = await this.parser.parse(osu_bytes);

        const audio_filename = beatmap.General.AudioFilename || null;
        const background_filename = beatmap.Events.background?.filename || null;
        const video_filename = beatmap.Events.video?.filename || null;
        const video_offset = beatmap.Events.video?.startTime ?? 0;

        // convert files map to ArrayBuffer only
        const array_buffer_files = new Map<string, ArrayBuffer>();
        for (const [name, content] of files) {
            if (content instanceof ArrayBuffer) {
                array_buffer_files.set(name, content);
            } else {
                array_buffer_files.set(name, new TextEncoder().encode(content).buffer as ArrayBuffer);
            }
        }

        // extract audio
        let audio: ArrayBuffer | undefined;
        if (audio_filename) {
            audio = this.find_file(array_buffer_files, audio_filename);
        }

        // extract background
        let background: Blob | undefined;
        if (background_filename) {
            const bg_data = this.find_file(array_buffer_files, background_filename);
            if (bg_data) {
                background = new Blob([bg_data]);
            }
        }

        // extract video
        let video: Blob | undefined;
        if (video_filename) {
            const video_data = this.find_file(array_buffer_files, video_filename);
            if (video_data) {
                video = new Blob([video_data]);
            }
        }

        return {
            beatmap,
            available_difficulties,
            files: array_buffer_files,
            audio,
            background,
            video,
            audio_filename: audio_filename ?? undefined,
            background_filename: background_filename ?? undefined,
            video_filename: video_filename ?? undefined,
            video_offset: video_filename ? video_offset : undefined
        };
    }

    // list available difficulties in a beatmap set
    async list_difficulties(data: ArrayBuffer): Promise<string[]> {
        const zip = await JSZip.loadAsync(data);
        const osu_files: string[] = [];

        for (const name of Object.keys(zip.files)) {
            if (name.toLowerCase().endsWith(".osu")) {
                osu_files.push(name);
            }
        }

        const difficulties: string[] = [];

        for (const file of osu_files) {
            const content = await zip.files[file].async("string");
            const version_match = content.match(/Version:\s*(.+)/);
            difficulties.push(version_match ? version_match[1].trim() : file);
        }

        return difficulties;
    }

    private select_difficulty(osu_files: string[], difficulties: IBeatmapInfo[], selector?: number | string): string {
        // no selector: use first file
        if (selector === undefined) {
            return osu_files[0];
        }

        // number: select by index
        if (typeof selector === "number") {
            if (selector < 0 || selector >= osu_files.length) {
                throw new Error(`Difficulty index ${selector} out of range (0-${osu_files.length - 1})`);
            }
            return osu_files[selector];
        }

        // string: search by version name
        const exact_match = difficulties.find((diff) => diff.version === selector);
        if (exact_match) {
            return exact_match.filename;
        }

        // fallback: partial match against filename or version
        const lower_selector = selector.toLowerCase();
        const partial_match = difficulties.find(
            (diff) => diff.filename.toLowerCase().includes(lower_selector) || diff.version.toLowerCase().includes(lower_selector)
        );
        if (partial_match) {
            return partial_match.filename;
        }

        throw new Error(`Difficulty "${selector}" not found`);
    }

    private find_file(files: Map<string, ArrayBuffer>, filename: string): ArrayBuffer | undefined {
        // exact match
        if (files.has(filename)) {
            return files.get(filename);
        }

        // case-insensitive search
        const lower = filename.toLowerCase();
        for (const [name, data] of files) {
            if (name.toLowerCase() === lower) {
                return data;
            }
        }

        return undefined;
    }

    private to_bytes(data: ArrayBuffer | string): Uint8Array {
        if (data instanceof ArrayBuffer) return new Uint8Array(data);
        return new TextEncoder().encode(data);
    }
}
