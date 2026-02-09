import type { IBeatmap, IHitObject, IBeatmapInfo, ITimingPoint } from "../types/beatmap";
import { GameMode, SampleSet } from "../types/beatmap";
import type { IBeatmapResources } from "../types/resources";
import { type Result, ErrorCode, ok, err } from "../types/result";
import { get_speed_multiplier } from "../types/mods";
import { OszLoader } from "../parser/osz_loader";
import { get_shared_parser } from "../parser/async_parser";
import { BaseRenderer, DEFAULT_RENDERER_CONFIG, type IRendererConfig } from "../renderer/base_renderer";
import type { IRenderBackend } from "../renderer/backend/render_backend";
import { CanvasBackend } from "../renderer/backend/canvas_backend";
import { StandardRenderer } from "../renderer/standard/standard_renderer";
import { ManiaRenderer } from "../renderer/mania/mania_renderer";
import { AudioController } from "./audio_controller";
import { VideoController } from "./video_controller";
import { HitsoundController } from "./hitsound_controller";
import { type ISkinConfig, merge_skin } from "../skin/skin_config";
import { wait_for_fonts_ready } from "../fonts";
import { BeatmapAssets } from "./beatmap_assets";

const PREVIEW_FALLBACK_RATIO = 0.42;
const HITSOUND_LOOKAHEAD_MS = 100;
const RESYNC_THRESHOLD_MS = 30;
const HIT_WINDOW_MS = 20;

type PlayerEventMap = {
    timeupdate: [time: number, duration: number];
    ended: [];
    loaded: [beatmap: IBeatmap, resources: IBeatmapResources];
    error: [code: ErrorCode, reason: string];
    statechange: [is_playing: boolean];
    play: [];
    pause: [];
    seek: [time: number];
};

type PlayerEvent = keyof PlayerEventMap;

export interface IPlayerOptions {
    canvas: HTMLCanvasElement;
    skin?: Partial<ISkinConfig>;
    mods?: number;
    start_time?: number;
    autoplay?: boolean;
    volume?: number;
    backend?: IRenderBackend;
    renderer_config?: Partial<IRendererConfig>;
    playfield_scale?: number;
    auto_resize?: boolean;
    enable_fps_counter?: boolean;
    time_smoothing?: number;
    max_frame_delta?: number;
}

export class BeatmapPlayer {
    private backend: IRenderBackend;
    private renderer: BaseRenderer | null = null;

    // audio system
    private audio_context: AudioContext;
    private audio: AudioController;
    private hitsounds: HitsoundController;
    private video: VideoController | null = null;

    private resources: IBeatmapResources | null = null;
    private animation_frame: number | null = null;

    private skin: ISkinConfig;
    private mods: number;
    private renderer_config: IRendererConfig;
    private start_offset: number;
    private volume: number;
    private background_url: string | null = null;

    private listeners: Map<PlayerEvent, Set<Function>> = new Map();
    private raw_osu_content: string = "";
    private is_loaded_flag: boolean = false;

    private next_hit_object_index: number = 0;

    private resize_observer: ResizeObserver | null = null;
    private key_handler: ((e: KeyboardEvent) => void) | null = null;
    private options: IPlayerOptions;

    // fps tracking
    private enable_fps_counter = false;
    private fps_frame_count = 0;
    private fps_last_update = 0;
    private current_fps = 0;
    private time_smoothing = 0.1;
    private smoothed_delta = 0;
    private max_frame_delta = 100;

    private last_timestamp: number = 0;
    private smooth_time: number = 0;

