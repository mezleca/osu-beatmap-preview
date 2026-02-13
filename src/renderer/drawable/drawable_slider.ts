import type { RenderHitObject, RenderSliderData } from "../render_types";
import type { RenderImage } from "../backend/render_backend";
import { Drawable, type DrawableConfig } from "./drawable";
import { CircleVisual } from "./circle_visual";
import { Easing } from "./transforms";
import { get_combo_color } from "../../skin/skin_config";
import { clamp, vec2_len, vec2_sub, vec2_lerp, type Vec2 } from "../../math/vector2";
import { Mods, has_mod } from "../../types/mods";
import { generate_slider_events, type SliderRepeatEvent, type SliderTickEvent } from "../standard/slider_events";

const FADE_OUT_DURATION = 240;
const ARROW_SCALE_AMOUNT = 1.3;
const ARROW_MOVE_OUT_DURATION = 35;
const ARROW_MOVE_IN_DURATION = 250;
const ARROW_TOTAL_CYCLE = 300;
const TICK_ANIM_DURATION = 150;
const TICK_SCALE_DURATION = TICK_ANIM_DURATION * 4;

type TickEntry = {
    tick: SliderTickEvent;
    appear_time: number;
    visible_end: number;
    preempt: number;
};

export class DrawableSlider extends Drawable {
    private slider_data: RenderSliderData;
    private position_path: Vec2[];
    private render_path: Vec2[];
    private path_length: number;
    private span_duration: number;

    private body_alpha = 0;
    private head_visual = new CircleVisual();
    private ball_alpha = 0;
    private ball_position: Vec2;
    private follow_alpha = 0;
    private follow_scale = 1;

    private ticks: SliderTickEvent[] = [];
    private repeats: SliderRepeatEvent[] = [];
    private tick_distance: number;
    private min_distance_from_end: number;
    private cached_texture: RenderImage | null = null;
    private cached_scale: number = 1;
    private tick_entries: TickEntry[] = [];
    private tick_entries_by_start: TickEntry[] = [];

    constructor(
        hit_object: RenderHitObject,
        config: DrawableConfig,
        path: Vec2[],
        span_duration: number,
        tick_distance: number,
        min_distance_from_end: number
    ) {
        super(hit_object, config);
        this.slider_data = hit_object.data as RenderSliderData;
        const resample_step = Math.max(1, config.radius * 0.05);
        this.position_path = path;
        this.render_path = this.resample_path(path, resample_step);
        this.span_duration = span_duration;
        this.tick_distance = tick_distance;
        this.min_distance_from_end = min_distance_from_end;
        const calculated_length = this.calculate_path_length();
        this.path_length = this.slider_data.distance > 0 ? this.slider_data.distance : calculated_length;
        this.ball_position = this.slider_data.pos;

        this.build_nested_objects();

        this.life_time_end = hit_object.end_time + FADE_OUT_DURATION;
    }

    private build_nested_objects(): void {
        const { slider_data, path_length, span_duration, hit_object } = this;
        const span_count = Math.max(1, slider_data.repetitions);
        const max_length = 100000;
        const length = Math.min(max_length, slider_data.distance > 0 ? slider_data.distance : path_length);
        const tick_distance = clamp(this.tick_distance, 0, length);

        if (length <= 0 || span_duration <= 0) {
            this.ticks = [];
            this.repeats = [];
            return;
        }

        // ticks/repeats are derived in slider space so render timing is stable across mods
        const result = generate_slider_events({
            start_time: hit_object.time,
            span_duration,
            span_count,
            length,
            tick_distance,
            min_distance_from_end: this.min_distance_from_end,
            get_position_at_progress: (progress) => this.get_position_at_progress(progress)
        });

        this.ticks = result.ticks;
        this.repeats = result.repeats;
        this.build_tick_entries();
    }
    private calculate_path_length(): number {
        let length = 0;
        for (let i = 1; i < this.position_path.length; i++) {
            length += vec2_len(vec2_sub(this.position_path[i], this.position_path[i - 1]));
        }
        return length;
    }

