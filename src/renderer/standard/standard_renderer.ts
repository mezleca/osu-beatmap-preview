import type { IBeatmap, IHitObject, ISliderData, ITimingPoint } from "../../types/beatmap";
import { is_circle, is_slider, is_spinner, is_new_combo } from "../../types/beatmap";
import { Mods } from "../../types/mods";
import { calculate_preempt, calculate_fade_in, calculate_radius } from "../../math/difficulty";
import { get_adjusted_difficulty, get_rate_multiplier } from "../../mods";
import { flatten_bezier, flatten_linear, flatten_perfect, flatten_catmull } from "../../math/curves";
import { vec2_sub, vec2_len, vec2_lerp, vec2_normalize, lerp, clamp, type Vec2 } from "../../math/vector2";
import { BaseRenderer, type IRendererConfig, DEFAULT_RENDERER_CONFIG } from "../base_renderer";
import type { IRenderBackend } from "../backend/render_backend";
import type { ISkinConfig } from "../../skin/skin_config";
import { get_combo_color } from "../../skin/skin_config";

const ease_out_cubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const flip_y = (y: number): number => 384 - y;

export class StandardRenderer extends BaseRenderer {
    private radius: number = 32;
    private preempt: number = 1200;
    private fade_in: number = 600;
    private timing_points: ITimingPoint[] = [];
    private use_hidden: boolean = false;
    private use_hard_rock: boolean = false;

    // cache for rendered sliders (to avoid expensive masking every frame)
    private slider_cache: Map<
        IHitObject,
        {
            canvas: HTMLCanvasElement;
            scale: number;
            min_x: number;
            min_y: number;
        }
    > = new Map();

    constructor(backend: IRenderBackend, skin: ISkinConfig, mods: number = 0, config: IRendererConfig = DEFAULT_RENDERER_CONFIG) {
        super(backend, skin, mods, config);
        this.use_hidden = (mods & Mods.Hidden) !== 0;
        this.use_hard_rock = (mods & Mods.HardRock) !== 0;
    }

    initialize(beatmap: IBeatmap): void {
        this.beatmap = beatmap;
        // deep copy objects to prevent permanent modification (prevents double-flipping with HR)
        // ensure objects are sorted by time for consistent rendering order (z-index)
        this.objects = JSON.parse(JSON.stringify(beatmap.objects)).sort((a: IHitObject, b: IHitObject) => a.time - b.time);
        this.timing_points = this.process_timing_points([...beatmap.timing_points]);

        // clear caches when map changes
        this.slider_cache.clear();

        const difficulty = get_adjusted_difficulty(beatmap.cs, beatmap.ar, beatmap.od, beatmap.hp, this.mods);

        this.radius = calculate_radius(difficulty.cs);
        this.preempt = calculate_preempt(difficulty.ar);
        this.fade_in = calculate_fade_in(this.preempt);

        this.preprocess_objects();
    }

    set_mods(mods: number): void {
        this.mods = mods;
        this.use_hidden = (mods & Mods.Hidden) !== 0;
        this.use_hard_rock = (mods & Mods.HardRock) !== 0;

        if (this.beatmap) {
            this.initialize(this.beatmap);
        }
    }

    private process_timing_points(points: ITimingPoint[]): ITimingPoint[] {
        if (points.length === 0) return points;

        points[0].time = 0;
        let base_ms_per_beat = points[0].ms_per_beat;

        for (const point of points) {
            if (point.ms_per_beat < 0) {
                point.ms_per_beat = base_ms_per_beat * (-point.ms_per_beat / 100);
            } else {
                base_ms_per_beat = point.ms_per_beat;
            }
        }

        return points.reverse();
    }