    constructor(options: IPlayerOptions) {
        this.options = options;
        this.backend = options.backend ?? new CanvasBackend();
        this.skin = merge_skin(options.skin);
        this.mods = options.mods ?? 0;
        this.renderer_config = { ...DEFAULT_RENDERER_CONFIG, ...options.renderer_config };

        // calculate scale and offset
        this.calculate_layout(options.canvas.width, options.canvas.height, options.playfield_scale);

        this.start_offset = options.start_time ?? -1;
        this.volume = options.volume ?? 0.5;

        // initialize backend with high dpi setting
        this.backend.initialize(options.canvas, this.renderer_config.use_high_dpi);

        // initialize audio system
        // @ts-ignore
        const audio_context_class = window.AudioContext || window.webkitAudioContext;
        this.audio_context = new audio_context_class();

        this.audio = new AudioController(this.audio_context);
        this.hitsounds = new HitsoundController(this.audio_context);

        // set initial volumes
        this.audio.set_volume(this.volume);
        this.hitsounds.set_volume(this.volume);

        if (options.auto_resize) {
            this.setup_auto_resize();
        }

        this.enable_fps_counter = options.enable_fps_counter ?? false;
        this.fps_last_update = performance.now();

        const time_smoothing = options.time_smoothing;
        if (Number.isFinite(time_smoothing)) {
            this.time_smoothing = Math.max(0, Math.min(1, time_smoothing as number));
        }

        const max_frame_delta = options.max_frame_delta;
        if (Number.isFinite(max_frame_delta)) {
            this.max_frame_delta = Math.max(10, max_frame_delta as number);
        }
    }

    // load from .osz ArrayBuffer
    async load_osz(data: ArrayBuffer, difficulty?: number | string): Promise<Result<IBeatmapResources>> {
        try {
            const loader = new OszLoader();
            const result = await loader.load_osz(data, { difficulty });
            this.resources = result;
            return this.setup();
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            this.emit("error", ErrorCode.InvalidBeatmap, reason);
            return err(ErrorCode.InvalidBeatmap, reason);
        }
    }

    // load from file map (direct access)
    async load_files(files: Map<string, ArrayBuffer | string>, difficulty?: number | string): Promise<Result<IBeatmapResources>> {
        try {
            const loader = new OszLoader();
            this.resources = await loader.load_from_files(files, { difficulty });

            // store raw content for preview time extraction
            for (const [name, content] of files) {
                if (name.endsWith(".osu")) {
                    this.raw_osu_content = typeof content === "string" ? content : new TextDecoder().decode(content);
                    break;
                }
            }

            return this.setup();
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            this.emit("error", ErrorCode.InvalidBeatmap, reason);
            return err(ErrorCode.InvalidBeatmap, reason);
        }
    }

    async load_hitsounds(files: Map<string, ArrayBuffer>): Promise<void> {
        try {
            await this.hitsounds.load_samples(files);
        } catch (e) {
            console.error("[BeatmapPlayer] Failed to load hitsounds:", e);
        }
    }

    async load_beatmap(
        beatmap: IBeatmap,
        audio?: ArrayBuffer,
        background?: Blob,
        video?: Blob,
        video_offset?: number
    ): Promise<Result<IBeatmapResources>> {
        this.resources = {
            beatmap,
            available_difficulties: [],
            files: new Map(),
            audio,
            background,
            video,
            video_offset
        };
        return this.setup();
    }

    async load_osu_content(content: string, audio?: ArrayBuffer): Promise<Result<IBeatmapResources>> {
        try {
            const parser = get_shared_parser();
            const beatmap = await parser.parse(content);
            this.raw_osu_content = content;
            return this.load_beatmap(beatmap, audio);
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            this.emit("error", ErrorCode.InvalidBeatmap, reason);
            return err(ErrorCode.InvalidBeatmap, reason);
        }
    }

