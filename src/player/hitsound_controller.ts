import { SampleSet, HitSoundType } from "../types/beatmap";
import { AudioNodeController } from "./audio_node_controller";

export class HitsoundController extends AudioNodeController {
    private static default_samples: Map<string, AudioBuffer> = new Map();
    private static default_loads: Map<string, Promise<void>> = new Map();
    private custom_samples: Map<string, AudioBuffer> = new Map();

    constructor(context: AudioContext) {
        super(context);
    }

    async load_samples(urls: string[]): Promise<void> {
        this.custom_samples.clear();
        await this.load_into_cache(urls, this.custom_samples, false);
    }

    async load_samples_from_files(files: Map<string, ArrayBuffer>): Promise<void> {
        this.custom_samples.clear();
        await this.load_files_into_cache(files, this.custom_samples);
    }

    async load_default_samples(urls: string[]): Promise<void> {
        await this.load_into_cache(urls, HitsoundController.default_samples, true);
    }

    clear(): void {
        this.custom_samples.clear();
    }

    play(
        normal_set: SampleSet,
        addition_set: SampleSet,
        hit_sound: number,
        index: number,
        volume: number = 100,
        custom_filename?: string,
        when: number = 0
    ): void {
        const normal_name = this.get_set_name(normal_set);
        const addition_name = this.get_set_name(addition_set);

        if (custom_filename) {
            const key = custom_filename.toLowerCase().replace(/\.(wav|mp3|ogg)$/, "");
            if (this.play_buffer(key, volume, when)) return;
        }

        this.play_sound(normal_name, "hitnormal", index, volume, when);

        if (hit_sound & HitSoundType.Whistle) {
            this.play_sound(addition_name, "hitwhistle", index, volume, when);
        }
        if (hit_sound & HitSoundType.Finish) {
            this.play_sound(addition_name, "hitfinish", index, volume, when);
        }
        if (hit_sound & HitSoundType.Clap) {
            this.play_sound(addition_name, "hitclap", index, volume, when);
        }
    }

    play_sample(set: SampleSet, sample_name: string, index: number, volume: number = 100, when: number = 0): void {
        const set_name = this.get_set_name(set);
        this.play_sound(set_name, sample_name, index, volume, when);
    }

    private play_sound(set: string, type: string, index: number, volume: number, when: number): void {
        let played = false;

        if (index > 1) {
            played = this.play_buffer(`${set}-${type}${index}`, volume, when);
        }

        if (!played) {
            this.play_buffer(`${set}-${type}`, volume, when);
        }
    }

    private play_buffer(key: string, volume: number, when: number): boolean {
        const buffer = this.custom_samples.get(key) ?? HitsoundController.default_samples.get(key);
        if (!buffer) return false;

        const source = this.audio_context.createBufferSource();
        source.buffer = buffer;

        const gain = this.audio_context.createGain();
        gain.gain.value = volume / 100;

        source.connect(gain);
        gain.connect(this.gain_node);

        source.start(when);
        return true;
    }

    private get_set_name(set: SampleSet): string {
        switch (set) {
            case SampleSet.Drum:
                return "drum";
            case SampleSet.Soft:
                return "soft";
            default:
                return "normal";
        }
    }

    private get_sample_key_from_url(url: string): string | null {
        const clean_url = url.split("?")[0].split("#")[0];
        const file_name = clean_url.split("/").pop();
        if (!file_name) {
            return null;
        }
        if (!file_name.endsWith(".wav") && !file_name.endsWith(".mp3") && !file_name.endsWith(".ogg")) {
            return null;
        }
        return file_name.toLowerCase().replace(/\.(wav|mp3|ogg)$/, "");
    }

    private async load_into_cache(urls: string[], target: Map<string, AudioBuffer>, use_shared_loads: boolean): Promise<void> {
        if (urls.length == 0) {
            return;
        }

        const failed: string[] = [];
        const load_tasks = urls.map(async (url) => {
            const key = this.get_sample_key_from_url(url);
            if (!key) {
                failed.push(url);
                return;
            }

            if (target.has(key)) {
                return;
            }

            if (!use_shared_loads) {
                await this.load_single_sample(url, key, target, failed);
                return;
            }

            const pending = HitsoundController.default_loads.get(key);
            if (pending) {
                await pending;
                return;
            }

            const task = this.load_single_sample(url, key, target, failed).finally(() => {
                HitsoundController.default_loads.delete(key);
            });
            HitsoundController.default_loads.set(key, task);
            await task;
        });

        await Promise.all(load_tasks);

        if (failed.length > 0) {
            console.warn(`[HitsoundController] Failed to load ${failed.length} hitsounds`);
        }
    }

    private async load_single_sample(
        url: string,
        key: string,
        target: Map<string, AudioBuffer>,
        failed: string[]
    ): Promise<void> {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                failed.push(url);
                return;
            }

            const data = await response.arrayBuffer();
            if (data.byteLength < 128) {
                failed.push(url);
                return;
            }

            const audio_buffer = await this.audio_context.decodeAudioData(data.slice(0));
            target.set(key, audio_buffer);
        } catch {
            failed.push(url);
        }
    }

    private async load_files_into_cache(files: Map<string, ArrayBuffer>, target: Map<string, AudioBuffer>): Promise<void> {
        if (files.size == 0) {
            return;
        }

        const failed: string[] = [];
        const load_tasks = [...files.entries()].map(async ([name, data]) => {
            const key = this.get_sample_key_from_url(name);
            if (!key) {
                return;
            }

            if (target.has(key)) {
                return;
            }

            if (data.byteLength < 128) {
                failed.push(name);
                return;
            }

            try {
                const audio_buffer = await this.audio_context.decodeAudioData(data.slice(0));
                target.set(key, audio_buffer);
            } catch {
                failed.push(name);
            }
        });

        await Promise.all(load_tasks);

        if (failed.length > 0) {
            console.warn(`[HitsoundController] Failed to load ${failed.length} hitsounds`);
        }
    }

    dispose(): void {
        this.custom_samples.clear();
        this.dispose_audio_node();
    }
}
