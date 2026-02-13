import type { IBeatmap, ITimingPoint } from "../../types/beatmap";
import { is_circle, is_slider, is_spinner, is_new_combo } from "../../types/beatmap";
import { Mods, has_mod } from "../../types/mods";
import { calculate_preempt, calculate_fade_in, calculate_radius } from "../../math/difficulty";
import { get_adjusted_difficulty } from "../../mods";
import { clamp, type Vec2 } from "../../math/vector2";
import { BaseRenderer, type IRendererConfig, DEFAULT_RENDERER_CONFIG } from "../base_renderer";
import type { IRenderBackend } from "../backend/render_backend";
import type { ISkinConfig } from "../../skin/skin_config";
import { get_combo_color } from "../../skin/skin_config";
import { Drawable, DrawableHitCircle, DrawableSlider, type DrawableConfig } from "../drawable";
import { Easing } from "../drawable/transforms";
import { FollowPointRenderer } from "./follow_points";
import { compute_slider_path, get_slider_end_position } from "./slider_path";
import { calculate_slider_duration, calculate_tick_spacing } from "./slider_math";
import { TimingStateResolver } from "./timing_state";
import { process_timing_points } from "../../beatmap/timing";
import type { RenderHitObject, RenderSliderData } from "../render_types";
import { build_render_objects } from "../render_objects";

const flip_y = (y: number): number => 384 - y;

export class StandardRenderer extends BaseRenderer {
    private radius = 32;
    private preempt = 1200;
    private fade_in = 600;
    private timing_points: ITimingPoint[] = [];
    private timing_resolver: TimingStateResolver | null = null;

    private drawables: Drawable[] = [];
    private drawable_config!: DrawableConfig;
    private follow_point_renderer: FollowPointRenderer;

    constructor(backend: IRenderBackend, skin: ISkinConfig, mods: number = 0, config: IRendererConfig = DEFAULT_RENDERER_CONFIG) {
        super(backend, skin, mods, config);
        this.follow_point_renderer = new FollowPointRenderer(skin, mods, this.preempt, this.fade_in, this.radius);
    }

    initialize(beatmap: IBeatmap): void {
        this.release_drawables();

        this.beatmap = beatmap;
        this.objects = build_render_objects(beatmap).sort((a: RenderHitObject, b: RenderHitObject) => a.time - b.time);
        this.timing_points = process_timing_points([...beatmap.TimingPoints]);
        this.timing_resolver = new TimingStateResolver(this.timing_points);

        const ar = beatmap.Difficulty.ApproachRate >= 0 ? beatmap.Difficulty.ApproachRate : beatmap.Difficulty.OverallDifficulty;
        const difficulty = get_adjusted_difficulty(beatmap.Difficulty.CircleSize, ar, 0, 0, this.mods);
        this.radius = calculate_radius(difficulty.cs);
        this.preempt = calculate_preempt(difficulty.ar);
        this.fade_in = calculate_fade_in(this.preempt);
        if (has_mod(this.mods, Mods.Hidden)) {
            this.fade_in = this.preempt * 0.4;
        }

        this.follow_point_renderer.update_settings(this.mods, this.preempt, this.fade_in, this.radius);

        this.preprocess_objects();
        this.follow_point_renderer.build(this.objects);
        this.create_drawables();
    }

    set_mods(mods: number): void {
        this.mods = mods;
        if (this.beatmap) {
            this.initialize(this.beatmap);
        }
    }

    private preprocess_objects(): void {
        let combo_number = 0;
        let combo_count = 1;
        if (this.timing_resolver) {
            this.timing_resolver.reset();
        }

        for (const obj of this.objects) {
            if (is_new_combo(obj)) {
                combo_number = (combo_number + 1) % this.skin.combo_colors.length;
                combo_count = 1;
            } else {
                combo_count++;
            }
            obj.combo_number = combo_number;
            obj.combo_count = combo_count;

            if (is_slider(obj)) {
                const data = obj.data as RenderSliderData;

                if (has_mod(this.mods, Mods.HardRock)) {
                    data.pos = [data.pos[0], flip_y(data.pos[1])];
                    data.control_points = data.control_points.map((p) => [p[0], flip_y(p[1])] as [number, number]);
                }

                data.computed_path = compute_slider_path(data);

                const timing_state = this.timing_resolver?.get_state_at(obj.time) ?? { base_beat_length: 600, sv_multiplier: 1 };
                const duration = calculate_slider_duration(data.distance, this.beatmap, timing_state);

                data.duration = duration;
                obj.end_time = obj.time + duration * data.repetitions;
                obj.end_pos = get_slider_end_position(data);
            } else if (is_spinner(obj)) {
                obj.end_pos = [256, 192];
            } else {
                const data = obj.data as { pos: Vec2 };
                if (has_mod(this.mods, Mods.HardRock)) {
                    data.pos = [data.pos[0], flip_y(data.pos[1])];
                }
                obj.end_pos = data.pos;
            }
        }
    }