    private async setup(): Promise<Result<IBeatmapResources>> {
        if (!this.resources) {
            return err(ErrorCode.NotLoaded, "No resources loaded");
        }

        const { beatmap } = this.resources;
        const speed = get_speed_multiplier(this.mods);
        const assets = new BeatmapAssets(this.resources).resolve();

        if (!this.resources.audio && assets.audio) {
            this.resources.audio = assets.audio;
        }
        if (!this.resources.background && assets.background) {
            this.resources.background = assets.background;
        }
        if (!this.resources.video && assets.video) {
            this.resources.video = assets.video;
        }
        if (!this.resources.video_offset && assets.video_offset) {
            this.resources.video_offset = assets.video_offset;
        }

        const { audio, video, video_offset } = this.resources;

        // setup audio
        if (audio) {
            try {
                await this.audio.load(audio, this.mods);
            } catch (e) {
                const reason = e instanceof Error ? e.message : String(e);
                this.emit("error", ErrorCode.AudioDecodeError, reason);
                return err(ErrorCode.AudioDecodeError, reason);
            }
        }

        // setup video
        if (video) {
            this.video = new VideoController();
            await this.video.load(video, video_offset ?? 0, speed);
        }

        // create renderer based on mode
        try {
            this.renderer = this.create_renderer(beatmap);
            this.renderer.initialize(beatmap);
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            this.emit("error", ErrorCode.UnsupportedMode, reason);
            return err(ErrorCode.UnsupportedMode, reason);
        }

        // determine start time from preview point
        if (this.start_offset < 0 && this.raw_osu_content) {
            const parser = get_shared_parser();
            const preview = await parser.extract_preview_time(this.raw_osu_content);
            this.start_offset = preview > 0 ? preview : this.get_last_object_time() * PREVIEW_FALLBACK_RATIO;
        }
        if (this.start_offset < 0) {
            this.start_offset = 0;
        }

        // ensure start index is correct
        this.update_hit_index(this.start_offset);

        await this.load_background();
        await wait_for_fonts_ready();

        this.is_loaded_flag = true;
        this.emit("loaded", beatmap, this.resources);
        requestAnimationFrame(() => this.render_frame(this.start_offset));

        return ok(this.resources);
    }

    private async load_background(): Promise<void> {
        if (!this.resources?.background || !this.renderer) {
            return;
        }

        try {
            const img = new Image();
            if (this.background_url) {
                URL.revokeObjectURL(this.background_url);
            }
            this.background_url = URL.createObjectURL(this.resources.background);
            img.src = this.background_url;
            await img.decode();
            this.renderer.set_background({
                source: img,
                width: img.width,
                height: img.height
            });
        } catch (e) {
            console.warn("[BeatmapPlayer] Failed to load background", e);
        }
    }

    private create_renderer(beatmap: IBeatmap): BaseRenderer {
        switch (beatmap.mode) {
            case GameMode.Standard:
                return new StandardRenderer(this.backend, this.skin, this.mods, this.renderer_config);
            case GameMode.Mania:
                return new ManiaRenderer(this.backend, this.skin, this.mods, this.renderer_config);
            case GameMode.Taiko:
            case GameMode.Catch:
            default:
                throw new Error(`Unsupported game mode: ${GameMode[beatmap.mode] ?? beatmap.mode}`);
        }
    }

    private get_last_object_time(): number {
        if (!this.resources?.beatmap.objects.length) {
            return 0;
        }
        const objects = this.resources.beatmap.objects;
        return objects[objects.length - 1].end_time;
    }

    async play(): Promise<void> {
        if (!this.renderer || !this.is_loaded_flag) {
            console.warn("[BeatmapPlayer] Cannot play: not loaded");
            return;
        }

        if (this.audio.is_playing) {
            return;
        }

        // resume audio context if suspended (browser requirement)
        if (this.audio_context.state === "suspended") {
            await this.audio_context.resume();
        }

        this.audio.play(this.start_offset);
        this.video?.play();
        this.start_render_loop();
        this.emit("play");
        this.emit("statechange", true);
    }

    pause(): void {
        if (!this.audio.is_playing) {
            return;
        }

        // save current position for resume
        this.start_offset = this.audio.current_time;

        this.audio.pause();
        this.video?.pause();
        this.stop_render_loop();
        this.emit("pause");
        this.emit("statechange", false);
    }

    set_mods(mods: number): void {
        this.mods = mods;
        const speed = get_speed_multiplier(mods);

        this.renderer?.set_mods(mods);
        this.audio.set_speed(speed);
        this.video?.set_speed(speed);

        if (this.is_loaded_flag) {
            requestAnimationFrame(() => this.render_frame(this.current_time));
        }
    }