    private resample_path(path: Vec2[], step: number): Vec2[] {
        if (path.length < 2) return path.slice();

        const result: Vec2[] = [path[0]];
        let total_length = 0;
        const seg_lengths: number[] = [];

        for (let i = 1; i < path.length; i++) {
            const len = vec2_len(vec2_sub(path[i], path[i - 1]));
            seg_lengths.push(len);
            total_length += len;
        }

        if (total_length <= 0) return result;

        let target = step;
        let acc = 0;
        let seg_index = 0;

        while (target < total_length && seg_index < seg_lengths.length) {
            const seg_len = seg_lengths[seg_index];
            const a = path[seg_index];
            const b = path[seg_index + 1];

            if (seg_len > 0 && acc + seg_len >= target) {
                const t = (target - acc) / seg_len;
                result.push(vec2_lerp(a, b, t));
                target += step;
            } else {
                acc += seg_len;
                seg_index++;
            }
        }

        const last = path[path.length - 1];
        const last_added = result[result.length - 1];
        if (last_added[0] !== last[0] || last_added[1] !== last[1]) {
            result.push(last);
        }

        return result;
    }

    update(time: number): void {
        super.update(time);
        this.calculate_ball_position(time);
        this.calculate_opacities(time);
        this.head_visual.update(time, this.hit_object.time, this.config);
    }

    private calculate_ball_position(time: number): void {
        const { hit_object, span_duration } = this;
        const FOLLOW_IN_DURATION = 300;
        const FOLLOW_OUT_DURATION = 300;
        const FOLLOW_AREA = 2.4;

        // before slider starts
        if (time < hit_object.time) {
            this.ball_alpha = 0;
            this.follow_alpha = 0;
            this.follow_scale = 1;
            return;
        }

        // during slider
        if (time <= hit_object.end_time) {
            const elapsed = time - hit_object.time;
            const span_count = Math.max(1, this.slider_data.repetitions);
            const span_index = Math.min(Math.floor(elapsed / span_duration), span_count - 1);
            const span_progress = clamp((elapsed - span_index * span_duration) / span_duration, 0, 1);
            const t = span_index % 2 === 1 ? 1 - span_progress : span_progress;

            this.ball_position = this.get_position_at_progress(t);
            this.ball_alpha = 1;

            // follow circle animates in with OutQuint
            const follow_in_progress = clamp(elapsed / FOLLOW_IN_DURATION, 0, 1);
            const eased_in = Easing.OutQuint(follow_in_progress);
            this.follow_alpha = eased_in;
            this.follow_scale = 1 + (FOLLOW_AREA - 1) * eased_in;
            return;
        }

        // after slider ends - animate out
        const time_since_end = time - hit_object.end_time;
        const fade_progress = clamp(time_since_end / FOLLOW_OUT_DURATION, 0, 1);
        const eased_out = Easing.OutQuint(fade_progress);

        this.ball_alpha = 1 - eased_out;
        this.follow_alpha = 1 - eased_out;
        this.follow_scale = FOLLOW_AREA - (FOLLOW_AREA - 1) * eased_out;
    }

    private get_position_at_progress(progress: number): Vec2 {
        const target_length = progress * this.path_length;
        return this.get_position_at_length(target_length);
    }

    private get_position_at_length(target_length: number): Vec2 {
        let accumulated = 0;
        for (let i = 1; i < this.position_path.length; i++) {
            const segment_length = vec2_len(vec2_sub(this.position_path[i], this.position_path[i - 1]));
            if (accumulated + segment_length >= target_length) {
                const local_t = (target_length - accumulated) / segment_length;
                return vec2_lerp(this.position_path[i - 1], this.position_path[i], local_t);
            }
            accumulated += segment_length;
        }
        return this.position_path[this.position_path.length - 1];
    }

