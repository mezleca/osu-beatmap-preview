import type { IBeatmap, IBeatmapInfo } from "../types/beatmap";
import {
    BeatmapParser,
    extract_audio_filename,
    extract_background_filename,
    extract_video_info,
    extract_preview_time,
    init_wasm_parser
} from "./beatmap_parser";

const parser = new BeatmapParser();

export class AsyncBeatmapParser {
    private init_promise: Promise<void> | null = null;

    private ensure_ready(): Promise<void> {
        if (!this.init_promise) {
            this.init_promise = init_wasm_parser();
        }
        return this.init_promise;
    }

    async parse(content: string | Uint8Array): Promise<IBeatmap> {
        await this.ensure_ready();
        return parser.parse(content);
    }

    async parse_info(content: string | Uint8Array, filename: string): Promise<IBeatmapInfo> {
        await this.ensure_ready();
        return parser.parse_info(content, filename);
    }

    async extract_audio_filename(content: string | Uint8Array): Promise<string | null> {
        await this.ensure_ready();
        return extract_audio_filename(content);
    }

    async extract_background_filename(content: string | Uint8Array): Promise<string | null> {
        await this.ensure_ready();
        return extract_background_filename(content);
    }

    async extract_video_info(content: string | Uint8Array): Promise<{ filename: string; offset: number } | null> {
        await this.ensure_ready();
        return extract_video_info(content);
    }

    async extract_preview_time(content: string | Uint8Array): Promise<number> {
        await this.ensure_ready();
        return extract_preview_time(content);
    }

    dispose(): void {
        this.init_promise = null;
    }
}

let shared_parser: AsyncBeatmapParser | null = null;

export const get_shared_parser = (): AsyncBeatmapParser => {
    if (!shared_parser) {
        shared_parser = new AsyncBeatmapParser();
    }
    return shared_parser;
};