    seek(time_ms: number): void {
        // update start offset for both playing and paused states
        this.start_offset = Math.max(0, Math.min(time_ms, this.duration));

        // update hit index to avoid replaying hits or missing future hits
        this.update_hit_index(this.start_offset);

        this.audio.seek(this.start_offset);
        this.video?.seek(this.start_offset);

        this.emit("seek", this.start_offset);

        // render frame at new position
        this.render_frame(this.start_offset);
    }

    async set_difficulty(index: number | string): Promise<Result<IBeatmapResources>> {
        if (!this.resources) {
            return err(ErrorCode.NotLoaded, "No beatmap resources loaded");
        }

        const was_playing = this.is_playing;
        this.stop();

        try {
            const loader = new OszLoader();
            // preserve existing files and options, just change difficulty
            const result = await loader.load_from_files(this.resources.files, { difficulty: index });
            this.resources = result;

            // update raw content for preview time extraction
            const selected_file = this.resources.available_difficulties.find((d) => d.version === this.resources!.beatmap.version)?.filename;
            if (selected_file) {
                const content = this.resources.files.get(selected_file);
                if (content) {
                    this.raw_osu_content = typeof content === "string" ? content : new TextDecoder().decode(content);
                }
            }

            const setup_result = await this.setup();

            if (setup_result.success && was_playing) {
                this.play();
            }

            return setup_result;
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            this.emit("error", ErrorCode.InvalidBeatmap, reason);
            return err(ErrorCode.InvalidBeatmap, reason);
        }
    }

    private update_hit_index(time: number): void {
        if (!this.resources?.beatmap) {
            return;
        }

        const objects = this.resources.beatmap.objects;

        // reset index if we went backwards
        if (this.next_hit_object_index > 0 && objects[this.next_hit_object_index - 1].time > time) {
            this.next_hit_object_index = 0;
        }

        // fast forward
        while (this.next_hit_object_index < objects.length && objects[this.next_hit_object_index].time < time) {
            this.next_hit_object_index++;
        }
    }

    stop(): void {
        this.pause();
        this.start_offset = 0;
        this.audio.seek(0);
        this.update_hit_index(0);
        this.render_frame(0);
    }

    dispose(): void {
        this.stop();
        this.backend.dispose();
        this.audio.dispose();
        this.hitsounds.dispose();
        this.video?.dispose();
        this.renderer?.dispose();

        if (this.background_url) {
            URL.revokeObjectURL(this.background_url);
            this.background_url = null;
        }

        if (this.resize_observer) {
            this.resize_observer.disconnect();
            this.resize_observer = null;
        }

        if (this.key_handler) {
            window.removeEventListener("keydown", this.key_handler);
            this.key_handler = null;
        }

        if (this.audio_context && this.audio_context.state !== "closed") {
            this.audio_context.close().catch(() => {});
        }

        this.renderer = null;
        this.resources = null;
        this.is_loaded_flag = false;
        this.listeners.clear();
    }

    // getters
    get current_time(): number {
        return this.audio.current_time;
    }

    get duration(): number {
        return this.audio.duration || this.get_last_object_time();
    }

    get is_playing(): boolean {
        return this.audio.is_playing;
    }

    get is_loaded(): boolean {
        return this.is_loaded_flag;
    }

    get mode(): string {
        if (!this.resources) {
            return "standard";
        }
        switch (this.resources.beatmap.mode) {
            case 1:
                return "taiko";
            case 2:
                return "catch";
            case 3:
                return "mania";
            default:
                return "standard";
        }
    }

    get beatmap(): IBeatmap | null {
        return this.resources?.beatmap ?? null;
    }

    get available_difficulties(): IBeatmapInfo[] {
        return this.resources?.available_difficulties ?? [];
    }

    get background(): Blob | undefined {
        return this.resources?.background;
    }

    get config(): IRendererConfig {
        return this.renderer_config;
    }

    resize(width: number, height: number, playfield_scale?: number): void {
        this.backend.resize(width, height);
        this.calculate_layout(width, height, playfield_scale);

        if (this.is_loaded_flag) {
            requestAnimationFrame(() => this.render_frame(this.current_time));
        }
    }

