import type { IBeatmap } from "./beatmap";

export interface IBeatmapResources {
    beatmap: IBeatmap;
    available_difficulties: { filename: string; beatmap: IBeatmap }[];
    files: Map<string, ArrayBuffer>;

    audio?: ArrayBuffer;
    background?: Blob;
    video?: Blob;

    audio_filename?: string;
    background_filename?: string;
    video_filename?: string;
    video_offset?: number;
}
