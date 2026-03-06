import { AudioNodeController } from "./audio_node_controller";

export class AudioController extends AudioNodeController {
    private audio_buffer: AudioBuffer | null = null;
    private source_node: AudioBufferSourceNode | null = null;

    private _is_playing: boolean = false;
    private _is_loaded: boolean = false;
    private _duration: number = 0;
    private pause_time: number = 0;
    private speed: number = 1;

    private started_at_context_time: number = 0;
    private started_from_time: number = 0;

    constructor(context: AudioContext) {
        super(context);
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

        const elapsed_ms = (this.audio_context.currentTime - this.started_at_context_time) * 1000 * this.speed;
        const time = this.started_from_time + elapsed_ms;
        if (time >= this._duration) {
            return this._duration;
        }

        return Math.max(0, time);
    }

    async load(data: ArrayBuffer, speed_multiplier: number = 1): Promise<void> {
        this.stop();
        this.release_source();
        this.audio_buffer = null;

        try {
            this.speed = Math.max(0.1, speed_multiplier);
            this.audio_buffer = await this.audio_context.decodeAudioData(data.slice(0));
            this._duration = Math.max(0, (this.audio_buffer.duration || 0) * 1000);
            this._is_loaded = true;
            this.pause_time = 0;
            this.started_at_context_time = 0;
            this.started_from_time = 0;
        } catch (e) {
            console.error("Failed to load audio data", e);
            this.release_source();
            this.audio_buffer = null;
            throw e;
        }
    }

    async play(from_time?: number): Promise<void> {
        if (!this.audio_buffer) {
            console.warn("[AudioController] Cannot play: not loaded");
            return;
        }

        const start_time = from_time !== undefined ? from_time : this.pause_time;
        const clamped_start = Math.max(0, Math.min(start_time, this._duration));

        if (clamped_start >= this._duration) {
            this.pause_time = this._duration;
            return;
        }

        this.release_source();

        const source = this.audio_context.createBufferSource();
        source.buffer = this.audio_buffer;
        source.playbackRate.value = this.speed;
        source.connect(this.gain_node);

        source.onended = () => {
            if (this.source_node !== source) {
                return;
            }

            this.source_node = null;

            if (this._is_playing) {
                this._is_playing = false;
                this.pause_time = this._duration;
            }
        };

        this.source_node = source;
        this.started_from_time = clamped_start;
        this.started_at_context_time = this.audio_context.currentTime;
        this.pause_time = clamped_start;
        this._is_playing = true;
        source.start(0, clamped_start / 1000);
    }

    pause(): void {
        if (!this._is_playing) return;

        this.pause_time = this.current_time;
        this.release_source();
        this._is_playing = false;
    }

    seek(time_ms: number): void {
        const clamped = Math.max(0, Math.min(time_ms, this._duration));
        this.pause_time = clamped;

        if (!this._is_playing) {
            return;
        }

        this.restart_from(clamped);
    }

    stop(): void {
        this.release_source();
        this._is_playing = false;
        this.pause_time = 0;
        this.started_at_context_time = 0;
        this.started_from_time = 0;
    }

    get_host_time(time_ms: number): number {
        const delta_ms = time_ms - this.current_time;
        return this.audio_context.currentTime + delta_ms / 1000 / this.speed;
    }

    set_speed(speed: number): void {
        const clamped_speed = Math.max(0.1, speed);

        if (this.speed === clamped_speed) {
            return;
        }

        const current = this.current_time;
        this.speed = clamped_speed;

        if (this._is_playing) {
            this.restart_from(current);
            return;
        }

        this.pause_time = current;
    }

    dispose(): void {
        this.stop();
        this.release_source();
        this.audio_buffer = null;
        this._is_loaded = false;
        this._duration = 0;
        this.pause_time = 0;
        this._is_playing = false;
        this.started_at_context_time = 0;
        this.started_from_time = 0;

        this.dispose_audio_node();
    }

    private restart_from(time_ms: number): void {
        if (!this.audio_buffer) {
            return;
        }

        const clamped = Math.max(0, Math.min(time_ms, this._duration));
        this.release_source();

        const source = this.audio_context.createBufferSource();

        source.buffer = this.audio_buffer;
        source.playbackRate.value = this.speed;

        source.connect(this.gain_node);
        source.onended = () => {
            if (this.source_node !== source) {
                return;
            }

            this.source_node = null;

            if (this._is_playing) {
                this._is_playing = false;
                this.pause_time = this._duration;
            }
        };

        this.source_node = source;
        this.started_from_time = clamped;
        this.started_at_context_time = this.audio_context.currentTime;
        this.pause_time = clamped;
        this._is_playing = true;

        source.start(0, clamped / 1000);
    }

    private release_source(): void {
        if (!this.source_node) {
            return;
        }

        this.source_node.onended = null;

        try {
            this.source_node.stop();
        } catch {
            //
        }

        this.source_node.disconnect();
        this.source_node = null;
    }
}
