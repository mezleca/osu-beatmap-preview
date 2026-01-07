import type { IHitObject, ISliderData } from "../../types/beatmap";
import type { RenderImage } from "../backend/render_backend";
import { Drawable, type DrawableConfig } from "./drawable";
import { Easing } from "./transforms";
import { get_combo_color } from "../../skin/skin_config";
import { clamp, vec2_len, vec2_sub, vec2_lerp, type Vec2 } from "../../math/vector2";
import { Mods, has_mod } from "../../types/mods";

const FADE_OUT_DURATION = 240;
const HEAD_ANIM_DURATION = 150;
const ARROW_SCALE_AMOUNT = 1.3;
const ARROW_MOVE_OUT_DURATION = 35;
const ARROW_MOVE_IN_DURATION = 250;
const ARROW_TOTAL_CYCLE = 300;

interface SliderTick {
    pos: Vec2;
    time: number;
    span_index: number;
    path_progress: number;
}

interface SliderRepeat {
    pos: Vec2;
    time: number;
    repeat_index: number;
    path_progress: number;
}

export class DrawableSlider extends Drawable {
    private slider_data: ISliderData;
    private path: Vec2[];
    private path_length: number;
    private span_duration: number;

    private body_alpha = 0;
    private head_alpha = 0;
    private head_scale = 1;
    private ball_alpha = 0;
    private ball_position: Vec2;
    private follow_alpha = 0;
    private follow_scale = 1;

    private ticks: SliderTick[] = [];
    private repeats: SliderRepeat[] = [];
    private tick_distance: number;
    private cached_texture: RenderImage | null = null;

    constructor(hit_object: IHitObject, config: DrawableConfig, path: Vec2[], span_duration: number, tick_distance: number) {
        super(hit_object, config);
        this.slider_data = hit_object.data as ISliderData;
        this.path = path;
        this.span_duration = span_duration;
        this.tick_distance = tick_distance;
        this.path_length = this.calculate_path_length();
        this.ball_position = this.slider_data.pos;

        this.generate_nested_objects();

        this.life_time_end = hit_object.end_time + FADE_OUT_DURATION;
    }

    private generate_nested_objects(): void {
        this.ticks = [];
        this.repeats = [];

        const { slider_data, path_length, span_duration, hit_object, tick_distance } = this;
        const span_count = slider_data.repetitions;

        if (tick_distance <= 0 || path_length <= 0) return;

        const velocity = path_length / span_duration;
        const min_distance_from_end = velocity * 10;

        // generate repeats
        for (let span = 0; span < span_count - 1; span++) {
            const repeat_time = hit_object.time + (span + 1) * span_duration;
            const path_progress = (span + 1) % 2; // 0 or 1 alternating

            this.repeats.push({
                pos: this.get_position_at_progress(path_progress),
                time: repeat_time,
                repeat_index: span,
                path_progress
            });
        }

        // generate ticks for each span
        for (let span = 0; span < span_count; span++) {
            const span_start_time = hit_object.time + span * span_duration;
            const reversed = span % 2 === 1;

            for (let d = tick_distance; d < path_length; d += tick_distance) {
                if (d >= path_length - min_distance_from_end) break;

                const path_progress = d / path_length;
                const time_progress = reversed ? 1 - path_progress : path_progress;

                this.ticks.push({
                    pos: this.get_position_at_progress(path_progress),
                    time: span_start_time + time_progress * span_duration,
                    span_index: span,
                    path_progress
                });
            }
        }

        // sort ticks by time for correct rendering
        this.ticks.sort((a, b) => a.time - b.time);
    }

    private calculate_path_length(): number {
        let length = 0;
        for (let i = 1; i < this.path.length; i++) {
            length += vec2_len(vec2_sub(this.path[i], this.path[i - 1]));
        }
        return length;
    }

    update(time: number): void {
        super.update(time);
        this.calculate_ball_position(time);
        this.calculate_opacities(time);
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
            const repeat_time = elapsed % (span_duration * 2);
            let t = repeat_time < span_duration ? repeat_time / span_duration : 2 - repeat_time / span_duration;
            t = clamp(t, 0, 1);

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
        for (let i = 1; i < this.path.length; i++) {
            const segment_length = vec2_len(vec2_sub(this.path[i], this.path[i - 1]));
            if (accumulated + segment_length >= target_length) {
                const local_t = (target_length - accumulated) / segment_length;
                return vec2_lerp(this.path[i - 1], this.path[i], local_t);
            }
            accumulated += segment_length;
        }
        return this.path[this.path.length - 1];
    }

