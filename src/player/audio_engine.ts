import { clamp } from "@/math/vector2";
import { SampleSet, HitSoundType } from "../types/beatmap";

type HitsoundKey = string;

class MusicPlayer {
    private static readonly PRECISE_BUFFER_MAX_BYTES = 8 * 1024 * 1024;

    private audio_context: AudioContext;
    private gain_node: GainNode;
    private preserve_pitch = false;

    private use_precise_buffer = false;
    private decoded_buffer: AudioBuffer | null = null;
    private buffer_source: AudioBufferSourceNode | null = null;

    private media_element: HTMLAudioElement | null = null;
    private media_source: MediaElementAudioSourceNode | null = null;
    private media_url: string | null = null;

    private _is_playing = false;
    private _is_loaded = false;
    private _duration = 0;
    private pause_time = 0;
    private rate = 1;
    private started_at_context_time = 0;
    private started_from_time = 0;

    constructor(context: AudioContext) {
        this.audio_context = context;
        this.gain_node = this.audio_context.createGain();
        this.gain_node.connect(this.audio_context.destination);
    }

    get is_playing(): boolean {
        return this._is_playing;
    }

    get is_loaded(): boolean {
        return this._is_loaded;
    }

    get duration(): number {
        return this._duration;
    }

    get speed_multiplier(): number {
        return this.rate;
    }

    get current_time(): number {
        if (this.use_precise_buffer && this.decoded_buffer) {
            if (!this._is_playing) {
                return this.pause_time;
            }

            const elapsed_ms = (this.audio_context.currentTime - this.started_at_context_time) * 1000 * this.rate;
            const estimated = this.started_from_time + elapsed_ms;
            if (estimated >= this._duration) {
                return this._duration;
            }
            return Math.max(0, estimated);
        }

        if (!this.media_element) {
            return this.pause_time;
        }

        if (!this._is_playing) {
            return this.pause_time;
        }

        const media_time = Math.max(0, this.media_element.currentTime * 1000);
        if (Number.isFinite(media_time)) {
            if (media_time >= this._duration) {
                return this._duration;
            }
            return media_time;
        }

        const elapsed_ms = (this.audio_context.currentTime - this.started_at_context_time) * 1000 * this.rate;
        const estimated = this.started_from_time + elapsed_ms;
        if (estimated >= this._duration) {
            return this._duration;
        }

        return Math.max(0, estimated);
    }

    async load(data: ArrayBuffer, speed_multiplier: number = 1): Promise<void> {
        this.stop();
        this.release_media();
        this.release_precise_buffer();

        this.rate = Math.max(0.1, speed_multiplier);
        this.use_precise_buffer = false;

        await this.load_media_element(data);
        if (data.byteLength <= MusicPlayer.PRECISE_BUFFER_MAX_BYTES) {
            try {
                await this.load_precise_buffer(data);
            } catch {}
        }
        this.use_precise_buffer = !this.preserve_pitch && this.decoded_buffer !== null;

        this._is_loaded = true;
        this.pause_time = 0;
        this.started_at_context_time = 0;
        this.started_from_time = 0;
    }

    async play(from_time?: number): Promise<void> {
        if (!this.use_precise_buffer && !this.media_element) {
            console.warn("[AudioEngine] Cannot play: not loaded");
            return;
        }

        const start_time = from_time !== undefined ? from_time : this.pause_time;
        const clamped_start = Math.max(0, Math.min(start_time, this._duration));

        if (this.use_precise_buffer && this.decoded_buffer) {
            this.start_precise_playback(clamped_start);
            return;
        }

        const media = this.media_element;
        if (!media) {
            console.warn("[AudioEngine] Cannot play: media element unavailable");
            return;
        }

        media.currentTime = clamped_start / 1000;
        await this.wait_for_seek_settle(clamped_start);
        media.playbackRate = this.rate;
        this.pause_time = clamped_start;
        this.started_from_time = clamped_start;
        this.started_at_context_time = this.audio_context.currentTime;

        try {
            await media.play();
        } catch (error) {
            this._is_playing = false;
            throw error;
        }

        this._is_playing = true;
    }

    pause(): void {
        if (!this._is_playing) {
            return;
        }

        if (this.use_precise_buffer) {
            this.pause_time = this.current_time;
            this.stop_precise_playback(false);
            this._is_playing = false;
            return;
        }

        if (this.media_element) {
            this.media_element.pause();
            this.pause_time = Math.max(0, this.media_element.currentTime * 1000);
        }

        this._is_playing = false;
    }