    private create_drawables(): void {
        this.release_drawables();
        const dpr = this.config.use_high_dpi ? window.devicePixelRatio || 1 : 1;
        this.drawable_config = {
            backend: this.backend,
            skin: this.skin,
            preempt: this.preempt,
            fade_in: this.fade_in,
            radius: this.radius,
            scale: this.config.scale * dpr,
            mods: this.mods
        };

        if (this.timing_resolver) {
            this.timing_resolver.reset();
        }

        for (const obj of this.objects) {
            if (is_circle(obj)) {
                this.drawables.push(new DrawableHitCircle(obj, this.drawable_config));
            } else if (is_slider(obj)) {
                const data = obj.data as RenderSliderData;
                const path = data.computed_path || [];
                const span_duration = data.duration || 0;

                const timing_state = this.timing_resolver?.get_state_at(obj.time) ?? { base_beat_length: 600, sv_multiplier: 1 };
                const { tick_distance, min_distance_from_end } = calculate_tick_spacing(this.beatmap, timing_state);

                this.drawables.push(new DrawableSlider(obj, this.drawable_config, path, span_duration, tick_distance, min_distance_from_end));
            }
        }
    }

    render(time: number): void {
        const { backend, config } = this;

        this.render_background();
        backend.save();
        backend.translate(config.offset_x, config.offset_y);
        backend.scale(config.scale, config.scale);
        this.render_playfield();
        this.render_grid();

        const visible_drawables: Drawable[] = [];
        for (let i = this.drawables.length - 1; i >= 0; i--) {
            const drawable = this.drawables[i];
            if (drawable.is_alive(time)) {
                visible_drawables.push(drawable);
            }
        }

        this.follow_point_renderer.render(time, backend, (t, hit_time) => this.get_circle_alpha(t, hit_time));

        for (const obj of this.objects) {
            if (is_spinner(obj)) {
                const appear_time = obj.time - this.preempt;
                if (time >= appear_time && time <= obj.end_time + 200) {
                    this.draw_spinner(obj, time);
                }
            }
        }

        for (const drawable of visible_drawables) {
            drawable.update(time);
        }

        for (const drawable of visible_drawables) {
            if (drawable instanceof DrawableSlider) {
                drawable.render_body_pass(time);
            }
        }

        for (const drawable of visible_drawables) {
            if (drawable instanceof DrawableSlider) {
                drawable.render_head_pass(time);
            } else {
                drawable.render(time);
            }
        }

        if (!has_mod(this.mods, Mods.Hidden) && this.skin.enable_approach_circle) {
            for (const drawable of visible_drawables) {
                if (time <= drawable.start_time) {
                    this.draw_approach_circle(drawable, time);
                }
            }
        }

        backend.restore();
    }

    precompute(): void {
        // avoid precomputing all slider textures on load.
        // they are prepared lazily in render_body for visible sliders.
    }

    dispose(): void {
        this.release_drawables();
        this.timing_points = [];
        this.timing_resolver = null;
        super.dispose();
    }

    private release_drawables(): void {
        for (const drawable of this.drawables) {
            drawable.dispose();
        }
        this.drawables = [];
    }

    private draw_approach_circle(drawable: Drawable, time: number): void {
        const pos = drawable.position;
        const appear_time = drawable.start_time - this.preempt;

        const fade_duration = Math.min(this.fade_in * 2, this.preempt);
        const fade_progress = clamp((time - appear_time) / fade_duration, 0, 1);
        const opacity = fade_progress * this.skin.approach_circle_opacity;

        const scale_progress = clamp((time - appear_time) / this.preempt, 0, 1);
        const scale = 4 - 3 * scale_progress;

        const combo_color = get_combo_color(this.skin, drawable.combo_number, 1);

        this.backend.save();
        this.backend.set_alpha(opacity);
        this.backend.draw_circle(pos[0], pos[1], this.radius * scale, "transparent", combo_color, this.radius * this.skin.approach_circle_width);
        this.backend.restore();
    }

    private get_circle_alpha(time: number, hit_time: number): number {
        const appear_time = hit_time - this.preempt;
        if (time < appear_time) return 0;

        let alpha = clamp((time - appear_time) / this.fade_in, 0, 1);

        if (has_mod(this.mods, Mods.Hidden)) {
            const fade_out_start = hit_time - this.preempt + this.fade_in;
            const fade_out_duration = this.preempt * 0.3;
            if (time > fade_out_start) {
                const fade_out_progress = clamp((time - fade_out_start) / fade_out_duration, 0, 1);
                alpha *= 1 - fade_out_progress;
            }
        }

        return alpha;
    }

    private draw_spinner(obj: RenderHitObject, time: number): void {
        const appear_time = obj.time - this.preempt;
        let opacity = clamp((time - appear_time) / this.fade_in, 0, 1);

        if (time > obj.end_time) {
            opacity = 1 - Easing.OutCubic(clamp((time - obj.end_time) / 200, 0, 1));
        }
        if (opacity <= 0) return;

        const x = 256;
        const y = 192;
        const duration = obj.end_time - obj.time;
        const progress = clamp((time - obj.time) / duration, 0, 1);

        this.backend.set_alpha(opacity);
        const approach_size = this.skin.spinner_size * (1 - progress);

        if (approach_size > 5) {
            this.backend.begin_path();
            this.backend.arc_to(x, y, approach_size, 0, Math.PI * 2);
            this.backend.stroke_path("rgba(255,255,255,0.6)", 4);
        }

        this.backend.draw_circle(x, y, this.skin.spinner_size, "rgba(0,0,0,0.2)");
        this.backend.draw_circle(x, y, 12, "white");
    }
}
