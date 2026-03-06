import { AudioNodeController } from "./audio_node_controller";

export class AudioController extends AudioNodeController {
    private media_element: HTMLAudioElement | null = null;
    private media_url: string | null = null;

    private _is_playing: boolean = false;
    private _is_loaded: boolean = false;
    private _duration: number = 0;
    private pause_time: number = 0;
    private speed: number = 1;

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
        if (!this.media_element) {
            return this.pause_time;
        }

        const media_time = Math.max(0, this.media_element.currentTime * 1000);
        if (media_time >= this._duration) {
            return this._duration;
        }

        return media_time;
    }

    async load(data: ArrayBuffer, speed_multiplier: number = 1): Promise<void> {
        this.stop();
        this.release_media();

        this.speed = Math.max(0.1, speed_multiplier);
        await this.load_media_element(data);
        this._is_loaded = true;
        this.pause_time = 0;
    }

    async play(from_time?: number): Promise<void> {
        if (!this.media_element) {
            console.warn("[AudioController] Cannot play: not loaded");
            return;
        }

        const start_time = from_time !== undefined ? from_time : this.pause_time;
        const clamped_start = Math.max(0, Math.min(start_time, this._duration));
        this.media_element.currentTime = clamped_start / 1000;
        this.media_element.playbackRate = this.speed;
        this.pause_time = clamped_start;

        try {
            await this.media_element.play();
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

        if (this.media_element) {
            this.media_element.pause();
            this.pause_time = Math.max(0, this.media_element.currentTime * 1000);
        }

        this._is_playing = false;
    }

    seek(time_ms: number): void {
        const clamped = Math.max(0, Math.min(time_ms, this._duration));
        this.pause_time = clamped;

        if (this.media_element) {
            this.media_element.currentTime = clamped / 1000;
        }
    }

    stop(): void {
        if (this.media_element) {
            this.media_element.pause();
            this.media_element.currentTime = 0;
        }

        this._is_playing = false;
        this.pause_time = 0;
    }

    get_host_time(time_ms: number): number {
        const delta_ms = time_ms - this.current_time;
        return this.audio_context.currentTime + delta_ms / 1000 / this.speed;
    }

    set_speed(speed: number): void {
        this.speed = Math.max(0.1, speed);

        if (this.media_element) {
            this.media_element.playbackRate = this.speed;
        }

        if (!this._is_playing) {
            this.pause_time = this.current_time;
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

    private async load_media_element(data: ArrayBuffer): Promise<void> {
        this.release_media();

        const blob = new Blob([data]);
        const url = URL.createObjectURL(blob);
        const media = new Audio();
        media.preload = "metadata";
        media.src = url;
        media.playbackRate = this.speed;

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
        this.media_url = url;
        this._duration = Math.max(0, (media.duration || 0) * 1000);
    }

    private release_media(): void {
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
}
