import JSZip from "jszip";
import type { IBeatmap } from "../types/beatmap";
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

        // extract all files into memory
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
                const content = this.to_string(files.get(file)!);
                return this.parser.parse_info(content, file);
            })
        );

        // select difficulty
        const selected_file = this.select_difficulty(osu_files, files, options?.difficulty);
        const osu_content = this.to_string(files.get(selected_file)!);

        // parse full beatmap (async via worker)
        const beatmap = await this.parser.parse(osu_content);

        // extract resource info (async via worker)
        const [audio_filename, background_filename, video_info] = await Promise.all([
            this.parser.extract_audio_filename(osu_content),
            this.parser.extract_background_filename(osu_content),
            this.parser.extract_video_info(osu_content)
        ]);

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
        let video_offset: number | undefined;
        if (video_info) {
            const video_data = this.find_file(array_buffer_files, video_info.filename);
            if (video_data) {
                video = new Blob([video_data]);
                video_offset = video_info.offset;
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
            video_filename: video_info?.filename,
            video_offset
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

    private select_difficulty(osu_files: string[], files: Map<string, ArrayBuffer | string>, selector?: number | string): string {
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
        for (const file of osu_files) {
            const content = this.to_string(files.get(file)!);
            const version_match = content.match(/Version:\s*(.+)/);
            if (version_match && version_match[1].trim() === selector) {
                return file;
            }
        }

        // fallback: partial match
        for (const file of osu_files) {
            if (file.toLowerCase().includes(selector.toLowerCase())) {
                return file;
            }
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

    private to_string(data: ArrayBuffer | string): string {
        if (typeof data === "string") return data;
        return new TextDecoder().decode(data);
    }
}
