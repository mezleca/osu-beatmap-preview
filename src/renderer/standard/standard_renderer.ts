import type { IBeatmap, IHitObject, ISliderData, ITimingPoint } from "../../types/beatmap";
import { is_circle, is_slider, is_spinner, is_new_combo } from "../../types/beatmap";
import { Mods, has_mod } from "../../types/mods";
import { calculate_preempt, calculate_fade_in, calculate_radius } from "../../math/difficulty";
import { get_adjusted_difficulty } from "../../mods";
import { flatten_bezier, flatten_linear, flatten_perfect, flatten_catmull } from "../../math/curves";
import { vec2_sub, vec2_len, vec2_lerp, lerp, clamp, type Vec2 } from "../../math/vector2";
import { BaseRenderer, type IRendererConfig, DEFAULT_RENDERER_CONFIG } from "../base_renderer";
import type { IRenderBackend } from "../backend/render_backend";
import type { ISkinConfig } from "../../skin/skin_config";
import { get_combo_color } from "../../skin/skin_config";
import { Drawable, DrawableHitCircle, DrawableSlider, type DrawableConfig } from "../drawable";

const flip_y = (y: number): number => 384 - y;
const ease_out_cubic = (t: number): number => 1 - Math.pow(1 - t, 3);

export class StandardRenderer extends BaseRenderer {
    private radius = 32;
    private preempt = 1200;
    private fade_in = 600;
    private timing_points: ITimingPoint[] = [];

    private drawables: Drawable[] = [];
    private drawable_config!: DrawableConfig;

    constructor(backend: IRenderBackend, skin: ISkinConfig, mods: number = 0, config: IRendererConfig = DEFAULT_RENDERER_CONFIG) {
        super(backend, skin, mods, config);
    }

    initialize(beatmap: IBeatmap): void {
        this.beatmap = beatmap;
        this.objects = JSON.parse(JSON.stringify(beatmap.objects)).sort((a: IHitObject, b: IHitObject) => a.time - b.time);
        this.timing_points = this.process_timing_points([...beatmap.timing_points]);

        const difficulty = get_adjusted_difficulty(beatmap.cs, beatmap.ar, 0, 0, this.mods);
        this.radius = calculate_radius(difficulty.cs);
        this.preempt = calculate_preempt(difficulty.ar);
        this.fade_in = calculate_fade_in(this.preempt);

        this.preprocess_objects();
        this.create_drawables();
    }

    set_mods(mods: number): void {
        this.mods = mods;
        if (this.beatmap) {
            this.initialize(this.beatmap);
        }
    }

    private process_timing_points(points: ITimingPoint[]): ITimingPoint[] {
        if (points.length === 0) {
            return points;
        }

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
                const duration = (data.distance / (100 * this.beatmap!.sv)) * timing.ms_per_beat;

                data.duration = duration;
                obj.end_time = obj.time + duration * data.repetitions;
                obj.end_pos = this.get_slider_end_position(data);
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
        this.drawables = [];
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

        for (const obj of this.objects) {
            if (is_circle(obj)) {
                this.drawables.push(new DrawableHitCircle(obj, this.drawable_config));
            } else if (is_slider(obj)) {
                const data = obj.data as ISliderData;
                const path = data.computed_path || [];
                const span_duration = data.duration || 0;

                // velocity = path_distance / span_duration
                // scoring_distance = velocity * beat_length
                // tick_distance = scoring_distance / tick_rate
                const path_length = this.calculate_path_length(path);
                const velocity = span_duration > 0 ? path_length / span_duration : 0;
                const base_beat_length = this.get_base_beat_length_at(obj.time);
                const scoring_distance = velocity * base_beat_length;
                const tick_distance = scoring_distance / this.beatmap!.tick_rate;

                this.drawables.push(new DrawableSlider(obj, this.drawable_config, path, span_duration, tick_distance));
            }
        }
    }

    private calculate_path_length(path: Vec2[]): number {
        let length = 0;
        for (let i = 1; i < path.length; i++) {
            length += vec2_len(vec2_sub(path[i], path[i - 1]));
        }
        return length;
    }

    private get_base_beat_length_at(time: number): number {
        if (!this.beatmap || this.beatmap.timing_points.length === 0) return 600;

        let last_valid = this.beatmap.timing_points[0].ms_per_beat;

        for (const p of this.beatmap.timing_points) {
            if (p.time > time) break;
            if (p.change) {
                // uninherited
                last_valid = p.ms_per_beat;
            }
        }
        return last_valid;
    }