    seek(time_ms: number): void {
        const clamped = Math.max(0, Math.min(time_ms, this._duration));
        this.pause_time = clamped;

        if (this.use_precise_buffer && this.decoded_buffer) {
            if (this._is_playing) {
                this.start_precise_playback(clamped);
            } else {
                this.started_from_time = clamped;
                this.started_at_context_time = this.audio_context.currentTime;
            }
            return;
        }

        if (this.media_element) {
            this.media_element.currentTime = clamped / 1000;
            void this.wait_for_seek_settle(clamped);
        }

        if (this._is_playing) {
            this.started_from_time = clamped;
            this.started_at_context_time = this.audio_context.currentTime;
        }
    }

    stop(): void {
        if (this.use_precise_buffer) {
            this.stop_precise_playback(false);
        }

        if (this.media_element) {
            this.media_element.pause();
            this.media_element.currentTime = 0;
        }

        this._is_playing = false;
        this.pause_time = 0;
        this.started_at_context_time = 0;
        this.started_from_time = 0;
    }

    get_host_time(time_ms: number): number {
        const delta_ms = time_ms - this.current_time;
        return this.audio_context.currentTime + delta_ms / 1000 / this.rate;
    }

    set_rate(speed: number): void {
        const current = this.current_time;
        this.rate = Math.max(0.1, speed);

        if (this.use_precise_buffer && this._is_playing) {
            this.start_precise_playback(current);
        }

        if (this.media_element) {
            this.media_element.playbackRate = this.rate;
            (this.media_element as HTMLMediaElement & { preservesPitch?: boolean }).preservesPitch = this.preserve_pitch;
            (this.media_element as HTMLMediaElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = this.preserve_pitch;
        }

        this.started_from_time = current;
        this.started_at_context_time = this.audio_context.currentTime;
        this.pause_time = current;
    }

    set_volume(volume: number): void {
        this.gain_node.gain.value = clamp(volume, 0, 1);
        if (this.media_element) {
            this.media_element.volume = 1;
        }
    }

    async set_pitch_preserve(enabled: boolean): Promise<void> {
        if (this.preserve_pitch === enabled) {
            return;
        }

        const was_playing = this._is_playing;
        const current_time = this.current_time;
        this.preserve_pitch = enabled;

        if (this.media_element) {
            (this.media_element as HTMLMediaElement & { preservesPitch?: boolean }).preservesPitch = enabled;
            (this.media_element as HTMLMediaElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = enabled;
        }

        const can_use_buffer = !enabled && this.decoded_buffer !== null;
        if (can_use_buffer === this.use_precise_buffer) {
            return;
        }

        this.pause();
        this.use_precise_buffer = can_use_buffer;
        if (was_playing) {
            await this.play(current_time);
        } else {
            this.seek(current_time);
        }
    }

    dispose(): void {
        this.stop();
        this.release_media();
        this.release_precise_buffer();
        this._is_loaded = false;
        this._duration = 0;
        this.pause_time = 0;
        this._is_playing = false;
        this.started_at_context_time = 0;
        this.started_from_time = 0;
        this.gain_node.disconnect();
    }

    private start_precise_playback(start_ms: number): void {
        if (!this.decoded_buffer) {
            return;
        }

        this.stop_precise_playback(false);

        const source = this.audio_context.createBufferSource();
        source.buffer = this.decoded_buffer;
        source.playbackRate.value = this.rate;
        source.connect(this.gain_node);
        source.onended = () => {
            if (this.buffer_source !== source) {
                return;
            }
            this.buffer_source = null;
            if (this._is_playing) {
                this._is_playing = false;
                this.pause_time = this._duration;
            }
        };

        source.start(0, Math.max(0, start_ms / 1000));

        this.buffer_source = source;
        this.pause_time = start_ms;
        this.started_from_time = start_ms;
        this.started_at_context_time = this.audio_context.currentTime;
        this._is_playing = true;
    }

    private stop_precise_playback(reset_pause: boolean): void {
        const source = this.buffer_source;
        if (!source) {
            if (reset_pause) {
                this.pause_time = 0;
            }
            return;
        }

        this.buffer_source = null;
        source.onended = null;
        try {
            source.stop();
        } catch {}
        source.disconnect();

        if (reset_pause) {
            this.pause_time = 0;
        }
    }

    private async load_precise_buffer(data: ArrayBuffer): Promise<void> {
        const copy = data.slice(0);
        const decoded = await this.audio_context.decodeAudioData(copy);
        this.decoded_buffer = decoded;
        this._duration = Math.max(0, decoded.duration * 1000);
    }

    private async load_media_element(data: ArrayBuffer): Promise<void> {
        this.release_media();

        const blob = new Blob([data]);
        const url = URL.createObjectURL(blob);
        const media = new Audio();
        media.preload = "metadata";
        media.src = url;
        media.playbackRate = this.rate;
        media.volume = 1;
        (media as HTMLMediaElement & { preservesPitch?: boolean }).preservesPitch = this.preserve_pitch;
        (media as HTMLMediaElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = this.preserve_pitch;

        await new Promise<void>((resolve, reject) => {
            let settled = false;
            const cleanup = (): void => {
                media.onloadedmetadata = null;
                media.onerror = null;
            };

            media.onloadedmetadata = () => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                resolve();
            };

            media.onerror = () => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                reject(new Error("Failed to load media audio metadata"));
            };
        });

        media.onended = () => {
            if (this.media_element !== media) {
                return;
            }

            if (this._is_playing) {
                this._is_playing = false;
                this.pause_time = this._duration;
            }
        };

        this.media_element = media;
        this.media_source = this.audio_context.createMediaElementSource(media);
        this.media_source.connect(this.gain_node);
        this.media_url = url;
        this._duration = Math.max(0, (media.duration || 0) * 1000);
    }

    private async wait_for_seek_settle(target_ms: number): Promise<void> {
        if (!this.media_element) {
            return;
        }

        const media = this.media_element;
        const tolerance_ms = 90;
        const timeout_ms = 800;
        const current_ms = media.currentTime * 1000;
        if (Math.abs(current_ms - target_ms) <= tolerance_ms) {
            return;
        }

        await new Promise<void>((resolve) => {
            let settled = false;
            const timer = window.setTimeout(() => {
                cleanup();
                resolve();
            }, timeout_ms);

            const cleanup = (): void => {
                if (settled) {
                    return;
                }

                settled = true;
                window.clearTimeout(timer);
                media.removeEventListener("seeked", on_seeked);
                media.removeEventListener("timeupdate", on_seeked);
                media.removeEventListener("error", on_error);
            };

            const on_seeked = (): void => {
                if (Math.abs(media.currentTime * 1000 - target_ms) <= tolerance_ms) {
                    cleanup();
                    resolve();
                }
            };

            const on_error = (): void => {
                cleanup();
                resolve();
            };

            media.addEventListener("seeked", on_seeked);
            media.addEventListener("timeupdate", on_seeked);
            media.addEventListener("error", on_error);
        });
    }

    private release_media(): void {
        if (this.media_source) {
            this.media_source.disconnect();
            this.media_source = null;
        }

        if (this.media_element) {
            this.media_element.onended = null;
            this.media_element.onerror = null;
            this.media_element.onloadedmetadata = null;
            this.media_element.pause();
            this.media_element.src = "";
            this.media_element.load();
            this.media_element = null;
        }

        if (this.media_url) {
            URL.revokeObjectURL(this.media_url);
            this.media_url = null;
        }
    }

    private release_precise_buffer(): void {
        this.stop_precise_playback(false);
        this.decoded_buffer = null;
        this.use_precise_buffer = false;
    }
}

class HitsoundMixer {
    private audio_context: AudioContext;
    private gain_node: GainNode;
    private custom_samples: Map<HitsoundKey, AudioBuffer> = new Map();