    private calculate_opacities(time: number): void {
        const { hit_object, config } = this;
        const appear_time = hit_object.time - config.preempt;
        const hit_time = hit_object.time;

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

        // head: same fade in, hit animation at hit_time
        if (time < appear_time) {
            this.head_alpha = 0;
            this.head_scale = 1;
        } else if (time < hit_time) {
            this.head_alpha = clamp((time - appear_time) / config.fade_in, 0, 1);
            this.head_scale = 1;
        } else if (time < hit_time + HEAD_ANIM_DURATION) {
            const progress = (time - hit_time) / HEAD_ANIM_DURATION;
            const eased = Easing.OutCubic(progress);
            this.head_alpha = 1 - eased;
            this.head_scale = 1 + eased * 0.5;
        } else {
            this.head_alpha = 0;
        }

        // HD Mod: gradual fade during slider duration, not instant
        if (has_mod(config.mods, Mods.Hidden)) {
            const fade_in_end = hit_time - config.preempt + config.preempt * 0.4;
            const fade_out_start = fade_in_end;

            // long fade duration = from fade complete to slider end
            const long_fade_duration = hit_object.end_time - fade_out_start;

            if (time > fade_out_start && long_fade_duration > 0) {
                const fade = 1 - clamp((time - fade_out_start) / long_fade_duration, 0, 1);
                this.body_alpha *= fade;
            }

            // head fades with standard HD timing
            const head_fade_out_start = hit_time - config.preempt * 0.4;
            const head_fade_out_duration = config.preempt * 0.3;

            if (time > head_fade_out_start) {
                const fade = 1 - clamp((time - head_fade_out_start) / head_fade_out_duration, 0, 1);
                this.head_alpha *= fade;
            }
        }
    }

    render(time: number): void {
        if (this.body_alpha <= 0 && this.head_alpha <= 0 && this.ball_alpha <= 0) {
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
        if (this.body_alpha <= 0.01 || this.path.length < 2) return;

        const { backend, skin, config, path } = this;
        const { radius } = config;

        if (!this.cached_texture) {
            const body_color = get_combo_color(skin, this.combo_number, 1);
            const border_color = skin.slider_border_color ?? "rgba(255,255,255,1)";
            const scale = config.scale ?? 1;

            this.cached_texture = backend.render_slider_to_image(
                path,
                radius,
                border_color,
                body_color,
                scale,
                skin.slider_body_opacity,
                skin.slider_border_opacity
            );
        }

        if (this.cached_texture && this.cached_texture.min_x !== undefined && this.cached_texture.min_y !== undefined) {
            const scale = config.scale ?? 1;
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

    private render_ticks(time: number): void {
        if (this.ticks.length === 0) return;

        const { backend, config, hit_object } = this;
        const { radius } = config;

        const base_tick_radius = radius * 0.12;
        const appear_time = hit_object.time - config.preempt;
        const snake_progress = clamp((time - appear_time) / config.preempt, 0, 1);

        const ANIM_DURATION = 150;
        const SCALE_DURATION = ANIM_DURATION * 4;

        for (const tick of this.ticks) {
            // tick already passed
            if (time > tick.time) continue;

            // tick not yet visible (snaking)
            if (snake_progress < tick.path_progress) continue;

            // calculate when this tick became visible
            const tick_appear_time = appear_time + tick.path_progress * config.preempt;
            const elapsed_since_appear = time - tick_appear_time;

            if (elapsed_since_appear < 0) continue;

            // fade in over ANIM_DURATION (150ms)
            let tick_alpha = clamp(elapsed_since_appear / ANIM_DURATION, 0, 1);
            tick_alpha *= this.body_alpha;

            // scale from 0.5 to 1.0 over SCALE_DURATION with elastic out
            const scale_progress = clamp(elapsed_since_appear / SCALE_DURATION, 0, 1);
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
            const curve = this.path;
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
        if (this.head_alpha <= 0.01) return;

        const { backend, skin, config } = this;
        const { radius } = config;
        const pos = this.slider_data.pos;
        const combo_color = get_combo_color(skin, this.combo_number, 1);

        const inner_radius = radius * (1 - skin.circle_border_width / 2) * this.head_scale;
        const border_width = radius * skin.circle_border_width * this.head_scale;

        backend.set_alpha(this.head_alpha * skin.hit_circle_opacity);
        backend.draw_circle(pos[0], pos[1], inner_radius, combo_color, "rgba(255,255,255,1)", border_width);

        const font_size = radius * 0.8 * this.head_scale;
        backend.draw_text(
            String(this.combo_count),
            pos[0],
            pos[1] + font_size * 0.05,
            `600 ${font_size}px ${skin.font_family}`,
            "rgba(255,255,255,1)",
            "center",
            "middle"
        );

        backend.set_alpha(1);
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