    private calculate_opacities(time: number): void {
        const { hit_object, config } = this;
        const appear_time = hit_object.time - config.preempt;
        const hit_time = hit_object.time;

        if (has_mod(config.mods, Mods.Hidden)) {
            const fade_out_start = hit_time - config.preempt + config.fade_in;
            if (time < appear_time) {
                this.body_alpha = 0;
            } else if (time < fade_out_start) {
                this.body_alpha = clamp((time - appear_time) / config.fade_in, 0, 1);
            } else if (time <= hit_object.end_time) {
                const denom = Math.max(1, hit_object.end_time - fade_out_start);
                this.body_alpha = 1 - clamp((time - fade_out_start) / denom, 0, 1);
            } else {
                this.body_alpha = 0;
            }
        } else {
            // body: fade in over fade_in, then fade out 240ms after end
            if (time < appear_time) {
                this.body_alpha = 0;
            } else if (time < hit_time) {
                this.body_alpha = clamp((time - appear_time) / config.fade_in, 0, 1);
            } else if (time <= hit_object.end_time) {
                this.body_alpha = 1;
            } else {
                this.body_alpha = 1 - clamp((time - hit_object.end_time) / FADE_OUT_DURATION, 0, 1);
            }
        }
    }

    render(time: number): void {
        if (this.body_alpha <= 0 && this.head_visual.circle_alpha <= 0 && this.ball_alpha <= 0) {
            return;
        }

        this.render_body(time);
        this.render_head();
        this.render_ball(time);
    }

    render_body_pass(time: number): void {
        this.render_body(time);
    }

    render_head_pass(time: number): void {
        this.render_head();
        this.render_reverse_arrows(time);
        this.render_ball(time);
    }

    private render_body(time: number): void {
        if (this.body_alpha <= 0.01 || this.render_path.length < 2) return;

        const { backend } = this;
        this.prepare_body_cache();

        if (this.cached_texture && this.cached_texture.min_x !== undefined && this.cached_texture.min_y !== undefined) {
            const scale = this.cached_scale;
            backend.set_alpha(this.body_alpha);
            backend.draw_image(
                this.cached_texture,
                this.cached_texture.min_x,
                this.cached_texture.min_y,
                this.cached_texture.width / scale,
                this.cached_texture.height / scale
            );
            backend.set_alpha(1);
        }

        this.render_ticks(time);
    }

    prepare_body_cache(): void {
        if (this.render_path.length < 2) {
            return;
        }

        const { backend, skin, config } = this;
        const { radius } = config;

        const render_scale = (config.scale ?? 1) * (skin.slider_render_scale || 1);

        if (!this.cached_texture || this.cached_scale !== render_scale) {
            const body_color = get_combo_color(skin, this.combo_number, 1);
            const border_color = skin.slider_border_color ?? "rgba(255,255,255,1)";
            const scale = render_scale;

            this.cached_texture = backend.render_slider_to_image(
                this.render_path,
                radius,
                border_color,
                body_color,
                scale,
                skin.slider_body_opacity,
                skin.slider_border_opacity
            );
            this.cached_scale = render_scale;
        }
    }

    dispose(): void {
        if (this.cached_texture?.source instanceof HTMLCanvasElement) {
            this.cached_texture.source.width = 0;
            this.cached_texture.source.height = 0;
        }

        this.cached_texture = null;
        this.position_path = [];
        this.render_path = [];
        this.ticks = [];
        this.repeats = [];
        this.tick_entries = [];
        this.tick_entries_by_start = [];
    }

