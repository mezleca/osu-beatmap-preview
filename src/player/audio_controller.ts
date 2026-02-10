import { clamp } from "@/math/vector2";
import { get_speed_multiplier } from "../types/mods";

export class AudioController {
    private audio_context: AudioContext;
    private audio_source: AudioBufferSourceNode | null = null;
    private audio_buffer: AudioBuffer | null = null;
    private gain_node: GainNode;

    private start_time: number = 0;
    private pause_time: number = 0;
    private speed: number = 1;
    private _is_playing: boolean = false;
    private _duration: number = 0;
    private _is_loaded: boolean = false;

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
        return this.speed;
    }

    get current_time(): number {
        if (!this._is_playing) {
            return this.pause_time;
        }
        return (this.audio_context.currentTime - this.start_time) * this.speed * 1000;
    }

    async load(data: ArrayBuffer, mods: number = 0): Promise<void> {
        this.stop();

        try {
            // copy buffer to avoid issues if source is detached
            this.audio_buffer = await this.audio_context.decodeAudioData(data.slice(0));
            this._duration = this.audio_buffer.duration * 1000;
            this.speed = get_speed_multiplier(mods);
            this._is_loaded = true;
            this.pause_time = 0;
        } catch (e) {
            console.error("Failed to decode audio data", e);
            throw e;
        }
    }

    play(from_time?: number): void {
        if (!this.audio_buffer) {
            console.warn("[AudioController] Cannot play: not loaded");
            return;
        }

        // stop current source if exists
        this.stop_source();

        const start_offset = from_time !== undefined ? from_time / 1000 : this.pause_time / 1000;

        // clamp to valid range
        const duration = this.audio_buffer.duration;
        const clamped_offset = Math.max(0, Math.min(start_offset, duration));

        if (clamped_offset >= duration) {
            // seeking past end
            this.pause_time = duration * 1000;
            return;
        }

        this.audio_source = this.audio_context.createBufferSource();
        this.audio_source.buffer = this.audio_buffer;
        this.audio_source.playbackRate.value = this.speed;
        this.audio_source.connect(this.gain_node);

        this.audio_source.onended = () => {
            if (this._is_playing) {
                this._is_playing = false;
                this.pause_time = this._duration;
                this.audio_source = null;
            }
        };

        this.start_time = this.audio_context.currentTime - clamped_offset / this.speed;
        this.audio_source.start(0, clamped_offset);
        this._is_playing = true;
    }

    pause(): void {
        if (!this._is_playing) return;

        // save current position before stopping
        this.pause_time = this.current_time;
        this.stop_source();
        this._is_playing = false;
    }

    seek(time_ms: number): void {
        const clamped = Math.max(0, Math.min(time_ms, this._duration));

        if (this._is_playing) {
            // stop and restart at new position
            this.stop_source();
            this._is_playing = false;
            this.pause_time = clamped;
            this.play();
        } else {
            this.pause_time = clamped;
        }
    }

    stop(): void {
        this.pause();
        this.pause_time = 0;
    }

    get_host_time(time_ms: number): number {
        // returns the AudioContext time corresponding to the given map time
        // current_time = (ctx_time - start_time) * speed * 1000
        // ctx_time = (current_time / 1000 / speed) + start_time
        return this.start_time + time_ms / 1000 / this.speed;
    }

    private stop_source(): void {
        if (this.audio_source) {
            try {
                this.audio_source.onended = null;
                this.audio_source.stop();
                this.audio_source.disconnect();
            } catch (err) {
                console.error("[AudioController]", err as string);
            }
            this.audio_source = null;
        }
    }

    set_volume(volume: number): void {
        if (this.gain_node) {
            this.gain_node.gain.value = clamp(volume, 0, 1);
        }
    }

    set_speed(speed: number): void {
        if (this._is_playing) {
            // capture current position before speed change
            const current_pos = this.current_time;
            this.speed = speed;
            // recalculate start_time for new speed
            this.start_time = this.audio_context.currentTime - current_pos / 1000 / speed;
        } else {
            this.speed = speed;
        }

        if (this.audio_source) {
            this.audio_source.playbackRate.value = speed;
        }
    }

    dispose(): void {
        this.stop();
        this.audio_buffer = null;
        this._is_loaded = false;

        // disconnect gain node but don't close context (shared)
        this.gain_node.disconnect();
    }
}
