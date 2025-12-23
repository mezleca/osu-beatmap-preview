import type { IBeatmap, IHitObject, ISliderData, ITimingPoint } from "../../types/beatmap";
import { is_circle, is_slider, is_spinner, is_new_combo } from "../../types/beatmap";
import { Mods, has_mod } from "../../types/mods";
import { calculate_preempt, calculate_fade_in, calculate_radius } from "../../math/difficulty";
import { get_adjusted_difficulty } from "../../mods";
import { flatten_bezier, flatten_linear, flatten_perfect, flatten_catmull } from "../../math/curves";
import { vec2_sub, vec2_len, vec2_lerp, vec2_normalize, lerp, clamp, type Vec2 } from "../../math/vector2";
import { BaseRenderer, type IRendererConfig, DEFAULT_RENDERER_CONFIG } from "../base_renderer";
import type { IRenderBackend, RenderImage } from "../backend/render_backend";
import type { ISkinConfig } from "../../skin/skin_config";
import { get_combo_color } from "../../skin/skin_config";

const ease_out_cubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const flip_y = (y: number): number => 384 - y;

export class StandardRenderer extends BaseRenderer {
    private radius: number = 32;
    private preempt: number = 1200;
    private fade_in: number = 600;
    private timing_points: ITimingPoint[] = [];

    // cache for rendered sliders
    private slider_cache: Map<
        IHitObject,
        {
            image: RenderImage;
            scale: number;
        }
    > = new Map();

    constructor(backend: IRenderBackend, skin: ISkinConfig, mods: number = 0, config: IRendererConfig = DEFAULT_RENDERER_CONFIG) {
        super(backend, skin, mods, config);
    }

    initialize(beatmap: IBeatmap): void {
        this.beatmap = beatmap;
        // deep copy objects to prevent permanent modification (prevents double-flipping with HR)
        // ensure objects are sorted by time for consistent rendering order (z-index)
        this.objects = JSON.parse(JSON.stringify(beatmap.objects)).sort((a: IHitObject, b: IHitObject) => a.time - b.time);
        this.timing_points = this.process_timing_points([...beatmap.timing_points]);

        // clear caches when map changes
        this.slider_cache.clear();

        const difficulty = get_adjusted_difficulty(beatmap.cs, beatmap.ar, 0, 0, this.mods);

        this.radius = calculate_radius(difficulty.cs);
        this.preempt = calculate_preempt(difficulty.ar);
        this.fade_in = calculate_fade_in(this.preempt);

        this.preprocess_objects();
    }

