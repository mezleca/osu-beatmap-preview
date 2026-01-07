import type { IBeatmap, IBeatmapInfo } from "../types/beatmap";
import { BeatmapParser, extract_audio_filename, extract_background_filename, extract_video_info, extract_preview_time } from "./beatmap_parser";

const parser = new BeatmapParser();

const defer = <T>(fn: () => T): Promise<T> => {
    return new Promise((resolve, reject) => {
        queueMicrotask(() => {
            try {
                resolve(fn());
            } catch (e) {
                reject(e);
            }
        });
    });
};

export class AsyncBeatmapParser {
    parse(content: string): Promise<IBeatmap> {
        return defer(() => parser.parse(content));
    }

    parse_info(content: string, filename: string): Promise<IBeatmapInfo> {
        return defer(() => parser.parse_info(content, filename));
    }

    extract_audio_filename(content: string): Promise<string | null> {
        return defer(() => extract_audio_filename(content));
    }

    extract_background_filename(content: string): Promise<string | null> {
        return defer(() => extract_background_filename(content));
    }

    extract_video_info(content: string): Promise<{ filename: string; offset: number } | null> {
        return defer(() => extract_video_info(content));
    }

    extract_preview_time(content: string): Promise<number> {
        return defer(() => extract_preview_time(content));
    }

    dispose(): void {
        // no-op for sync implementation
    }
}

let shared_parser: AsyncBeatmapParser | null = null;

export const get_shared_parser = (): AsyncBeatmapParser => {
    if (!shared_parser) {
        shared_parser = new AsyncBeatmapParser();
    }
    return shared_parser;
};