    constructor(context: AudioContext) {
        this.audio_context = context;
        this.gain_node = this.audio_context.createGain();
        this.gain_node.connect(this.audio_context.destination);
    }

    set_volume(volume: number): void {
        this.gain_node.gain.value = clamp(volume, 0, 1);
    }

    async load_samples(urls: string[]): Promise<void> {
        this.custom_samples.clear();
        await this.load_into_cache(urls, this.custom_samples);
    }

    async load_samples_from_files(files: Map<string, ArrayBuffer>): Promise<void> {
        this.custom_samples.clear();
        await this.load_files_into_cache(files, this.custom_samples);
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
            const custom_key = this.get_sample_key_from_name(custom_filename);
            if (custom_key && this.play_buffer(custom_key, volume, when)) {
                return;
            }
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

    play_custom(sample_key: string, volume: number = 100, when: number = 0): boolean {
        const key = sample_key.toLowerCase();
        return this.play_buffer(key, volume, when);
    }

    dispose(): void {
        this.custom_samples.clear();
        this.gain_node.disconnect();
    }

    private play_sound(set: string, type: string, index: number, volume: number, when: number): void {
        const keys: HitsoundKey[] = [];

        if (index > 1) {
            keys.push(`${set}-${type}${index}`);
        }
        keys.push(`${set}-${type}`);

        if (set !== "normal") {
            if (index > 1) {
                keys.push(`normal-${type}${index}`);
            }
            keys.push(`normal-${type}`);
        }

        for (const key of keys) {
            if (this.play_buffer(key, volume, when)) {
                return;
            }
        }
    }

    private play_buffer(key: HitsoundKey, volume: number, when: number): boolean {
        const buffer = this.custom_samples.get(key);
        if (!buffer) {
            return false;
        }

        const source = this.audio_context.createBufferSource();
        source.buffer = buffer;

        const gain = this.audio_context.createGain();
        gain.gain.value = volume / 100;

        source.connect(gain);
        gain.connect(this.gain_node);

        source.onended = () => {
            source.disconnect();
            gain.disconnect();
        };

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

    private get_sample_key_from_name(name: string): string | null {
        const clean = name.split("?")[0].split("#")[0];
        const file_name = clean.split("/").pop();
        const base = file_name ?? clean;
        if (!base) {
            return null;
        }
        return base.toLowerCase().replace(/\.(wav|mp3|ogg)$/i, "");
    }

    private get_sample_key_from_url(url: string): string | null {
        const key = this.get_sample_key_from_name(url);
        if (!key) {
            return null;
        }
        if (!url.toLowerCase().match(/\.(wav|mp3|ogg)(\?|#|$)/)) {
            return null;
        }
        return key;
    }

    private async load_into_cache(urls: string[], target: Map<HitsoundKey, AudioBuffer>): Promise<void> {
        if (urls.length == 0) {
            return;
        }

        const failed: string[] = [];
        const load_tasks: Promise<void>[] = [];
        for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            load_tasks.push(
                (async () => {
                    const key = this.get_sample_key_from_url(url);
                    if (!key) {
                        failed.push(url);
                        return;
                    }

                    if (target.has(key)) {
                        return;
                    }

                    await this.load_single_sample(url, key, target, failed);
                })()
            );
        }

        await Promise.all(load_tasks);
        this.report_failures(failed.length, target.size);
    }

    private async load_single_sample(url: string, key: HitsoundKey, target: Map<HitsoundKey, AudioBuffer>, failed: string[]): Promise<void> {
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

    private async load_files_into_cache(files: Map<string, ArrayBuffer>, target: Map<HitsoundKey, AudioBuffer>): Promise<void> {
        if (files.size == 0) {
            return;
        }

        const failed: string[] = [];
        const load_tasks: Promise<void>[] = [];
        for (const [name, data] of files) {
            load_tasks.push(
                (async () => {
                    const key = this.get_sample_key_from_name(name);
                    if (!key || target.has(key)) {
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
                })()
            );
        }

        await Promise.all(load_tasks);
        this.report_failures(failed.length, target.size);
    }

    private report_failures(failed_count: number, loaded_count: number): void {
        if (failed_count > 0 && loaded_count === 0) {
            console.warn(`[HitsoundMixer] Failed to load ${failed_count} hitsounds`);
        }
    }
}

export class AudioEngine {
    readonly music_player: MusicPlayer;
    readonly hitsound_mixer: HitsoundMixer;

    constructor(context: AudioContext) {
        this.music_player = new MusicPlayer(context);
        this.hitsound_mixer = new HitsoundMixer(context);
    }

    get is_playing(): boolean {
        return this.music_player.is_playing;
    }

    get is_loaded(): boolean {
        return this.music_player.is_loaded;
    }

    get duration(): number {
        return this.music_player.duration;
    }

    get current_time(): number {
        return this.music_player.current_time;
    }

    get rate(): number {
        return this.music_player.speed_multiplier;
    }

    get speed_multiplier(): number {
        return this.music_player.speed_multiplier;
    }

    async load(data: ArrayBuffer, speed_multiplier: number = 1): Promise<void> {
        await this.music_player.load(data, speed_multiplier);
    }

    async play(from_time?: number): Promise<void> {
        await this.music_player.play(from_time);
    }

    pause(): void {
        this.music_player.pause();
    }

    seek(time_ms: number): void {
        this.music_player.seek(time_ms);
    }

    stop(): void {
        this.music_player.stop();
    }

    get_host_time(time_ms: number): number {
        return this.music_player.get_host_time(time_ms);
    }

    set_rate(speed: number): void {
        this.music_player.set_rate(speed);
    }

    async set_pitch_preserve(enabled: boolean): Promise<void> {
        await this.music_player.set_pitch_preserve(enabled);
    }

    set_music_volume(volume: number): void {
        this.music_player.set_volume(volume);
    }

    set_hitsound_volume(volume: number): void {
        this.hitsound_mixer.set_volume(volume);
    }

    async load_hitsounds(urls: string[]): Promise<void> {
        await this.hitsound_mixer.load_samples(urls);
    }

    async load_hitsounds_from_files(files: Map<string, ArrayBuffer>): Promise<void> {
        await this.hitsound_mixer.load_samples_from_files(files);
    }

    clear_hitsounds(): void {
        this.hitsound_mixer.clear();
    }

    dispose(): void {
        this.music_player.dispose();
        this.hitsound_mixer.dispose();
    }
}