    update_config(config: Partial<IRendererConfig>): void {
        this.renderer_config = { ...this.renderer_config, ...config };
        this.renderer?.update_config(this.renderer_config);

        if (this.is_loaded_flag) {
            requestAnimationFrame(() => this.render_frame(this.current_time));
        }
    }

    set_skin(skin: Partial<ISkinConfig>): void {
        this.skin = merge_skin(skin);

        // renderer needs to be recreated with new skin
        if (this.is_loaded_flag && this.resources?.beatmap) {
            this.renderer = this.create_renderer(this.resources.beatmap);
            this.renderer.initialize(this.resources.beatmap);
            requestAnimationFrame(() => this.render_frame(this.current_time));
        }
    }

    private setup_auto_resize(): void {
        this.resize_observer = new ResizeObserver(() => {
            const canvas = this.options.canvas;
            const parent = canvas.parentElement;
            if (parent) {
                const rect = parent.getBoundingClientRect();
                // do not manually set canvas.width/height here,
                // let this.resize -> backend.resize handle it with DPR
                this.resize(rect.width, rect.height, this.options.playfield_scale);
            }
        });
        this.resize_observer.observe(this.options.canvas.parentElement || this.options.canvas);
    }

    toggle_pause(): void {
        if (!this.is_loaded_flag) {
            return;
        }
        if (this.is_playing) {
            this.pause();
        } else {
            this.play();
        }
    }

    toggle_grid(): void {
        if (this.renderer_config.grid_level === 0) {
            this.renderer_config.grid_level = 32;
        } else {
            this.renderer_config.grid_level = 0;
        }
        this.render_frame(this.current_time);
    }

    private calculate_layout(width: number, height: number, playfield_scale?: number): void {
        const target_width = 512;
        const target_height = 384;

        let fill = 0.9;
        if (Number.isFinite(playfield_scale)) {
            fill = playfield_scale as number;
        }

        // calculate scale based on the smaller dimension to fit playfield
        const scale_x = (width * fill) / target_width;
        const scale_y = (height * fill) / target_height;
        const scale = Math.min(scale_x, scale_y);

        this.renderer_config.scale = scale;
        // pixel-perfect centering
        this.renderer_config.offset_x = Math.floor((width - target_width * scale) / 2);
        this.renderer_config.offset_y = Math.floor((height - target_height * scale) / 2);

        // propagate config to renderer
        if (this.renderer) {
            this.renderer.update_config(this.renderer_config);
        }
    }

    set_volume(volume: number): void {
        this.volume = volume;
        this.audio.set_volume(volume);
        this.hitsounds.set_volume(volume);
    }

