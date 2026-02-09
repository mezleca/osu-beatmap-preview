import type { IBeatmapResources } from "../types/resources";

type ResolvedAssets = {
    audio?: ArrayBuffer;
    background?: Blob;
    video?: Blob;
    video_offset?: number;
};

export class BeatmapAssets {
    private files: Map<string, ArrayBuffer>;
    private audio_filename?: string;
    private background_filename?: string;
    private video_filename?: string;
    private video_offset?: number;

    constructor(resources: IBeatmapResources) {
        this.files = resources.files;
        this.audio_filename = resources.audio_filename;
        this.background_filename = resources.background_filename;
        this.video_filename = resources.video_filename;
        this.video_offset = resources.video_offset;
    }

    resolve(): ResolvedAssets {
        const audio = this.audio_filename ? this.find_file(this.audio_filename) : undefined;
        const background_data = this.background_filename ? this.find_file(this.background_filename) : undefined;
        const video_data = this.video_filename ? this.find_file(this.video_filename) : undefined;

        return {
            audio,
            background: background_data ? new Blob([background_data]) : undefined,
            video: video_data ? new Blob([video_data]) : undefined,
            video_offset: this.video_offset
        };
    }

    private find_file(filename: string): ArrayBuffer | undefined {
        if (this.files.has(filename)) {
            return this.files.get(filename);
        }

        const lower = filename.toLowerCase();
        for (const [name, data] of this.files) {
            if (name.toLowerCase() === lower) {
                return data;
            }
        }

        return undefined;
    }
}
