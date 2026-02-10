export class VideoController {
    private video: HTMLVideoElement | null = null;
    private object_url: string | null = null;
    private _offset: number = 0;

    get element(): HTMLVideoElement | null {
        return this.video;
    }

    get offset(): number {
        return this._offset;
    }

    async load(data: Blob, offset: number = 0): Promise<void> {
        this.dispose();

        this._offset = offset;

        this.video = document.createElement("video");
        this.video.muted = true;
        this.video.loop = false;
        this.video.playsInline = true;

        this.object_url = URL.createObjectURL(data);
        this.video.src = this.object_url;

        await new Promise<void>((resolve, reject) => {
            if (!this.video) {
                return reject(new Error("No video element"));
            }

            this.video.onloadeddata = () => resolve();
            this.video.onerror = () => reject(new Error("Failed to load video"));
        });
    }

    sync(audio_time_ms: number): void {
        if (!this.video) return;

        const video_time = (audio_time_ms - this._offset) / 1000;

        // only sync if visible (after offset)
        if (video_time < 0) {
            if (!this.video.paused) {
                this.video.pause();
            }
            return;
        }

        // check if video is out of sync
        const diff = Math.abs(this.video.currentTime - video_time);

        if (diff > 0.1) {
            this.video.currentTime = video_time;
        }
    }

    play(): void {
        if (this.video && this.video.paused) {
            this.video.play().catch(() => {
                console.log("failed to play video");
            });
        }
    }

    pause(): void {
        if (this.video && !this.video.paused) {
            this.video.pause();
        }
    }

    seek(time_ms: number): void {
        if (!this.video) return;

        const video_time = Math.max(0, (time_ms - this._offset) / 1000);
        this.video.currentTime = video_time;
    }

    dispose(): void {
        if (this.video) {
            this.video.pause();
            this.video.src = "";
            this.video = null;
        }

        if (this.object_url) {
            URL.revokeObjectURL(this.object_url);
            this.object_url = null;
        }
    }
}
