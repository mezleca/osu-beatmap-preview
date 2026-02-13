import { get_speed_multiplier } from "../types/mods";
import { AudioNodeController } from "./audio_node_controller";

export class AudioController extends AudioNodeController {
    private audio_element: HTMLAudioElement | null = null;
    private media_source_node: MediaElementAudioSourceNode | null = null;
    private object_url: string | null = null;

    private pause_time: number = 0;
    private speed: number = 1;
    private _is_playing: boolean = false;
    private _duration: number = 0;
    private _is_loaded: boolean = false;

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
        if (!this.audio_element) {
            return this.pause_time;
        }

        if (!this._is_playing) {
            return this.pause_time;
        }

        return this.audio_element.currentTime * 1000;
    }

    async load(data: ArrayBuffer, mods: number = 0): Promise<void> {
        this.stop();
        this.release_media();

        try {
            this.speed = get_speed_multiplier(mods);

            const blob = new Blob([data]);
            const object_url = URL.createObjectURL(blob);
            const audio_element = new Audio(object_url);
            audio_element.preload = "metadata";
            audio_element.playbackRate = this.speed;
            audio_element.preservesPitch = false;

            this.audio_element = audio_element;
            this.object_url = object_url;

            this.media_source_node = this.audio_context.createMediaElementSource(audio_element);
            this.media_source_node.connect(this.gain_node);

            await new Promise<void>((resolve, reject) => {
                const on_loaded_metadata = () => {
                    audio_element.removeEventListener("loadedmetadata", on_loaded_metadata);
                    audio_element.removeEventListener("error", on_error);
                    resolve();
                };

                const on_error = () => {
                    audio_element.removeEventListener("loadedmetadata", on_loaded_metadata);
                    audio_element.removeEventListener("error", on_error);
                    reject(new Error("Failed to load audio metadata"));
                };

                audio_element.addEventListener("loadedmetadata", on_loaded_metadata, { once: true });
                audio_element.addEventListener("error", on_error, { once: true });
            });

            this._duration = Math.max(0, (this.audio_element.duration || 0) * 1000);
            this._is_loaded = true;
            this.pause_time = 0;

            this.audio_element.onended = () => {
                this._is_playing = false;
                this.pause_time = this._duration;
            };
        } catch (e) {
            console.error("Failed to load audio data", e);
            this.release_media();
            throw e;
        }
    }

    async play(from_time?: number): Promise<void> {
        if (!this.audio_element) {
            console.warn("[AudioController] Cannot play: not loaded");
            return;
        }

        const start_offset = from_time !== undefined ? from_time / 1000 : this.pause_time / 1000;
        const duration = this.audio_element.duration || this._duration / 1000;
        const clamped_offset = Math.max(0, Math.min(start_offset, duration));

        if (clamped_offset >= duration) {
            this.pause_time = duration * 1000;
            return;
        }

        this.audio_element.currentTime = clamped_offset;
        this.audio_element.playbackRate = this.speed;

        try {
            await this.audio_element.play();
            this._is_playing = true;
        } catch (error) {
            this._is_playing = false;
            throw error;
        }
    }

    pause(): void {
        if (!this.audio_element || !this._is_playing) return;

        this.pause_time = this.current_time;
        this.audio_element.pause();
        this._is_playing = false;
    }

    seek(time_ms: number): void {
        const clamped = Math.max(0, Math.min(time_ms, this._duration));

        this.pause_time = clamped;

        if (!this.audio_element) {
            return;
        }

        this.audio_element.currentTime = clamped / 1000;
    }

    stop(): void {
        this.pause();
        this.pause_time = 0;

        if (this.audio_element) {
            this.audio_element.currentTime = 0;
        }
    }

    get_host_time(time_ms: number): number {
        const delta_ms = time_ms - this.current_time;
        return this.audio_context.currentTime + delta_ms / 1000 / this.speed;
    }

    set_speed(speed: number): void {
        this.speed = speed;

        if (this.audio_element) {
            this.audio_element.playbackRate = speed;
        }
    }

    dispose(): void {
        this.stop();
        this.release_media();
        this._is_loaded = false;
        this._duration = 0;
        this.pause_time = 0;
        this._is_playing = false;

        this.dispose_audio_node();
    }

    private release_media(): void {
        if (this.audio_element) {
            this.audio_element.pause();
            this.audio_element.onended = null;
            this.audio_element.src = "";
            this.audio_element.load();
            this.audio_element = null;
        }

        if (this.media_source_node) {
            this.media_source_node.disconnect();
            this.media_source_node = null;
        }

        if (this.object_url) {
            URL.revokeObjectURL(this.object_url);
            this.object_url = null;
        }
    }
}
