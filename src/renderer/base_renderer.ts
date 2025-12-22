import type { IRenderBackend } from "./backend/render_backend";
import type { IBeatmap, IHitObject } from "../types/beatmap";
import type { ISkinConfig } from "../skin/skin_config";

// osu! playfield is 512x384 in osu! pixels
export const PLAYFIELD_WIDTH = 512;
export const PLAYFIELD_HEIGHT = 384;

// grid levels (like in osu! editor)
export enum GridLevel {
    None = 0,
    Large = 32,
    Medium = 16,
    Small = 8,
    Tiny = 4
}

export interface IRendererConfig {
    // playfield offset from canvas origin
    offset_x: number;
    offset_y: number;

    // scale factor for playfield
    scale: number;

    // show playfield border
    show_playfield: boolean;
    playfield_color: string;
    playfield_opacity: number;

    // grid overlay
    grid_level: GridLevel;
    grid_color: string;
    grid_opacity: number;

    // high DPI rendering (device pixel ratio)
    use_high_dpi: boolean;
}

export const DEFAULT_RENDERER_CONFIG: IRendererConfig = {
    offset_x: 64,
    offset_y: 48,
    scale: 1,

    show_playfield: true,
    playfield_color: "#ffffff",
    playfield_opacity: 0.1,

    grid_level: GridLevel.None,
    grid_color: "#ffffff",
    grid_opacity: 0.35,

    use_high_dpi: true
};

export abstract class BaseRenderer {
    protected backend: IRenderBackend;
    protected skin: ISkinConfig;
    protected config: IRendererConfig;
    protected mods: number;

    protected beatmap!: IBeatmap;
    protected objects: IHitObject[] = [];
    protected background_image: CanvasImageSource | null = null;

    constructor(backend: IRenderBackend, skin: ISkinConfig, mods: number = 0, config: IRendererConfig = DEFAULT_RENDERER_CONFIG) {
        this.backend = backend;
        this.skin = skin;
        this.mods = mods;
        this.config = { ...DEFAULT_RENDERER_CONFIG, ...config };
    }

    set_background(image: CanvasImageSource | null): void {
        this.background_image = image;
    }

    update_config(config: Partial<IRendererConfig>): void {
        this.config = { ...this.config, ...config };
    }

    abstract initialize(beatmap: IBeatmap): void;
    abstract render(time: number): void;

    // update mods and recalculate difficulty attributes
    abstract set_mods(mods: number): void;

    dispose(): void {
        this.objects = [];
    }

    // render playfield border
    protected render_playfield(custom_w?: number, custom_h?: number, custom_x?: number, custom_y?: number): void {
        if (!this.config.show_playfield) return;

        const { backend, config } = this;
        const w = custom_w ?? PLAYFIELD_WIDTH;
        const h = custom_h ?? PLAYFIELD_HEIGHT;
        const x = custom_x ?? 0;
        const y = custom_y ?? 0;

        backend.save();
        backend.set_alpha(config.playfield_opacity);

        // draw border box
        backend.begin_path();
        backend.move_to(x, y);
        backend.line_to(x + w, y);
        backend.line_to(x + w, y + h);
        backend.line_to(x, y + h);
        backend.line_to(x, y);
        backend.stroke_path(config.playfield_color, 2);

        backend.restore();
    }

    // render grid overlay
    protected render_grid(): void {
        if (this.config.grid_level === GridLevel.None) return;

        const { backend, config } = this;
        const spacing = config.grid_level as number;

        backend.save();
        backend.set_alpha(config.grid_opacity);

        // vertical lines
        for (let x = 0; x <= PLAYFIELD_WIDTH; x += spacing) {
            backend.begin_path();
            backend.move_to(x, 0);
            backend.line_to(x, PLAYFIELD_HEIGHT);
            backend.stroke_path(config.grid_color, x % (spacing * 4) === 0 ? 1 : 0.5);
        }

        // horizontal lines
        for (let y = 0; y <= PLAYFIELD_HEIGHT; y += spacing) {
            backend.begin_path();
            backend.move_to(0, y);
            backend.line_to(PLAYFIELD_WIDTH, y);
            backend.stroke_path(config.grid_color, y % (spacing * 4) === 0 ? 1 : 0.5);
        }

        backend.restore();
    }

    protected render_background(): void {
        if (!this.background_image) return;

        const { backend } = this;
        backend.save();
        backend.set_alpha(0.3); // dim background

        const canvas_w = backend.width;
        const canvas_h = backend.height;
        const img_w = (this.background_image as any).width || 0;
        const img_h = (this.background_image as any).height || 0;

        if (img_w > 0 && img_h > 0) {
            // "cover" scaling logic:
            // maintain aspect ratio but fill the entire area
            const scale = Math.max(canvas_w / img_w, canvas_h / img_h);
            const draw_w = img_w * scale;
            const draw_h = img_h * scale;
            const x = (canvas_w - draw_w) / 2;
            const y = (canvas_h - draw_h) / 2;

            backend.draw_image(this.background_image, x, y, draw_w, draw_h);
        } else {
            // fallback to stretch if dimensions unknown
            backend.draw_image(this.background_image, 0, 0, canvas_w, canvas_h);
        }

        backend.restore();
    }

    protected get_visible_objects(time: number, preempt: number, fade_out: number): IHitObject[] {
        const visible: IHitObject[] = [];

        for (const obj of this.objects) {
            const appear_time = obj.time - preempt;
            const disappear_time = obj.end_time + fade_out;

            if (time >= appear_time && time <= disappear_time) {
                visible.push(obj);
            }
        }

        return visible;
    }
}
