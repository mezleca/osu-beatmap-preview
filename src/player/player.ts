import type { IBeatmap, ITimingPoint } from "../types/beatmap";
import { GameMode } from "../types/beatmap";
import type { IBeatmapResources } from "../types/resources";
import { type Result, ErrorCode, ok, err } from "../types/result";
import { get_speed_multiplier } from "../types/mods";
import { OszLoader } from "../parser/osz_loader";
import { init_wasm, parse as wasm_parse } from "@rel-packages/osu-beatmap-parser/browser";
import { BaseRenderer, DEFAULT_RENDERER_CONFIG, type IRendererConfig } from "../renderer/base_renderer";
import type { IRenderBackend } from "../renderer/backend/render_backend";
import { CanvasBackend } from "../renderer/backend/canvas_backend";
import { StandardRenderer } from "../renderer/standard/standard_renderer";
import { ManiaRenderer } from "../renderer/mania/mania_renderer";
import { AudioController } from "./audio_controller";
import { VideoController } from "./video_controller";
import { HitsoundController } from "./hitsound_controller";
import { type ISkinConfig, merge_skin } from "../skin/skin_config";
import { BeatmapAssets } from "./beatmap_assets";
import { process_timing_points } from "../beatmap/timing";
import { TimingStateResolver } from "../renderer/standard/timing_state";
import { PlayerHitsoundScheduler } from "./player_hitsound_scheduler";
import { collect_map_custom_hitsound_files } from "./hitsound_file_collector";

const PREVIEW_FALLBACK_RATIO = 0.42;
const RESYNC_THRESHOLD_MS = 30;

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

export type StartMode = "preview" | "beginning" | "custom";

export interface IPlayerOptions {
    canvas: HTMLCanvasElement;
    skin?: Partial<ISkinConfig>;
    mods?: number;
    start_mode?: StartMode;
    start_time?: number;
    autoplay?: boolean;
    volume?: number;
    hitsound_volume?: number;
    audio_offset?: number;
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
    private start_mode: StartMode;
    private custom_start_time: number | null;
    private music_volume: number;
    private hitsound_volume: number;
    private audio_offset: number;
    private background_url: string | null = null;

    private listeners: Map<PlayerEvent, Set<Function>> = new Map();
    private is_loaded_flag: boolean = false;

    private hitsound_scheduler: PlayerHitsoundScheduler;
    private timing_points: ITimingPoint[] = [];
    private timing_resolver: TimingStateResolver | null = null;

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

        this.start_mode = options.start_mode ?? (Number.isFinite(options.start_time) ? "custom" : "preview");
        this.custom_start_time = Number.isFinite(options.start_time) ? Math.max(0, options.start_time as number) : null;
        this.start_offset = 0;
        this.music_volume = options.volume ?? 0.5;
        this.hitsound_volume = options.hitsound_volume ?? 0.25;
        this.audio_offset = options.audio_offset ?? 20;

        // initialize backend with high dpi setting
        this.backend.initialize(options.canvas, this.renderer_config.use_high_dpi);

        // initialize audio system
        // @ts-ignore
        const audio_context_class = window.AudioContext || window.webkitAudioContext;
        this.audio_context = new audio_context_class();

        this.audio = new AudioController(this.audio_context);
        this.hitsounds = new HitsoundController(this.audio_context);
        this.hitsound_scheduler = new PlayerHitsoundScheduler(this.audio, this.hitsounds);

        // set initial volumes
        this.audio.set_volume(this.music_volume);
        this.hitsounds.set_volume(this.hitsound_volume);

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