    set_mods(mods: number): void {
        this.mods = mods;

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

                if (has_mod(this.mods, Mods.HardRock)) {
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

                if (has_mod(this.mods, Mods.HardRock)) {
                    data.pos = [data.pos[0], flip_y(data.pos[1])];
                }

                obj.end_pos = data.pos;
            }
        }
    }

    private compute_slider_path(slider: ISliderData): Vec2[] {
        if (slider.path_type === "L") {
            return flatten_linear(slider.pos, slider.control_points[0], slider.distance);
        }

        const all_points: Vec2[] = [slider.pos, ...slider.control_points];

        switch (slider.path_type) {
            case "P":
                return flatten_perfect(all_points, slider.distance);
            case "C":
                return flatten_catmull(all_points);
            default:
                return this.flatten_multibezier(all_points, slider.distance);
        }
    }

    private flatten_multibezier(points: Vec2[], max_distance: number): Vec2[] {
        const segments: Vec2[][] = [];
        let current: Vec2[] = [points[0]];

        for (let i = 1; i < points.length; i++) {
            const [prev, cur] = [points[i - 1], points[i]];

            if (prev[0] === cur[0] && prev[1] === cur[1]) {
                if (current.length > 1) segments.push(current);
                current = [cur];
            } else {
                current.push(cur);
            }
        }

        if (current.length > 1) segments.push(current);

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

        // draw in two passes to ensure overlays (approach circles, slider balls) are always on top
        // reverse time order: later objects at back, earlier objects on top
        visible.reverse();

        for (const obj of visible) {
            if (is_slider(obj)) {
                this.draw_slider(obj, time);
            } else if (is_circle(obj)) {
                this.draw_hit_circle(obj, time);
            } else if (is_spinner(obj)) {
                this.draw_spinner(obj, time);
            }
        }

        for (const obj of visible) {
            const has_approach_circle = !has_mod(this.mods, Mods.Hidden) && time <= obj.time && this.skin.enable_approach_circle;

            if (has_approach_circle && (is_slider(obj) || is_circle(obj))) {
                this.draw_approach_circle(obj, time);
            }

            if (is_slider(obj) && time > obj.time && time <= obj.end_time + 240) {
                this.draw_follow_circle(obj, time);
            }
        }

        backend.restore();
    }

    private get_slider_body_opacity(obj: IHitObject, time: number): number {
        const appear_time = obj.time - this.preempt;

        if (has_mod(this.mods, Mods.Hidden)) {
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
        if (has_mod(this.mods, Mods.Hidden)) return;
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
        const { backend, skin, radius, fade_in, preempt } = this;

        const pos = (obj.data as { pos: Vec2 }).pos;
        const appear_time = obj.time - preempt;
        const hit_anim_duration = 240;

        // skip if not visible yet
        if (time < appear_time) return;
        // skip if hit animation is finished
        if (time > obj.end_time + hit_anim_duration) return;

        let opacity = 1;
        let scale = 1;

        // fade in phase
        if (time < obj.time) {
            if (has_mod(this.mods, Mods.Hidden)) {
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
            // with HD, circle already faded - skip hit animation
            if (has_mod(this.mods, Mods.Hidden)) {
                return;
            }

            // skip hit animation if disabled
            if (!skin.enable_hit_animations) {
                return;
            }

            const t = clamp((time - obj.end_time) / hit_anim_duration, 0, 1);
            scale = 1 + (skin.hit_animation_scale - 1) * ease_out_cubic(t);
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
            const baseline_offset = font_size * 0.05;
            backend.draw_text(
                String(obj.combo_count),
                pos[0],
                pos[1] + baseline_offset,
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
            this.draw_masked_slider(obj, path, combo_color, body_opacity, skin.slider_body_opacity, skin.slider_border_opacity);
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

        if (has_mod(this.mods, Mods.Hidden)) {
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
            const baseline_offset = font_size * 0.05;
            backend.draw_text(
                String(obj.combo_count),
                pos[0],
                pos[1] + baseline_offset,
                `600 ${font_size}px ${skin.font_family}`,
                "rgba(255,255,255,1)",
                "center",
                "middle"
            );
        }

        backend.set_alpha(1);
    }

    private handle_reverse_arrows(obj: IHitObject, data: ISliderData, path: Vec2[], time: number): void {
        const { radius, preempt, fade_in } = this;
        const appear_time = obj.time - preempt;
        const duration = data.duration!;

        // base opacity for arrows
        let base_opacity = 1.0;
        if (has_mod(this.mods, Mods.Hidden)) {
            const hd_fade_in = preempt * 0.4;
            const fade_out_start = appear_time + hd_fade_in;
            const fade_out_duration = preempt * 0.3;

            if (time < appear_time) {
                base_opacity = 0;
            } else if (time < fade_out_start) {
                base_opacity = clamp((time - appear_time) / hd_fade_in, 0, 1);
            } else {
                const fade_t = clamp((time - fade_out_start) / fade_out_duration, 0, 1);
                base_opacity = 1 - fade_t;
            }
        } else {
            if (time < appear_time) {
                base_opacity = 0;
            } else if (time < obj.time) {
                base_opacity = clamp((time - appear_time) / fade_in, 0, 1);
            }
        }

        if (base_opacity <= 0) return;

        const elapsed = Math.max(0, time - obj.time);
        const current_repeat = Math.floor(elapsed / duration);

        // draw reverse arrow at end of slider if there are remaining repeats
        const remaining_at_end = data.repetitions - 1 - current_repeat;
        if (remaining_at_end >= 1) {
            const at_end = current_repeat % 2 === 0;
            this.draw_reverse_arrow(path, at_end, time, base_opacity);
        }

        // draw both arrows before slider starts
        if (time < obj.time) {
            this.draw_reverse_arrow(path, true, time, base_opacity);
            if (data.repetitions > 2) {
                this.draw_reverse_arrow(path, false, time, base_opacity);
            }
        }
    }

    private draw_masked_slider(
        obj: IHitObject,
        path: Vec2[],
        combo_color: string,
        body_opacity: number,
        skin_body_opacity: number,
        skin_border_opacity: number
    ): void {
        const { backend, config, radius } = this;

        // check cache
        const cache = this.slider_cache.get(obj);

        // validate cache (must match current scale)
        if (cache && Math.abs(cache.scale - config.scale) < 0.001) {
            backend.save();
            if (config.scale !== 0) {
                backend.scale(1 / config.scale, 1 / config.scale);
                backend.translate(-config.offset_x, -config.offset_y);
            }

            const min_x = cache.image.min_x || 0;
            const min_y = cache.image.min_y || 0;
            const draw_x = Math.floor(min_x * config.scale + config.offset_x);
            const draw_y = Math.floor(min_y * config.scale + config.offset_y);

            backend.set_alpha(body_opacity);
            backend.draw_image(cache.image, draw_x, draw_y);
            backend.restore();
            return;
        }

        // cache miss, render to new canvas handle
        const image = backend.render_slider_to_image(path, radius, "white", combo_color, config.scale, skin_body_opacity, skin_border_opacity);
        if (!image) return;

        // cache it
        this.slider_cache.set(obj, {
            image,
            scale: config.scale
        });

        // draw immediately
        backend.save();
        if (config.scale !== 0) {
            backend.scale(1 / config.scale, 1 / config.scale);
            backend.translate(-config.offset_x, -config.offset_y);
        }

        const min_x = image.min_x || 0;
        const min_y = image.min_y || 0;
        const draw_x = Math.floor(min_x * config.scale + config.offset_x);
        const draw_y = Math.floor(min_y * config.scale + config.offset_y);

        backend.set_alpha(body_opacity);
        backend.draw_image(image, draw_x, draw_y);
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

            if (has_mod(this.mods, Mods.Hidden)) {
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

    private draw_reverse_arrow(path: Vec2[], at_end: boolean, time: number, opacity: number): void {
        const { backend, radius } = this;

        if (opacity <= 0) return;

        let pos: Vec2;
        let dir: Vec2;

        // get position and calculate direction from curve
        if (at_end) {
            pos = path[path.length - 1];
            // look backwards along the path for direction
            let aim_point = path[path.length - 1];
            for (let i = path.length - 2; i >= 0; i--) {
                const dx = path[i][0] - pos[0];
                const dy = path[i][1] - pos[1];
                if (dx * dx + dy * dy > 1) {
                    aim_point = path[i];
                    break;
                }
            }
            dir = vec2_normalize(vec2_sub(aim_point, pos));
        } else {
            pos = path[0];
            // look forwards along the path for direction
            let aim_point = path[0];
            for (let i = 1; i < path.length; i++) {
                const dx = path[i][0] - pos[0];
                const dy = path[i][1] - pos[1];
                if (dx * dx + dy * dy > 1) {
                    aim_point = path[i];
                    break;
                }
            }
            dir = vec2_normalize(vec2_sub(aim_point, pos));
        }

        // pulsing animation (osu! lazer style: 1.0 -> 1.3 over 300ms loop)
        const loop_duration = 300;
        const move_out_duration = 35;
        const move_in_duration = 250;
        const loop_time = time % loop_duration;

        let pulse_scale = 1.0;
        if (loop_time < move_out_duration) {
            pulse_scale = 1.0 + (loop_time / move_out_duration) * 0.3;
        } else {
            const t = (loop_time - move_out_duration) / move_in_duration;
            pulse_scale = 1.3 - t * 0.3;
        }

        const arrow_size = radius * 0.6 * pulse_scale;
        const angle = Math.atan2(dir[1], dir[0]);

        // draw chevron shape (like osu! lazer ">") pointing in direction
        const chevron_spread = Math.PI / 3.5;
        const wing_len = arrow_size * 0.8;
        const tip_offset = arrow_size * 0.25;

        // tip of chevron offset from center
        const tip_x = pos[0] + Math.cos(angle) * tip_offset;
        const tip_y = pos[1] + Math.sin(angle) * tip_offset;

        // left and right wings
        const left_x = tip_x - Math.cos(angle - chevron_spread) * wing_len;
        const left_y = tip_y - Math.sin(angle - chevron_spread) * wing_len;
        const right_x = tip_x - Math.cos(angle + chevron_spread) * wing_len;
        const right_y = tip_y - Math.sin(angle + chevron_spread) * wing_len;

        backend.set_alpha(opacity);
        backend.begin_path();
        backend.move_to(left_x, left_y);
        backend.line_to(tip_x, tip_y);
        backend.line_to(right_x, right_y);
        backend.stroke_path("rgba(255,255,255,1)", 3 * pulse_scale, "round", "round");
        backend.set_alpha(1);
    }

    private draw_follow_circle(obj: IHitObject, time: number): void {
        const { backend, skin, radius } = this;
        const data = obj.data as ISliderData;
        const duration = data.duration!;
        const total_duration = duration * data.repetitions;
        const elapsed = Math.min(time - obj.time, total_duration);
        const pos = this.get_slider_position(data, elapsed, duration);

        // slider ball should be visible during entire slider duration
        // follow circle can persist slightly after for fade out
        const after_end_delay = 240;
        if (time > obj.end_time + after_end_delay) return;

        // pulsing animation while holding slider
        const pulse_speed = 0.008;
        const pulse = 1 + Math.sin(time * pulse_speed) * 0.08;

        // follow circle should grow in at start
        let scale_factor = 1.0;
        const GROW_DURATION = 100;

        if (elapsed < GROW_DURATION) {
            const t = clamp(elapsed / GROW_DURATION, 0, 1);
            scale_factor = 0.5 + t * 0.5;
        }

        let follow_opacity = skin.follow_circle_opacity;

        // Hidden mod: follow circle (ball + ring) should fade out
        if (has_mod(this.mods, Mods.Hidden)) {
            const appear_time = obj.time - this.preempt;
            const hd_fade_in = this.preempt * 0.4;
            const fade_out_start = appear_time + hd_fade_in;
            const fade_out_duration = this.preempt * 0.3;

            if (time < fade_out_start) {
                follow_opacity *= clamp((time - appear_time) / hd_fade_in, 0, 1);
            } else {
                const fade_t = clamp((time - fade_out_start) / fade_out_duration, 0, 1);
                follow_opacity *= 1 - fade_t;
            }
        }

        // fade out and scale out after slider ends
        if (time > obj.end_time) {
            const out_t = clamp((time - obj.end_time) / 240, 0, 1);
            follow_opacity *= 1 - out_t;
            scale_factor *= 1 + out_t * 0.3; // expand more for "wow" effect
        }

        if (follow_opacity <= 0) return;

        // draw slider ball (inner circle at slider position)
        if (skin.enable_slider_ball) {
            const ball_size = radius * 0.85; // ball doesn't expand, only the ring does

            // ball fades out quickly after slider ends (100ms)
            let ball_alpha = follow_opacity * (skin.slider_ball_opacity / skin.follow_circle_opacity);
            if (time > obj.end_time) {
                const ball_out_t = clamp((time - obj.end_time) / 100, 0, 1);
                ball_alpha *= 1 - ball_out_t;
            }

            if (ball_alpha > 0) {
                backend.set_alpha(ball_alpha);
                backend.draw_circle(pos[0], pos[1], ball_size, get_combo_color(skin, obj.combo_number, 0.7), "rgba(255,255,255,0.9)", radius * 0.12);
            }
        }

        // draw follow circle (outer ring with pulse)
        const follow_size = radius * skin.follow_circle_factor * pulse * scale_factor;
        const ring_color = skin.follow_circle_use_combo_color ? get_combo_color(skin, obj.combo_number, 1.0) : skin.follow_circle_color;

        // ring should NOT fade out in HD, just like the slider ball
        backend.set_alpha(follow_opacity);
        backend.begin_path();
        backend.arc_to(pos[0], pos[1], follow_size, 0, Math.PI * 2);
        backend.stroke_path(ring_color, skin.follow_circle_width);

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
        // Spinners should NOT be affected by Hidden mod
        const appear_time = obj.time - this.preempt;
        if (time < appear_time) return;

        let opacity = clamp((time - appear_time) / this.fade_in, 0, 1);
        if (time > obj.end_time) {
            const fade_t = clamp((time - obj.end_time) / 200, 0, 1);
            opacity = 1 - ease_out_cubic(fade_t);
        }

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
        if (has_mod(this.mods, Mods.Hidden)) return;
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
