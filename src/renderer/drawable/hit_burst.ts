import type { IRenderBackend } from "../backend/render_backend";
import type { DrawableConfig } from "./drawable";
import type { ISkinConfig } from "../../skin/skin_config";
import type { Vec2 } from "../../math/vector2";
import { clamp, lerp } from "../../math/vector2";
import { Easing } from "./transforms";
import { Mods, has_mod } from "../../types/mods";
import { get_pre_hit_alpha } from "./circle_visual";

const BURST_SCALE_REDUCTION = 0.8;

type hit_burst_state = {
    alpha: number;
    scale: number;
};

export class HitBurstEffect {
    private state: hit_burst_state = {
        alpha: 0,
        scale: 1
    };

    update(time: number, hit_time: number, config: DrawableConfig): void {
        if (!config.skin.enable_hitburst) {
            this.state.alpha = 0;
            this.state.scale = 1;
            return;
        }

        if (time < hit_time) {
            this.state.alpha = 0;
            this.state.scale = 1;
            return;
        }

        const appear_time = hit_time - config.preempt;
        const pre_hit_alpha = get_pre_hit_alpha(hit_time, appear_time, hit_time, config);
        const base_alpha = has_mod(config.mods, Mods.Hidden) ? clamp(pre_hit_alpha, 0, 1) : clamp(Math.max(pre_hit_alpha, 0.25), 0, 1);

        const elapsed = time - hit_time;
        const duration = Math.max(44, config.skin.hitburst_duration * 0.52);
        const progress = clamp(elapsed / duration, 0, 1);
        const fade_out_alpha = 1 - Easing.OutQuint(progress);
        const fade_in_duration = Math.max(24, duration * 0.3);
        const fade_in_progress = clamp(elapsed / fade_in_duration, 0, 1);
        const burst_alpha = Easing.OutQuad(fade_in_progress) * fade_out_alpha;
        this.state.alpha = has_mod(config.mods, Mods.Hidden) ? burst_alpha * base_alpha * 0.78 : burst_alpha * 0.78;

        const target_scale = Math.max(1, config.skin.hitburst_scale * BURST_SCALE_REDUCTION);
        const pop_duration = Math.max(24, duration * 0.2);
        const pop_target_scale = Math.min(1.06, target_scale);
        if (elapsed <= pop_duration) {
            const pop_progress = clamp(elapsed / pop_duration, 0, 1);
            this.state.scale = lerp(0.96, pop_target_scale, Easing.OutCubic(pop_progress));
        } else {
            const expand_progress = clamp((elapsed - pop_duration) / Math.max(1, duration - pop_duration), 0, 1);
            this.state.scale = lerp(pop_target_scale, target_scale, Easing.OutCubic(expand_progress));
        }
    }

    render(backend: IRenderBackend, skin: ISkinConfig, position: Vec2, radius: number, combo_color: string): void {
        if (!skin.enable_hitburst) return;
        if (this.state.alpha <= 0.01) return;

        backend.set_alpha(this.state.alpha);
        backend.draw_circle(position[0], position[1], radius * this.state.scale, "rgba(255,255,255,1)", "transparent", 0);

        if (skin.hitburst_glow_enabled) {
            backend.save();
            backend.set_blend_mode("lighter");
            backend.set_alpha(this.state.alpha * skin.hitburst_glow_opacity);
            const glow_color = skin.hitburst_glow_use_combo_color ? combo_color : (skin.hitburst_glow_color ?? combo_color);
            backend.draw_circle(position[0], position[1], radius * this.state.scale * 1.08, glow_color, "transparent", 0);
            backend.restore();
        }
    }
}