            return this.setup();
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            this.emit("error", ErrorCode.InvalidBeatmap, reason);
            return err(ErrorCode.InvalidBeatmap, reason);
        }
    }

    async load_default_hitsounds(urls: string[]): Promise<void> {
        if (urls.length == 0) {
            console.warn("[BeatmapPlayer] No default hitsound URLs were provided");
            return;
        }

        try {
            await this.hitsounds.load_default_samples(urls);
        } catch (e) {
            console.error("[BeatmapPlayer] Failed to load default hitsounds:", e);
        }
    }

    async load_custom_hitsounds(urls: string[]): Promise<void> {
        if (urls.length == 0) {
            console.warn("[BeatmapPlayer] No custom hitsound URLs were provided");
            this.hitsounds.clear();
            return;
        }

        try {
            await this.hitsounds.load_samples(urls);
        } catch (e) {
            console.error("[BeatmapPlayer] Failed to load custom hitsounds:", e);
        }
    }

    private async load_map_custom_hitsounds(): Promise<void> {
        if (!this.resources?.beatmap) {
            return;
        }

        const files = collect_map_custom_hitsound_files(this.resources.beatmap, this.resources.files, this.resources.audio_filename);
        if (files.size == 0) {
            this.hitsounds.clear();
            return;
        }

        try {
            await this.hitsounds.load_samples_from_files(files);
        } catch (e) {
            console.error("[BeatmapPlayer] Failed to load map custom hitsounds:", e);
            this.hitsounds.clear();
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
            await init_wasm();
            const beatmap = await this.parse_content(content);
            return this.load_beatmap(beatmap, audio);
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            this.emit("error", ErrorCode.InvalidBeatmap, reason);
            return err(ErrorCode.InvalidBeatmap, reason);
        }
    }

    async load_beatmap_files(
        osu_content: string | Uint8Array | ArrayBuffer,
        audio: ArrayBuffer,
        background?: Blob,
        video?: Blob,
        video_offset?: number
    ): Promise<Result<IBeatmapResources>> {
        try {
            await init_wasm();
            const is_string = typeof osu_content === "string";
            const bytes = osu_content instanceof Uint8Array ? osu_content : osu_content instanceof ArrayBuffer ? new Uint8Array(osu_content) : null;
            const beatmap = await this.parse_content(is_string ? osu_content : (bytes as Uint8Array));

            return this.load_beatmap(beatmap, audio, background, video, video_offset);
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
        this.timing_points = process_timing_points([...beatmap.TimingPoints]);
        this.timing_resolver = new TimingStateResolver(this.timing_points);
        const speed = get_speed_multiplier(this.mods);
        this.resolve_assets();

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

        this.hitsound_scheduler.set_context(this.resources, this.timing_points, this.timing_resolver, this.audio_offset);
        void this.load_map_custom_hitsounds();

        // setup video
        if (video) {
            this.video = new VideoController();
            await this.video.load(video, video_offset ?? 0);
        }

        // create renderer based on mode
        try {
            this.renderer = this.create_renderer(beatmap);
            this.renderer.initialize(beatmap);
            this.renderer.precompute();
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            this.emit("error", ErrorCode.UnsupportedMode, reason);
            return err(ErrorCode.UnsupportedMode, reason);
        }

        this.start_offset = this.resolve_initial_start_offset();

        this.hitsound_scheduler.update_hit_index(this.start_offset);
        void this.load_background();

        this.is_loaded_flag = true;
        this.emit("loaded", beatmap, this.resources);
        requestAnimationFrame(() => this.render_frame(this.start_offset));

        return ok(this.resources);
    }

    async load_background(): Promise<void> {
        if (this.resources) {
            this.resolve_assets();
        }
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

            const target_time = this.audio.is_playing ? this.current_time : this.start_offset;
            requestAnimationFrame(() => this.render_frame(target_time));
        } catch (e) {
            console.warn("[BeatmapPlayer] Failed to load background", e);
        }
    }

    private resolve_assets(): void {
        if (!this.resources) {
            return;
        }

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
    }

    private create_renderer(beatmap: IBeatmap): BaseRenderer {
        switch (beatmap.General.Mode) {
            case GameMode.Standard:
                return new StandardRenderer(this.backend, this.skin, this.mods, this.renderer_config);
            case GameMode.Mania:
                return new ManiaRenderer(this.backend, this.skin, this.mods, this.renderer_config);
            case GameMode.Taiko:
            case GameMode.Catch:
            default:
                throw new Error(`Unsupported game mode: ${GameMode[beatmap.General.Mode] ?? beatmap.General.Mode}`);
        }
    }

    private get_last_object_time(): number {
        if (!this.resources?.beatmap.HitObjects.length) {
            return 0;
        }
        const objects = this.resources.beatmap.HitObjects;
        let max_time = 0;
        for (const obj of objects) {
            const end_time = obj.endTime || obj.time;
            if (end_time > max_time) max_time = end_time;
        }
        return max_time;
    }

    private resolve_preview_start_offset(): number {
        if (!this.resources?.beatmap) {
            return 0;
        }

        const preview = this.resources.beatmap.General.PreviewTime;
        if (preview > 0) {
            return preview;
        }

        return Math.max(0, this.get_last_object_time() * PREVIEW_FALLBACK_RATIO);
    }

    private resolve_initial_start_offset(): number {
        const max_duration = Math.max(0, this.duration);

        if (this.start_mode == "beginning") {
            return 0;
        }

        if (this.start_mode == "custom") {
            if (this.custom_start_time !== null) {
                return Math.max(0, Math.min(this.custom_start_time, max_duration));
            }

            return Math.max(0, Math.min(this.resolve_preview_start_offset(), max_duration));
        }

        return Math.max(0, Math.min(this.resolve_preview_start_offset(), max_duration));
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

        try {
            await this.audio.play(Math.max(0, this.start_offset + this.audio_offset));
        } catch (e) {
            console.warn("[BeatmapPlayer] Failed to start audio", e);
            this.emit("statechange", false);
            return;
        }
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
        this.start_offset = Math.max(0, this.audio.current_time - this.audio_offset);

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

        if (this.is_loaded_flag) {
            requestAnimationFrame(() => this.render_frame(this.current_time));
        }
    }

    seek(time_ms: number): void {
        // update start offset for both playing and paused states
        this.start_offset = Math.max(0, Math.min(time_ms, this.duration));

        this.hitsound_scheduler.update_hit_index(this.start_offset);

        this.audio.seek(Math.max(0, this.start_offset + this.audio_offset));
        this.video?.seek(this.start_offset);

        this.emit("seek", this.start_offset);

        // render frame at new position
        this.render_frame(this.start_offset);
        this.renderer?.on_seek(this.start_offset);
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

    private async parse_content(content: string | Uint8Array): Promise<IBeatmap> {
        const data = typeof content == "string" ? new TextEncoder().encode(content) : content;
        return (await wasm_parse(data)) as IBeatmap;
    }

    stop(): void {
        this.pause();
        this.start_offset = 0;
        this.audio.seek(Math.max(0, this.audio_offset));
        this.hitsound_scheduler.update_hit_index(0);
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
        return Math.max(0, this.audio.current_time - this.audio_offset);
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
        switch (this.resources.beatmap.General.Mode) {
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

    get available_difficulties(): { filename: string; beatmap: IBeatmap }[] {
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
        this.music_volume = volume;
        this.audio.set_volume(volume);
    }

    set_hitsound_volume(volume: number): void {
        this.hitsound_volume = volume;
        this.hitsounds.set_volume(volume);
    }

    set_offset(offset_ms: number): void {
        this.audio_offset = offset_ms;
        this.hitsound_scheduler.set_audio_offset(offset_ms);
        if (this.is_loaded_flag) {
            this.seek(this.current_time);
        }
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
        this.smooth_time = this.audio.current_time - this.audio_offset;
        this.smoothed_delta = 0;

        const loop = (timestamp: number) => {
            if (!this.audio.is_playing) {
                this.animation_frame = null;
                return;
            }

            // smooth time follows render delta but is nudged toward audio clock to prevent drift
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
            const actual_audio_time = this.audio.current_time - this.audio_offset;
            const deviation = Math.abs(this.smooth_time - actual_audio_time);

            if (deviation > RESYNC_THRESHOLD_MS) {
                this.smooth_time = actual_audio_time;
            } else {
                // slowly nudge smooth_time towards actual_audio_time to prevent drift
                this.smooth_time += (actual_audio_time - this.smooth_time) * 0.1;
            }

            const time = this.smooth_time;

            this.hitsound_scheduler.schedule_hitsounds(actual_audio_time);

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

    private stop_render_loop(): void {
        if (this.animation_frame !== null) {
            cancelAnimationFrame(this.animation_frame);
            this.animation_frame = null;
        }
    }

    private render_frame(time: number): void {
        this.backend.begin_frame?.();
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

            const fps_font = `14px ${this.skin.default_font ?? "monospace"}`;
            this.backend.draw_text(`${this.current_fps} FPS`, 10, 20, fps_font, "rgba(255,255,255,0.8)", "left", "top");
        }

        this.backend.end_frame?.();
    }

    set_fps_counter(enabled: boolean): void {
        this.enable_fps_counter = enabled;
    }
}