    private render_ticks(time: number): void {
        if (this.tick_entries_by_start.length === 0) return;

        const { backend, config, hit_object } = this;
        const { radius } = config;

        const base_tick_radius = radius * 0.12;
        const appear_time = hit_object.time - config.preempt;

        const hidden = has_mod(config.mods, Mods.Hidden);

        for (const entry of this.tick_entries_by_start) {
            const tick = entry.tick;

            // calculate when this tick became visible
            const elapsed_since_appear = time - entry.appear_time;

            if (elapsed_since_appear < 0) continue;
            if (entry.visible_end < time) continue;

            // fade in over TICK_ANIM_DURATION
            let tick_alpha = clamp(elapsed_since_appear / TICK_ANIM_DURATION, 0, 1);

            if (hidden && entry.preempt > 0) {
                const hidden_fade_duration = Math.min(entry.preempt - TICK_ANIM_DURATION, 1000);
                if (hidden_fade_duration > 0) {
                    const fade_out_start = tick.time - hidden_fade_duration;
                    if (time >= fade_out_start) {
                        const fade_out_progress = clamp((time - fade_out_start) / hidden_fade_duration, 0, 1);
                        tick_alpha *= 1 - fade_out_progress;
                    }
                }
            } else if (time > tick.time) {
                const fade_out_progress = clamp((time - tick.time) / TICK_ANIM_DURATION, 0, 1);
                tick_alpha *= 1 - fade_out_progress;
            }

            tick_alpha *= this.body_alpha;

            // scale from 0.5 to 1.0 over TICK_SCALE_DURATION with elastic out
            const scale_progress = clamp(elapsed_since_appear / TICK_SCALE_DURATION, 0, 1);
            const elastic_value = this.ease_out_elastic_half(scale_progress);
            const tick_scale = 0.5 + 0.5 * elastic_value;
            const tick_radius = base_tick_radius * tick_scale;

            if (tick_alpha > 0.01) {
                backend.set_alpha(tick_alpha);
                backend.draw_circle(tick.pos[0], tick.pos[1], tick_radius, "rgba(255,255,255,0.8)", "transparent", 0);
            }
        }

        backend.set_alpha(1);
    }

    private build_tick_entries(): void {
        const { hit_object, config } = this;
        const appear_time = hit_object.time - config.preempt;
        const hidden = has_mod(config.mods, Mods.Hidden);

        this.tick_entries = this.ticks.map((tick) => {
            const span_start_time = hit_object.time + tick.span_index * this.span_duration;
            const base_preempt = config.preempt;
            const offset = tick.span_index > 0 ? 200 : base_preempt * 0.66;
            const time_preempt = (tick.time - span_start_time) / 2 + offset;
            const tick_appear_time = tick.time - time_preempt;
            const visible_end = hidden ? tick.time : tick.time + TICK_ANIM_DURATION;
            return {
                tick,
                appear_time: tick_appear_time,
                visible_end,
                preempt: time_preempt
            };
        });

        this.tick_entries_by_start = [...this.tick_entries].sort((a, b) => a.appear_time - b.appear_time);
    }

    private ease_out_elastic_half(t: number): number {
        if (t <= 0) return 0;
        if (t >= 1) return 1;
        const p = 0.3;
        return Math.pow(2, -10 * t) * Math.sin(((t - p / 4) * (2 * Math.PI)) / p) + 1;
    }