    on<E extends PlayerEvent>(event: E, callback: (...args: PlayerEventMap[E]) => void): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(callback);
    }

    off<E extends PlayerEvent>(event: E, callback: Function): void {
        this.listeners.get(event)?.delete(callback);
    }

    private emit<E extends PlayerEvent>(event: E, ...args: PlayerEventMap[E]): void {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            for (const cb of callbacks) {
                (cb as Function)(...args);
            }
        }
    }

    private start_render_loop(): void {
        if (this.animation_frame !== null) {
            return;
        }

        this.last_timestamp = performance.now();
        this.smooth_time = this.audio.current_time;
        this.smoothed_delta = 0;

        const loop = (timestamp: number) => {
            if (!this.audio.is_playing) {
                this.animation_frame = null;
                return;
            }

            // calculate smooth time
            const raw_delta = Math.max(0, timestamp - this.last_timestamp);
            this.last_timestamp = timestamp;

            let delta = Math.min(raw_delta, this.max_frame_delta);
            if (this.time_smoothing > 0) {
                if (this.smoothed_delta === 0) {
                    this.smoothed_delta = delta;
                } else {
                    this.smoothed_delta += (delta - this.smoothed_delta) * this.time_smoothing;
                }
                delta = this.smoothed_delta;
            }

            // advance smooth time by delta * speed
            this.smooth_time += delta * this.audio.speed_multiplier;

            // resync with audio clock if deviation is too large (> 30ms)
            // or periodically to prevent drift
            const actual_audio_time = this.audio.current_time;
            const deviation = Math.abs(this.smooth_time - actual_audio_time);

            if (deviation > RESYNC_THRESHOLD_MS) {
                this.smooth_time = actual_audio_time;
            } else {
                // slowly nudge smooth_time towards actual_audio_time to prevent drift
                this.smooth_time += (actual_audio_time - this.smooth_time) * 0.1;
            }

            const time = this.smooth_time;

            // process hitsounds
            this.schedule_hitsounds(time);

            this.render_frame(time);
            this.video?.sync(time);
            this.emit("timeupdate", time, this.duration);

            if (time >= this.duration) {
                this.emit("ended");
                this.stop_render_loop();
                this.emit("statechange", false);
                return;
            }

            this.animation_frame = requestAnimationFrame(loop);
        };

        this.animation_frame = requestAnimationFrame(loop);
    }

    private schedule_hitsounds(time: number): void {
        if (!this.resources?.beatmap || !this.audio.is_playing) {
            return;
        }

        const objects = this.resources.beatmap.objects;
        const schedule_window = time + HITSOUND_LOOKAHEAD_MS;

        while (this.next_hit_object_index < objects.length && objects[this.next_hit_object_index].time <= schedule_window) {
            const obj = objects[this.next_hit_object_index];

            // only play if it hasn't passed by too much
            // but we rely on update_hit_index to skip old ones on seek
            if (obj.time >= time - HIT_WINDOW_MS) {
                this.play_hitsound(obj);
            }

            this.next_hit_object_index++;
        }
    }

    private play_hitsound(obj: IHitObject): void {
        const timing = this.get_timing_point(obj.time);

        // default values from timing point
        let volume = timing.volume;
        let normal_set = timing.sample_set;
        let addition_set = timing.sample_set; // Additions default to current set
        let index = timing.sample_index;
        let custom_filename: string | undefined = undefined;

        // override from HitObject specific HitSample
        if (obj.hit_sample) {
            const sample = obj.hit_sample;

            if (sample.normal_set !== SampleSet.Auto) {
                normal_set = sample.normal_set;
                // if normal set is explicitly set, addition set defaults to it (if Auto)
                if (sample.addition_set === SampleSet.Auto) {
                    addition_set = normal_set;
                }
            }

            if (sample.addition_set !== SampleSet.Auto) {
                addition_set = sample.addition_set;
            }

            if (sample.index !== 0) {
                index = sample.index;
            }
            if (sample.volume !== 0) {
                volume = sample.volume;
            }
            custom_filename = sample.filename;
        }

        // fallbacks for Auto values
        if (normal_set === SampleSet.Auto) {
            normal_set = SampleSet.Normal;
        }
        if (addition_set === SampleSet.Auto) {
            addition_set = normal_set;
        }

        // calculate exact AudioContext time for this object
        const when = this.audio.get_host_time(obj.time);

        this.hitsounds.play(normal_set, addition_set, obj.hit_sound, index, volume, custom_filename, when);
    }

    private get_timing_point(time: number): ITimingPoint {
        const points = this.resources?.beatmap.timing_points ?? [];
        for (let i = points.length - 1; i >= 0; i--) {
            if (points[i].time <= time) {
                return points[i];
            }
        }
        return points[0];
    }

    private stop_render_loop(): void {
        if (this.animation_frame !== null) {
            cancelAnimationFrame(this.animation_frame);
            this.animation_frame = null;
        }
    }

    private render_frame(time: number): void {
        this.backend.clear();
        this.renderer?.render(time);

        // fps tracking
        if (this.enable_fps_counter) {
            this.fps_frame_count++;
            const now = performance.now();
            const delta = now - this.fps_last_update;

            if (delta >= 1000) {
                this.current_fps = Math.round((this.fps_frame_count * 1000) / delta);
                this.fps_frame_count = 0;
                this.fps_last_update = now;
            }

            this.backend.draw_text(`${this.current_fps} FPS`, 10, 20, "14px monospace", "rgba(255,255,255,0.8)", "left", "top");
        }
    }

    set_fps_counter(enabled: boolean): void {
        this.enable_fps_counter = enabled;
    }
}