    private preprocess_objects(): void {
        let combo_number = 0;
        let combo_count = 1;

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
                const data = obj.data as ISliderData;

                if (this.use_hard_rock) {
                    data.pos = [data.pos[0], flip_y(data.pos[1])];
                    data.control_points = data.control_points.map((p) => [p[0], flip_y(p[1])] as [number, number]);
                }

                data.computed_path = this.compute_slider_path(data);

                const timing = this.get_timing_at(obj.time);
                const duration = (data.distance / (100 * this.beatmap.sv)) * timing.ms_per_beat;
                data.duration = duration;
                obj.end_time = obj.time + duration * data.repetitions;
                obj.end_pos = this.get_slider_position(data, obj.end_time - obj.time, duration);
            } else if (is_spinner(obj)) {
                obj.end_pos = [256, 192];
            } else {
                const data = obj.data as { pos: Vec2 };

                if (this.use_hard_rock) {
                    data.pos = [data.pos[0], flip_y(data.pos[1])];
                }

                obj.end_pos = data.pos;
            }
        }
    }

    private compute_slider_path(slider: ISliderData): Vec2[] {
        const all_points: Vec2[] = [slider.pos, ...slider.control_points];

        switch (slider.path_type) {
            case "L":
                return flatten_linear(slider.pos, slider.control_points[0], slider.distance);
            case "P":
                return flatten_perfect(all_points, slider.distance);
            case "C":
                return flatten_catmull(all_points);
            case "B":
            default:
                return this.flatten_multibezier(all_points, slider.distance);
        }
    }

    private flatten_multibezier(points: Vec2[], max_distance: number): Vec2[] {
        const segments: Vec2[][] = [];
        let current: Vec2[] = [points[0]];

        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1];
            const cur = points[i];

            if (prev[0] === cur[0] && prev[1] === cur[1]) {
                if (current.length > 1) {
                    segments.push(current);
                }
                current = [cur];
            } else {
                current.push(cur);
            }
        }

        if (current.length > 1) {
            segments.push(current);
        }

        const all_points: Vec2[] = [];
        for (const segment of segments) {
            const flattened = flatten_bezier(segment);
            all_points.push(...flattened);
        }

        return this.clamp_path_to_distance(all_points, max_distance);
    }

    private clamp_path_to_distance(path: Vec2[], max_distance: number): Vec2[] {
        if (path.length < 2) return path;

        const result: Vec2[] = [path[0]];
        let distance = 0;

        for (let i = 1; i < path.length; i++) {
            const segment_length = vec2_len(vec2_sub(path[i], path[i - 1]));

            if (distance + segment_length >= max_distance) {
                const remaining = max_distance - distance;
                const t = remaining / segment_length;
                result.push(vec2_lerp(path[i - 1], path[i], t));
                break;
            }

            distance += segment_length;
            result.push(path[i]);
        }

        return result;
    }

    private get_timing_at(time: number): ITimingPoint {
        for (const point of this.timing_points) {
            if (point.time <= time) {
                return point;
            }
        }
        return this.timing_points[this.timing_points.length - 1];
    }

    render(time: number): void {
        const { backend, config } = this;

        this.render_background();

        backend.save();
        backend.translate(config.offset_x, config.offset_y);
        backend.scale(config.scale, config.scale);

        this.render_playfield();
        this.render_grid();

        // get visible objects sorted by start time (ascending)
        const visible = this.get_visible_objects(time, this.preempt, 200);

        // follow points between adjacent objects
        for (let i = 0; i < visible.length - 1; i++) {
            const obj = visible[i];
            const next = visible[i + 1];
            if (!is_spinner(obj) && !is_spinner(next)) {
                this.draw_follow_point(obj, next, time);
            }
        }

        // draw each object in reverse time order (later first = at back, earlier on top)
        visible.reverse();
        for (const obj of visible) {
            if (is_slider(obj)) {
                this.draw_slider(obj, time);
                if (!this.use_hidden && time <= obj.time) {
                    this.draw_approach_circle(obj, time);
                }
            } else if (is_circle(obj)) {
                this.draw_hit_circle(obj, time);
                if (!this.use_hidden && time <= obj.time) {
                    this.draw_approach_circle(obj, time);
                }
            } else if (is_spinner(obj)) {
                this.draw_spinner(obj, time);
            }

            // follow circle for active sliders
            if (is_slider(obj) && time > obj.time && time <= obj.end_time) {
                this.draw_follow_circle(obj, time);
            }
        }

        backend.restore();
    }

    private get_circle_opacity(obj: IHitObject, time: number): number {
        const appear_time = obj.time - this.preempt;

        if (this.use_hidden) {
            const hd_fade_in = this.preempt * 0.4;
            const fade_out_start = appear_time + hd_fade_in;
            const fade_out_duration = this.preempt * 0.3;

            if (time < appear_time) return 0;
            if (time < fade_out_start) {
                return clamp((time - appear_time) / hd_fade_in, 0, 1);
            }
            const fade_t = clamp((time - fade_out_start) / fade_out_duration, 0, 1);
            return 1 - fade_t;
        }

        if (time < appear_time) return 0;
        let opacity = clamp((time - appear_time) / this.fade_in, 0, 1);

        // fade out after hit (150ms)
        if (time > obj.end_time) {
            const fade_t = clamp((time - obj.end_time) / 150, 0, 1);
            opacity = 1 - ease_out_cubic(fade_t);
        }

        return clamp(opacity, 0, 1);
    }

    private get_slider_body_opacity(obj: IHitObject, time: number): number {
        const appear_time = obj.time - this.preempt;

        if (this.use_hidden) {
            // HD: "long fade" - fades out gradually from fade_in completion until slider ends
            const hd_fade_in = this.preempt * 0.4;
            const fade_in_complete_time = appear_time + hd_fade_in;

            if (time < appear_time) return 0;

            // fade in
            if (time < fade_in_complete_time) {
                return clamp((time - appear_time) / hd_fade_in, 0, 1);
            }

            // gradual fade out from fade_in completion until slider ends
            const fade_out_duration = obj.end_time - fade_in_complete_time;
            const progress = clamp((time - fade_in_complete_time) / fade_out_duration, 0, 1);
            return 1 - progress;
        }

        // normal mode
        if (time < appear_time) return 0;
        let opacity = clamp((time - appear_time) / this.fade_in, 0, 1);

        // fade out after slider ends
        if (time > obj.end_time) {
            const fade_t = clamp((time - obj.end_time) / 200, 0, 1);
            opacity = 1 - ease_out_cubic(fade_t);
        }

        return clamp(opacity, 0, 1);
    }

    private draw_approach_circle(obj: IHitObject, time: number): void {
        if (this.use_hidden) return;

        const { backend, skin, radius, preempt, fade_in } = this;
        const pos = (obj.data as { pos: Vec2 }).pos;
        const appear_time = obj.time - preempt;

        if (time < appear_time || time > obj.time) return;

        const progress = (obj.time - time) / preempt;
        // approach circle: 4x scale at appear_time → 1x at hit time (lazer behavior)
        const scale = 1 + progress * 3;
        const size = radius * scale;

        const opacity_duration = Math.min(fade_in * 2, preempt);
        const opacity = clamp((time - appear_time) / opacity_duration, 0, 0.9);

        backend.set_alpha(opacity);
        backend.draw_circle(pos[0], pos[1], size, "transparent", get_combo_color(skin, obj.combo_number, 1), radius * skin.approach_circle_width);
        backend.set_alpha(1);
    }

    private draw_hit_circle(obj: IHitObject, time: number): void {
        const { backend, skin, radius } = this;

        const pos = (obj.data as { pos: Vec2 }).pos;
        const appear_time = obj.time - this.preempt;
        const hit_anim_duration = 240;

        // skip if not visible yet
        if (time < appear_time) return;
        // skip if hit animation is finished
        if (time > obj.end_time + hit_anim_duration) return;

        let opacity = 1;
        let scale = 1;

        // fade in phase
        if (time < obj.time) {
            if (this.use_hidden) {
                const hd_fade_in = this.preempt * 0.4;
                const fade_out_start = appear_time + hd_fade_in;
                const fade_out_duration = this.preempt * 0.3;

                if (time < fade_out_start) {
                    opacity = clamp((time - appear_time) / hd_fade_in, 0, 1);
                } else {
                    const fade_t = clamp((time - fade_out_start) / fade_out_duration, 0, 1);
                    opacity = 1 - fade_t;
                }
            } else {
                opacity = clamp((time - appear_time) / this.fade_in, 0, 1);
            }
        }
        // hit animation phase (after hit time)
        else {
            const t = clamp((time - obj.end_time) / hit_anim_duration, 0, 1);
            // scale up to 1.4x with easing out
            scale = 1 + 0.4 * ease_out_cubic(t);
            // fade out
            opacity = 1 - ease_out_cubic(t);
        }

        if (opacity <= 0) return;

        const scaled_radius = radius * scale;
        const circle_size = scaled_radius * (1 - skin.circle_border_width / 2);
        const border_width = scaled_radius * skin.circle_border_width;

        backend.set_alpha(opacity * skin.hit_circle_opacity);

        backend.draw_circle(pos[0], pos[1], circle_size, get_combo_color(skin, obj.combo_number, 1), "rgba(255,255,255,1)", border_width);

        // only draw number before hit
        if (time < obj.time) {
            const font_size = radius * 0.8;
            backend.draw_text(
                String(obj.combo_count),
                pos[0],
                pos[1],
                `600 ${font_size}px ${skin.font_family}`,
                "rgba(255,255,255,1)",
                "center",
                "middle"
            );
        }

        backend.set_alpha(1);
    }

    private draw_slider(obj: IHitObject, time: number): void {
        const { backend, skin, radius } = this;
        const data = obj.data as ISliderData;
        const path = data.computed_path;

        if (!path || path.length < 2) {
            return;
        }

        const body_opacity = this.get_slider_body_opacity(obj, time);

        if (body_opacity <= 0.01) {
            return;
        }

        const border_portion = 0.128;
        const body_radius = radius * (1 - border_portion);
        const combo_color = get_combo_color(skin, obj.combo_number, 1);

        // if using transparency, we need to mask out the border center to avoid it bleeding through
        if (skin.slider_body_opacity < 1 && skin.slider_border_opacity > 0) {
            this.draw_masked_slider(obj, path, radius, body_radius, combo_color, body_opacity);
        } else {
            // standard drawing (fast path)
            backend.save();

            // white border
            backend.set_alpha(body_opacity * skin.slider_border_opacity);
            backend.begin_path();
            backend.move_to(path[0][0], path[0][1]);

            for (let i = 1; i < path.length; i++) {
                backend.line_to(path[i][0], path[i][1]);
            }

            backend.stroke_path("rgba(255,255,255,1)", radius * 2, "round", "round");

            // solid body color
            backend.set_alpha(body_opacity * skin.slider_body_opacity);
            backend.begin_path();
            backend.move_to(path[0][0], path[0][1]);

            for (let i = 1; i < path.length; i++) {
                backend.line_to(path[i][0], path[i][1]);
            }

            backend.stroke_path(combo_color, body_radius * 2, "round", "round");
            backend.restore();
            backend.set_alpha(body_opacity);
        }

        this.draw_slider_ticks(obj, data, path, time);

        if (data.repetitions > 1) {
            this.handle_reverse_arrows(obj, data, path, time);
        }

        const appear_time = obj.time - this.preempt;
        const HIT_ANIMATION_DURATION = 150;

        let head_opacity = 0;
        let head_scale = 1;

        if (this.use_hidden) {
            const hd_fade_in = this.preempt * 0.4;
            const fade_out_start = appear_time + hd_fade_in;
            const fade_out_duration = this.preempt * 0.3;

            if (time < appear_time) {
                head_opacity = 0;
            } else if (time < obj.time) {
                // fade in until hit time
                if (time < fade_out_start) {
                    head_opacity = clamp((time - appear_time) / hd_fade_in, 0, 1);
                } else {
                    const fade_t = clamp((time - fade_out_start) / fade_out_duration, 0, 1);
                    head_opacity = 1 - fade_t;
                }
            } else if (time < obj.time + HIT_ANIMATION_DURATION) {
                // calculate opacity at hit time (obj.time)
                let opacity_at_hit = 0;
                if (obj.time < fade_out_start) {
                    opacity_at_hit = clamp((obj.time - appear_time) / hd_fade_in, 0, 1);
                } else {
                    const fade_t = clamp((obj.time - fade_out_start) / fade_out_duration, 0, 1);
                    opacity_at_hit = 1 - fade_t;
                }

                // hit animation: fade out from current opacity
                const hit_progress = (time - obj.time) / HIT_ANIMATION_DURATION;
                head_opacity = opacity_at_hit * (1 - ease_out_cubic(hit_progress));
                head_scale = 1 + ease_out_cubic(hit_progress) * 0.4;
            }
        } else {
            if (time < appear_time) {
                head_opacity = 0;
            } else if (time < obj.time) {
                // fade in until hit time
                head_opacity = clamp((time - appear_time) / this.fade_in, 0, 1);
            } else if (time < obj.time + HIT_ANIMATION_DURATION) {
                // calculate opacity at hit time
                const opacity_at_hit = clamp((obj.time - appear_time) / this.fade_in, 0, 1);

                // hit animation: fade out + slight scale up
                const hit_progress = (time - obj.time) / HIT_ANIMATION_DURATION;
                head_opacity = opacity_at_hit * (1 - ease_out_cubic(hit_progress));
                head_scale = 1 + ease_out_cubic(hit_progress) * 0.4;
            }
        }

        if (head_opacity > 0) {
            const pos = data.pos;
            const circle_size = radius * (1 - skin.circle_border_width / 2) * head_scale;
            const border_width = radius * skin.circle_border_width * head_scale;

            backend.set_alpha(head_opacity * skin.hit_circle_opacity);

            backend.draw_circle(pos[0], pos[1], circle_size, get_combo_color(skin, obj.combo_number, 1), "rgba(255,255,255,1)", border_width);

            const font_size = radius * 0.8 * head_scale;
            backend.draw_text(
                String(obj.combo_count),
                pos[0],
                pos[1],
                `600 ${font_size}px ${skin.font_family}`,
                "rgba(255,255,255,1)",
                "center",
                "middle"
            );
        }

        backend.set_alpha(1);
    }

    private handle_reverse_arrows(obj: IHitObject, data: ISliderData, path: Vec2[], time: number): void {
        const { radius } = this;
        const elapsed = Math.max(0, time - obj.time);
        const duration = data.duration!;
        const current_repeat = Math.floor(elapsed / duration);
        const remaining_repeats = data.repetitions - 1 - current_repeat;

        if (remaining_repeats >= 1 && current_repeat % 2 === 0) {
            this.draw_reverse_arrow(path, radius, true);
        }
        if (remaining_repeats >= 1 && current_repeat % 2 === 1) {
            this.draw_reverse_arrow(path, radius, false);
        }
        if (time < obj.time) {
            this.draw_reverse_arrow(path, radius, true);
            if (data.repetitions > 2) {
                this.draw_reverse_arrow(path, radius, false);
            }
        }
    }

    private draw_masked_slider(obj: IHitObject, path: Vec2[], radius: number, body_radius: number, combo_color: string, body_opacity: number): void {
        const { backend, skin, config } = this;

        // check cache
        const cached = this.slider_cache.get(obj);

        // validate cache (must match current scale)
        if (cached && Math.abs(cached.scale - config.scale) < 0.001) {
            // draw cached image
            backend.save();
            if (config.scale !== 0) {
                backend.scale(1 / config.scale, 1 / config.scale);
                backend.translate(-config.offset_x, -config.offset_y);
            }

            // calculate screen position
            const draw_x = Math.floor(cached.min_x * config.scale + config.offset_x);
            const draw_y = Math.floor(cached.min_y * config.scale + config.offset_y);

            // apply global alpha for fade in/out
            backend.set_alpha(body_opacity);
            backend.draw_image(cached.canvas, draw_x, draw_y);
            backend.restore();
            return;
        }

        // --- Cache Miss: Render to new canvas ---

        // calculate bounding box independent of offset (using raw OsuPixels)
        let min_x = Infinity,
            min_y = Infinity,
            max_x = -Infinity,
            max_y = -Infinity;
        for (const p of path) {
            if (p[0] < min_x) min_x = p[0];
            if (p[0] > max_x) max_x = p[0];
            if (p[1] < min_y) min_y = p[1];
            if (p[1] > max_y) max_y = p[1];
        }

        // padding
        const padding = radius + 2;
        min_x -= padding;
        min_y -= padding;
        max_x += padding;
        max_y += padding;

        // dimensions at current scale
        const width = Math.ceil((max_x - min_x) * config.scale);
        const height = Math.ceil((max_y - min_y) * config.scale);

        if (width <= 0 || height <= 0) return;

        // create canvas for this slider
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Render Logic
        ctx.save();

        // Transform: Map OsuPixels to CanvasPixels [0, width]
        ctx.scale(config.scale, config.scale);
        ctx.translate(-min_x, -min_y);

        // trace path
        ctx.beginPath();
        if (path.length > 0) {
            ctx.moveTo(path[0][0], path[0][1]);
            for (let i = 1; i < path.length; i++) {
                ctx.lineTo(path[i][0], path[i][1]);
            }
        }

        // white border (opaque)
        ctx.globalAlpha = skin.slider_border_opacity;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = radius * 2;
        ctx.strokeStyle = "white";
        ctx.stroke();

        // erase center
        ctx.globalCompositeOperation = "destination-out";
        ctx.lineWidth = body_radius * 2;
        ctx.strokeStyle = "white";
        ctx.globalAlpha = 1.0;
        ctx.stroke();

        // body color
        ctx.globalCompositeOperation = "source-over";
        ctx.lineWidth = body_radius * 2;
        ctx.strokeStyle = combo_color;
        ctx.globalAlpha = skin.slider_body_opacity;
        ctx.stroke();

        ctx.restore();

        // store in cache
        this.slider_cache.set(obj, {
            canvas,
            scale: config.scale,
            min_x,
            min_y
        });

        // draw newly created cache immediately
        backend.save();

        if (config.scale !== 0) {
            backend.scale(1 / config.scale, 1 / config.scale);
            backend.translate(-config.offset_x, -config.offset_y);
        }

        const draw_x = Math.floor(min_x * config.scale + config.offset_x);
        const draw_y = Math.floor(min_y * config.scale + config.offset_y);

        backend.set_alpha(body_opacity);
        backend.draw_image(canvas, draw_x, draw_y);
        backend.restore();
    }

    private draw_slider_ticks(obj: IHitObject, data: ISliderData, path: Vec2[], time: number): void {
        const { backend, skin, radius, preempt, fade_in } = this;
        if (time > obj.end_time) return;

        const timing = this.get_timing_at(obj.time);
        const scoring_distance = 100 * this.beatmap.sv * timing.velocity;
        const velocity = scoring_distance / timing.beat_length;
        const tick_distance = scoring_distance / this.beatmap.tick_rate;
        const min_distance_from_end = velocity * 10;
        const slider_length = data.distance;
        const path_length = this.get_path_length(path);

        for (let d = tick_distance; d <= slider_length; d += tick_distance) {
            if (d >= slider_length - min_distance_from_end) break;

            const ratio = d / slider_length;
            const target_len = ratio * path_length;
            const pos = this.get_position_at_length(path, target_len);

            let opacity = 1.0;

            if (this.use_hidden) {
                const tick_time = obj.time + (d / slider_length) * data.duration!;
                const fade_out_time = tick_time - Math.min(1000, preempt * 0.7);
                const appear_time = tick_time - preempt;

                if (time < appear_time || time > fade_out_time) {
                    opacity = 0;
                } else if (time > fade_out_time - 200) {
                    opacity = (fade_out_time - time) / 200;
                } else {
                    opacity = clamp((time - appear_time) / fade_in, 0, 1);
                }
            } else {
                const slider_appear_time = obj.time - preempt;
                if (time < slider_appear_time) {
                    opacity = 0;
                } else {
                    const base_fade = clamp((time - slider_appear_time) / fade_in, 0, 1);
                    const position_delay = (d / slider_length) * (fade_in * 0.3);
                    const adjusted_fade = clamp((time - slider_appear_time - position_delay) / (fade_in * 0.5), 0, 1);
                    opacity = Math.min(base_fade, adjusted_fade);
                }

                const tick_time = obj.time + (d / slider_length) * data.duration!;
                if (time > tick_time) {
                    const fade_t = (time - tick_time) / 150;
                    opacity = Math.max(0, opacity * (1 - fade_t));
                }
            }

            if (opacity > 0) {
                backend.set_alpha(opacity * skin.slider_tick_opacity);
                backend.draw_circle(pos[0], pos[1], radius * skin.slider_tick_size, "rgba(255,255,255,1)", "rgba(255,255,255,0.1)", 1);
            }
        }
    }

    private get_position_at_length(path: Vec2[], target_length: number): Vec2 {
        let accumulated = 0;
        for (let i = 1; i < path.length; i++) {
            const segment_length = vec2_len(vec2_sub(path[i], path[i - 1]));
            if (accumulated + segment_length >= target_length) {
                const local_t = (target_length - accumulated) / segment_length;
                return vec2_lerp(path[i - 1], path[i], local_t);
            }
            accumulated += segment_length;
        }
        return path[path.length - 1];
    }

    private draw_reverse_arrow(path: Vec2[], radius: number, at_end: boolean): void {
        const { backend } = this;

        let pos: Vec2;
        let dir: Vec2;

        if (at_end) {
            pos = path[path.length - 1];
            const prev = path[Math.max(0, path.length - 2)];
            dir = vec2_normalize(vec2_sub(prev, pos));
        } else {
            pos = path[0];
            const next = path[Math.min(1, path.length - 1)];
            dir = vec2_normalize(vec2_sub(next, pos));
        }

        const arrow_size = radius * 0.5;
        const angle = Math.atan2(dir[1], dir[0]);
        const wing_angle = Math.PI / 4;
        const wing_len = arrow_size;

        const left_x = pos[0] + Math.cos(angle - wing_angle) * wing_len;
        const left_y = pos[1] + Math.sin(angle - wing_angle) * wing_len;
        const right_x = pos[0] + Math.cos(angle + wing_angle) * wing_len;
        const right_y = pos[1] + Math.sin(angle + wing_angle) * wing_len;

        backend.begin_path();
        backend.move_to(left_x, left_y);
        backend.line_to(pos[0], pos[1]);
        backend.line_to(right_x, right_y);
        backend.stroke_path("rgba(255,255,255,1)", 4, "round", "round");
    }

    private draw_follow_circle(obj: IHitObject, time: number): void {
        const { backend, skin, radius, fade_in } = this;
        const data = obj.data as ISliderData;
        const pos = this.get_slider_position(data, time - obj.time, data.duration!);

        let opacity: number;

        if (this.use_hidden) {
            if (time < obj.time - fade_in) {
                opacity = 0;
            } else if (time < obj.time) {
                opacity = (time - (obj.time - fade_in)) / fade_in;
            } else if (time <= obj.end_time) {
                opacity = 1;
            } else {
                opacity = 1 - clamp((time - obj.end_time) / 100, 0, 1);
            }
        } else {
            opacity = this.get_slider_body_opacity(obj, time);
        }

        if (opacity <= 0) return;

        const circle_size = radius * (1 - skin.circle_border_width / 2);
        const border_width = radius * skin.circle_border_width;

        backend.set_alpha(opacity);

        backend.draw_circle(pos[0], pos[1], circle_size, get_combo_color(skin, obj.combo_number, 0.5), "rgba(255,255,255,1)", border_width);

        const pulse = 1 + Math.sin(time * 0.01) * 0.05;
        backend.begin_path();
        backend.arc_to(pos[0], pos[1], circle_size * skin.follow_circle_factor * pulse, 0, Math.PI * 2);
        backend.stroke_path("rgba(255,255,255,0.7)", skin.follow_circle_width);

        backend.set_alpha(1);
    }

    private get_slider_position(slider: ISliderData, elapsed: number, duration: number): Vec2 {
        const path = slider.computed_path;
        if (!path || path.length === 0) return slider.pos;

        const repeat_time = elapsed % (duration * 2);
        let t = repeat_time < duration ? repeat_time / duration : 2 - repeat_time / duration;

        t = clamp(t, 0, 1);

        const total_length = this.get_path_length(path);
        const target_length = t * total_length;

        let accumulated = 0;
        for (let i = 1; i < path.length; i++) {
            const segment_length = vec2_len(vec2_sub(path[i], path[i - 1]));

            if (accumulated + segment_length >= target_length) {
                const local_t = (target_length - accumulated) / segment_length;
                return vec2_lerp(path[i - 1], path[i], local_t);
            }

            accumulated += segment_length;
        }

        return path[path.length - 1];
    }

    private get_path_length(path: Vec2[]): number {
        let length = 0;
        for (let i = 1; i < path.length; i++) {
            length += vec2_len(vec2_sub(path[i], path[i - 1]));
        }
        return length;
    }

    private draw_spinner(obj: IHitObject, time: number): void {
        const { backend, skin } = this;
        const opacity = this.get_circle_opacity(obj, time);

        if (opacity <= 0) return;

        const x = 256;
        const y = 192;
        const duration = obj.end_time - obj.time;
        const progress = clamp((time - obj.time) / duration, 0, 1);

        backend.set_alpha(opacity);

        const approach_size = skin.spinner_size * (1 - progress);
        if (approach_size > 5) {
            backend.begin_path();
            backend.arc_to(x, y, approach_size, 0, Math.PI * 2);
            backend.stroke_path("rgba(255,255,255,0.6)", 4);
        }

        backend.draw_circle(x, y, skin.spinner_size, "rgba(0,0,0,0.2)");
        backend.draw_circle(x, y, 12, "white");
    }

    private draw_follow_point(prev: IHitObject, next: IHitObject, time: number): void {
        if (this.use_hidden) return;
        if (prev.combo_number !== next.combo_number) return;

        const { backend, skin } = this;

        if (time < prev.end_time || time > next.time) return;

        const start_pos = prev.end_pos;
        const end_pos = (next.data as { pos: Vec2 }).pos;

        const dx = end_pos[0] - start_pos[0];
        const dy = end_pos[1] - start_pos[1];
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < 48) return;

        const duration = next.time - prev.end_time;
        const progress = (time - prev.end_time) / duration;
        let opacity = 1.0;

        if (progress < 0.2) {
            opacity = progress / 0.2;
        }
        if (progress > 0.8) {
            opacity = (1 - progress) / 0.2;
        }

        if (opacity <= 0) return;

        const line_progress = clamp(progress * 1.5, 0, 1);
        const line_start_x = lerp(start_pos[0], end_pos[0], Math.max(0, progress - 0.3));
        const line_start_y = lerp(start_pos[1], end_pos[1], Math.max(0, progress - 0.3));
        const line_end_x = lerp(start_pos[0], end_pos[0], line_progress);
        const line_end_y = lerp(start_pos[1], end_pos[1], line_progress);

        backend.set_alpha(opacity * 0.6);
        backend.begin_path();
        backend.move_to(line_start_x, line_start_y);
        backend.line_to(line_end_x, line_end_y);
        backend.stroke_path("rgba(255,255,255,1)", skin.follow_point_width, "round", "round");
        backend.set_alpha(1);
    }
}