    render(time: number): void {
        const { backend, config } = this;

        this.render_background();
        backend.save();
        backend.translate(config.offset_x, config.offset_y);
        backend.scale(config.scale, config.scale);
        this.render_playfield();
        this.render_grid();

        // get visible drawables
        const visible_drawables = this.drawables.filter((d) => d.is_alive(time));

        // draw follow points
        this.draw_follow_points(time);

        // draw spinners first (background layer)
        for (const obj of this.objects) {
            if (is_spinner(obj)) {
                const appear_time = obj.time - this.preempt;
                if (time >= appear_time && time <= obj.end_time + 200) {
                    this.draw_spinner(obj, time);
                }
            }
        }

        // update and render drawables in reverse order (later objects at back)
        // using 2-pass rendering: bodies first, then heads/circles on top
        visible_drawables.sort((a, b) => b.start_time - a.start_time);

        for (const drawable of visible_drawables) {
            drawable.update(time);
        }

        // pass 1: bodies only (sliders)
        for (const drawable of visible_drawables) {
            if (drawable instanceof DrawableSlider) {
                drawable.render_body_pass(time);
            }
        }

        // pass 2: circles/heads on top
        for (const drawable of visible_drawables) {
            if (drawable instanceof DrawableSlider) {
                drawable.render_head_pass(time);
            } else {
                drawable.render(time);
            }
        }

        // approach circles (on top of everything except cursor)
        if (!has_mod(this.mods, Mods.Hidden) && this.skin.enable_approach_circle) {
            for (const drawable of visible_drawables) {
                if (time <= drawable.start_time) {
                    this.draw_approach_circle(drawable, time);
                }
            }
        }

        backend.restore();
    }

    private draw_follow_points(time: number): void {
        if (has_mod(this.mods, Mods.Hidden)) return;

        for (let i = 0; i < this.objects.length - 1; i++) {
            const prev = this.objects[i];
            const next = this.objects[i + 1];

            if (is_spinner(prev) || is_spinner(next)) continue;
            if (prev.combo_number !== next.combo_number) continue;
            if (time < prev.end_time || time > next.time) continue;

            const start_pos = prev.end_pos;
            const end_pos = (next.data as { pos: Vec2 }).pos;

            const dx = end_pos[0] - start_pos[0];
            const dy = end_pos[1] - start_pos[1];
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < 48) continue;

            const duration = next.time - prev.end_time;
            const progress = (time - prev.end_time) / duration;
            let opacity = 1.0;

            if (progress < 0.2) opacity = progress / 0.2;
            if (progress > 0.8) opacity = (1 - progress) / 0.2;
            if (opacity <= 0) continue;

            const line_progress = clamp(progress * 1.5, 0, 1);
            const line_start_x = lerp(start_pos[0], end_pos[0], Math.max(0, progress - 0.3));
            const line_start_y = lerp(start_pos[1], end_pos[1], Math.max(0, progress - 0.3));
            const line_end_x = lerp(start_pos[0], end_pos[0], line_progress);
            const line_end_y = lerp(start_pos[1], end_pos[1], line_progress);

            this.backend.set_alpha(opacity * 0.6);
            this.backend.begin_path();
            this.backend.move_to(line_start_x, line_start_y);
            this.backend.line_to(line_end_x, line_end_y);
            this.backend.stroke_path("rgba(255,255,255,1)", this.skin.follow_point_width, "round", "round");
            this.backend.set_alpha(1);
        }
    }

    private draw_approach_circle(drawable: Drawable, time: number): void {
        const pos = drawable.position;
        const appear_time = drawable.start_time - this.preempt;

        // fade in with OutQuint for smoother animation
        const fade_duration = Math.min(this.fade_in * 2, this.preempt);
        const fade_progress = clamp((time - appear_time) / fade_duration, 0, 1);
        const opacity = this.ease_out_quint(fade_progress) * this.skin.approach_circle_opacity;

        // scale from 4 to 1 linearly over preempt time
        const scale_progress = clamp((time - appear_time) / this.preempt, 0, 1);
        const scale = 4 - 3 * scale_progress;

        const combo_color = get_combo_color(this.skin, drawable.combo_number, 1);

        this.backend.save();
        this.backend.set_alpha(opacity);
        this.backend.draw_circle(pos[0], pos[1], this.radius * scale, "transparent", combo_color, this.radius * this.skin.approach_circle_width);
        this.backend.restore();
    }

    private ease_out_quint(t: number): number {
        return 1 - Math.pow(1 - t, 5);
    }

    private draw_spinner(obj: IHitObject, time: number): void {
        const appear_time = obj.time - this.preempt;
        let opacity = clamp((time - appear_time) / this.fade_in, 0, 1);

        if (time > obj.end_time) {
            opacity = 1 - ease_out_cubic(clamp((time - obj.end_time) / 200, 0, 1));
        }
        if (opacity <= 0) return;

        const x = 256,
            y = 192;
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
            all_points.push(...flatten_bezier(segment));
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
                result.push(vec2_lerp(path[i - 1], path[i], remaining / segment_length));
                break;
            }
            distance += segment_length;
            result.push(path[i]);
        }
        return result;
    }

    private get_timing_at(time: number): ITimingPoint {
        for (const point of this.timing_points) {
            if (point.time <= time) return point;
        }
        return this.timing_points[this.timing_points.length - 1];
    }

    private get_slider_end_position(slider: ISliderData): Vec2 {
        if (!slider.computed_path || slider.computed_path.length === 0) return slider.pos;
        return slider.repetitions % 2 === 0 ? slider.pos : slider.computed_path[slider.computed_path.length - 1];
    }
}
