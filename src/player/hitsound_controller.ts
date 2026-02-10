import { SampleSet, HitSoundType } from "../types/beatmap";

export class HitsoundController {
    private context: AudioContext;
    private gain_node: GainNode;
    private samples: Map<string, AudioBuffer> = new Map();
    private volume: number = 1;

    constructor(context: AudioContext) {
        this.context = context;
        this.gain_node = context.createGain();
        this.gain_node.connect(context.destination);
    }

    set_volume(volume: number): void {
        this.volume = Math.max(0, Math.min(1, volume));
        this.gain_node.gain.value = this.volume;
    }

    async load_samples(files: Map<string, ArrayBuffer>): Promise<void> {
        this.samples.clear();

        const decode_promises: Promise<void>[] = [];
        const failed: string[] = [];

        for (const [name, buffer] of files) {
            if (name.endsWith(".wav") || name.endsWith(".mp3") || name.endsWith(".ogg")) {
                if (buffer.byteLength < 128) {
                    continue;
                }
                decode_promises.push(
                    this.context
                        .decodeAudioData(buffer.slice(0))
                        .then((audio_buffer) => {
                            const key = name.toLowerCase().replace(/\.(wav|mp3|ogg)$/, "");
                            this.samples.set(key, audio_buffer);
                        })
                        .catch((err) => {
                            failed.push(name);
                        })
                );
            }
        }

        await Promise.all(decode_promises);

        if (failed.length > 0) {
            console.warn(`[HitsoundController] Failed to decode ${failed.length} hitsounds`);
        }
    }

    clear(): void {
        this.samples.clear();
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
        const buffer = this.samples.get(key);
        if (!buffer) return false;

        const source = this.context.createBufferSource();
        source.buffer = buffer;

        const gain = this.context.createGain();
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

    dispose(): void {
        this.samples.clear();
        this.gain_node.disconnect();
    }
}