    private render_reverse_arrows(time: number): void {
        if (this.repeats.length === 0) return;

        const { backend, config, hit_object, span_duration } = this;
        const { radius } = config;
        const arrow_size = radius * 0.6;

        for (const repeat of this.repeats) {
            // the first repeat appears with the slider.
            // subsequent repeats appear exactly 2 * SpanDuration before they are hit.
            let time_preempt = config.preempt;
            if (repeat.repeat_index > 0) {
                time_preempt = span_duration * 2;
            } else {
                // the first repeat appears when the slider appears
                time_preempt += hit_object.time - (hit_object.time - config.preempt);
            }

            const appear_time = repeat.time - time_preempt;
            const is_at_end = repeat.repeat_index % 2 === 0;

            // dont show if not in range
            if (time < appear_time || time > repeat.time + FADE_OUT_DURATION) continue;

            // fade in logic: first repeat fades with slider, others pop in
            let alpha = this.body_alpha * 0.9;
            if (repeat.repeat_index === 0) {
                const fade_in_progress = clamp((time - appear_time) / 150, 0, 1);
                alpha *= Easing.OutQuint(fade_in_progress);
            } else {
                // pop in (TimeFadeIn = 0)
                if (time < appear_time) alpha = 0;
            }

            if (time > repeat.time) {
                // fade out after hit
                const anim_duration = Math.min(300, span_duration);
                alpha *= 1 - clamp((time - repeat.time) / anim_duration, 0, 1);
            }

            if (alpha <= 0.01) continue;

            // calculate arrow direction
            const curve = this.position_path;
            let aim_rotation_vector: Vec2;

            if (is_at_end) {
                // arrow at end pointing back
                const search_start = curve.length - 1;
                aim_rotation_vector = curve[0];

                for (let i = search_start; i >= 0; i--) {
                    if (Math.abs(curve[i][0] - repeat.pos[0]) > 0.01 || Math.abs(curve[i][1] - repeat.pos[1]) > 0.01) {
                        aim_rotation_vector = curve[i];
                        break;
                    }
                }
            } else {
                // arrow at start pointing forward
                aim_rotation_vector = curve[curve.length - 1];

                for (let i = 0; i < curve.length; i++) {
                    if (Math.abs(curve[i][0] - repeat.pos[0]) > 0.01 || Math.abs(curve[i][1] - repeat.pos[1]) > 0.01) {
                        aim_rotation_vector = curve[i];
                        break;
                    }
                }
            }

            const angle = Math.atan2(aim_rotation_vector[1] - repeat.pos[1], aim_rotation_vector[0] - repeat.pos[0]);

            // calculate pulsing scale
            let scale = 1.0;
            if (time < repeat.time) {
                const animation_start = hit_object.time - config.preempt;
                const loop_time = (time - animation_start) % ARROW_TOTAL_CYCLE;
                if (loop_time < ARROW_MOVE_OUT_DURATION) {
                    scale = 1 + (ARROW_SCALE_AMOUNT - 1) * Easing.Out(loop_time / ARROW_MOVE_OUT_DURATION);
                } else {
                    const in_progress = (loop_time - ARROW_MOVE_OUT_DURATION) / ARROW_MOVE_IN_DURATION;
                    scale = ARROW_SCALE_AMOUNT - (ARROW_SCALE_AMOUNT - 1) * Easing.Out(clamp(in_progress, 0, 1));
                }
            } else {
                // after hit: scale up
                const anim_duration = Math.min(300, span_duration);
                const progress = clamp((time - repeat.time) / anim_duration, 0, 1);
                scale = 1 + 0.5 * Easing.Out(progress);
            }

            const scaled_arrow_size = arrow_size * scale;

            backend.save();
            backend.set_alpha(alpha);
            backend.translate(repeat.pos[0], repeat.pos[1]);
            backend.rotate(angle);

            backend.begin_path();
            backend.move_to(scaled_arrow_size * 0.8, 0);
            backend.line_to(-scaled_arrow_size * 0.4, -scaled_arrow_size * 0.5);
            backend.line_to(-scaled_arrow_size * 0.4, scaled_arrow_size * 0.5);
            backend.close_path();
            backend.fill_path("rgba(255,255,255,0.9)");

            backend.restore();
        }
    }

    private render_head(): void {
        if (this.head_visual.circle_alpha <= 0.01) return;

        const { backend, skin, config } = this;
        const { radius } = config;
        const pos = this.slider_data.pos;
        const combo_color = get_combo_color(skin, this.combo_number, 1);

        this.head_visual.render(backend, skin, pos, radius, combo_color, this.combo_count);
    }

    private render_ball(time: number): void {
        if (this.ball_alpha <= 0.01 && this.follow_alpha <= 0.01) return;

        const { backend, skin, config } = this;
        const { radius } = config;
        const pos = this.ball_position;
        const combo_color = get_combo_color(skin, this.combo_number, 0.9);

        // follow circle with smooth scale animation
        if (this.follow_alpha > 0.01) {
            const follow_size = radius * this.follow_scale;

            backend.set_alpha(this.follow_alpha * skin.follow_circle_opacity);
            backend.begin_path();
            backend.arc_to(pos[0], pos[1], follow_size, 0, Math.PI * 2);
            backend.stroke_path(skin.follow_circle_color, skin.follow_circle_width);
        }

        // slider ball
        if (skin.enable_slider_ball && this.ball_alpha > 0.01) {
            backend.set_alpha(this.ball_alpha * skin.slider_ball_opacity);
            backend.draw_circle(pos[0], pos[1], radius * 0.85, combo_color, "rgba(255,255,255,0.9)", radius * 0.1);
        }

        backend.set_alpha(1);
    }
}
