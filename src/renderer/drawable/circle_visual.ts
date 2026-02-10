import type { IRenderBackend } from "../backend/render_backend";
import type { DrawableConfig } from "./drawable";
import type { ISkinConfig } from "../../skin/skin_config";
import type { Vec2 } from "../../math/vector2";
import { clamp, lerp } from "../../math/vector2";
import { Easing } from "./transforms";
import { Mods, has_mod } from "../../types/mods";

type circle_visual_state = {
    circle_alpha: number;
    circle_scale: number;
    number_alpha: number;
    burst_alpha: number;
    burst_scale: number;
};

export class CircleVisual {
    private state: circle_visual_state = {
        circle_alpha: 0,
        circle_scale: 1,
        number_alpha: 1,
        burst_alpha: 0,
        burst_scale: 1
    };

    update(time: number, hit_time: number, config: DrawableConfig): void {
        const appear_time = hit_time - config.preempt;

        if (time < appear_time) {
            this.reset_pre_hit_state();
            return;
        }

        if (time < hit_time) {
            this.update_pre_hit(time, appear_time, hit_time, config);
            return;
        }

        const pre_hit_alpha = this.get_pre_hit_alpha(hit_time, appear_time, hit_time, config);
        this.update_post_hit(time, hit_time, config, pre_hit_alpha);
    }

    render(backend: IRenderBackend, skin: ISkinConfig, position: Vec2, radius: number, combo_color: string, combo_count: number): void {
        const { circle_alpha, circle_scale, number_alpha, burst_alpha, burst_scale } = this.state;

        if (circle_alpha <= 0.01 && burst_alpha <= 0.01) return;

        const scaled_radius = radius * circle_scale;

        if (circle_alpha > 0.01) {
            const border_width = radius * skin.circle_border_width;
            const inner_radius = radius * (1 - skin.circle_border_width / 2) * circle_scale;

            backend.set_alpha(circle_alpha * skin.hit_circle_opacity);
            backend.draw_circle(position[0], position[1], inner_radius, combo_color, "rgba(255,255,255,1)", border_width);

            if (number_alpha > 0.01) {
                const font_size = radius * 0.7 * circle_scale;
                backend.set_alpha(number_alpha * skin.hit_circle_opacity);
                const font = `600 ${font_size}px ${skin.font_family}`;
                backend.draw_text(String(combo_count), position[0], position[1], font, "rgba(255,255,255,1)", "center", "middle");
            }

            backend.set_alpha(1);
        }

        if (skin.enable_hit_explode && burst_alpha > 0.01) {
            backend.save();
            backend.set_blend_mode("lighter");
            backend.set_alpha(burst_alpha);
            const burst_radius = radius * burst_scale;
            backend.draw_circle(position[0], position[1], burst_radius, "rgba(255,255,255,1)", "transparent", 0);
            backend.restore();
        }

        if (skin.enable_glow && burst_alpha > 0.01) {
            backend.save();
            backend.set_blend_mode("lighter");
            backend.set_alpha(burst_alpha * skin.glow_opacity);
            const glow_color = skin.glow_use_combo_color ? combo_color : (skin.glow_color ?? combo_color);
            backend.draw_circle(position[0], position[1], radius * burst_scale * 1.08, glow_color, "transparent", 0);
            backend.restore();
        }

        backend.set_alpha(1);
    }

    get circle_alpha(): number {
        return this.state.circle_alpha;
    }

    private reset_pre_hit_state(): void {
        this.state.circle_alpha = 0;
        this.state.circle_scale = 1;
        this.state.number_alpha = 1;
        this.state.burst_alpha = 0;
        this.state.burst_scale = 1;
    }

    private update_pre_hit(time: number, appear_time: number, hit_time: number, config: DrawableConfig): void {
        const alpha = this.get_pre_hit_alpha(time, appear_time, hit_time, config);
        this.state.circle_alpha = alpha;
        this.state.circle_scale = 1;
        this.state.number_alpha = alpha;
        this.state.burst_alpha = 0;
        this.state.burst_scale = 1;
    }

    private update_post_hit(time: number, hit_time: number, config: DrawableConfig, pre_hit_alpha: number): void {
        const elapsed = time - hit_time;
        const { skin } = config;
        const duration = Math.max(90, skin.hit_animation_duration * 0.75);
        const fade_out_progress = clamp(elapsed / duration, 0, 1);

        const base_alpha = has_mod(config.mods, Mods.Hidden) ? clamp(pre_hit_alpha, 0, 1) : clamp(Math.max(pre_hit_alpha, 0.25), 0, 1);
        this.state.circle_alpha = base_alpha * (1 - Easing.OutQuad(fade_out_progress));

        const resize_duration = Math.max(90, duration * 0.85);
        const scale_progress = clamp(elapsed / resize_duration, 0, 1);
        this.state.circle_scale = lerp(1, skin.hit_animation_scale, Easing.OutCubic(scale_progress));
        this.state.number_alpha = this.state.circle_alpha;

        const burst_duration = Math.max(70, duration * 0.6);
        const burst_progress = clamp(elapsed / burst_duration, 0, 1);
        const burst_alpha = 1 - Easing.OutQuint(burst_progress);
        this.state.burst_alpha = has_mod(config.mods, Mods.Hidden) ? burst_alpha * base_alpha : burst_alpha;
        this.state.burst_scale = lerp(1, skin.hit_animation_scale * 1.05, Easing.OutCubic(burst_progress));
    }

    private get_pre_hit_alpha(time: number, appear_time: number, hit_time: number, config: DrawableConfig): number {
        const fade_in_progress = clamp((time - appear_time) / config.fade_in, 0, 1);
        let alpha = fade_in_progress;

        if (has_mod(config.mods, Mods.Hidden)) {
            const fade_out_start = hit_time - config.preempt + config.fade_in;
            const fade_out_duration = config.preempt * 0.3;
            if (time > fade_out_start) {
                const fade_out_progress = clamp((time - fade_out_start) / fade_out_duration, 0, 1);
                alpha *= 1 - fade_out_progress;
            }
        }

        return alpha;
    }
}
