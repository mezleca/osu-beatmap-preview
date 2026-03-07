import { AudioNodeController } from "./audio_node_controller";

export class AudioController extends AudioNodeController {
    private static readonly PRECISE_BUFFER_MAX_BYTES = 8 * 1024 * 1024;

    private use_precise_buffer = false;
    private decoded_buffer: AudioBuffer | null = null;
    private buffer_source: AudioBufferSourceNode | null = null;

    private media_element: HTMLAudioElement | null = null;
    private media_source: MediaElementAudioSourceNode | null = null;
    private media_url: string | null = null;

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
        if (this.use_precise_buffer && this.decoded_buffer) {
            if (!this._is_playing) {
                return this.pause_time;
            }

            const elapsed_ms = (this.audio_context.currentTime - this.started_at_context_time) * 1000 * this.speed;
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

        const elapsed_ms = (this.audio_context.currentTime - this.started_at_context_time) * 1000 * this.speed;
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

        this.speed = Math.max(0.1, speed_multiplier);
        this.use_precise_buffer = false;

        if (data.byteLength <= AudioController.PRECISE_BUFFER_MAX_BYTES) {
            try {
                await this.load_precise_buffer(data);
                this.use_precise_buffer = true;
            } catch {
                this.use_precise_buffer = false;
            }
        }

        if (!this.use_precise_buffer) {
            await this.load_media_element(data);
        }

        this._is_loaded = true;
        this.pause_time = 0;
        this.started_at_context_time = 0;
        this.started_from_time = 0;
    }

    async play(from_time?: number): Promise<void> {
        if (!this.use_precise_buffer && !this.media_element) {
            console.warn("[AudioController] Cannot play: not loaded");
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
            console.warn("[AudioController] Cannot play: media element unavailable");
            return;
        }

        media.currentTime = clamped_start / 1000;
        await this.wait_for_seek_settle(clamped_start);
        media.playbackRate = this.speed;
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
        return this.audio_context.currentTime + delta_ms / 1000 / this.speed;
    }

    set_speed(speed: number): void {
        const current = this.current_time;
        this.speed = Math.max(0.1, speed);

        if (this.use_precise_buffer && this._is_playing) {
            this.start_precise_playback(current);
        }

        if (this.media_element) {
            this.media_element.playbackRate = this.speed;
        }

        this.started_from_time = current;
        this.started_at_context_time = this.audio_context.currentTime;
        this.pause_time = current;
    }

    override set_volume(volume: number): void {
        super.set_volume(volume);
        if (this.media_element) {
            this.media_element.volume = 1;
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

        this.dispose_audio_node();
    }

    private start_precise_playback(start_ms: number): void {
        if (!this.decoded_buffer) {
            return;
        }

        this.stop_precise_playback(false);

        const source = this.audio_context.createBufferSource();
        source.buffer = this.decoded_buffer;
        source.playbackRate.value = this.speed;
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
        media.playbackRate = this.speed;
        media.volume = 1;

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
