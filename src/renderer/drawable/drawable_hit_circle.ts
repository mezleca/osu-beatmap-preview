import type { IHitObject } from "../../types/beatmap";
import { Drawable, type DrawableConfig } from "./drawable";
import { Easing } from "./transforms";
import { get_combo_color } from "../../skin/skin_config";
import { clamp } from "../../math/vector2";
import { Mods, has_mod } from "../../types/mods";

export class DrawableHitCircle extends Drawable {
    private circle_alpha = 0;
    private circle_scale = 1;
    private approach_alpha = 0;
    private approach_scale = 4;

    private flash_alpha = 0;
    private explode_alpha = 0;

    constructor(hit_object: IHitObject, config: DrawableConfig) {
        super(hit_object, config);
    }

    update(time: number): void {
        super.update(time);
        this.calculate_animations(time);
    }

    private calculate_animations(time: number): void {
        const { config, hit_object } = this;
        const appear_time = hit_object.time - config.preempt;
        const hit_time = hit_object.time;

        // reset all
        this.flash_alpha = 0;
        this.explode_alpha = 0;

        if (time < appear_time) {
            this.circle_alpha = 0;
            this.circle_scale = 1;
            this.approach_alpha = 0;
            this.approach_scale = 4;
            return;
        }

        // approach phase (before hit)
        if (time < hit_time) {
            // circle: simple fade in over fade_in duration
            let alpha = clamp((time - appear_time) / config.fade_in, 0, 1);

            // HD mod: fade out before hit
            if (has_mod(config.mods, Mods.Hidden)) {
                const fade_out_start = hit_time - config.preempt * 0.4;
                const fade_out_duration = config.preempt * 0.3;

                if (time > fade_out_start) {
                    const fade_out_progress = clamp((time - fade_out_start) / fade_out_duration, 0, 1);
                    alpha *= 1 - fade_out_progress;
                }
            }

            this.circle_alpha = alpha;
            this.circle_scale = 1;

            // approach circle calculation disabled as it is handled by renderer (and hidden in HD)
            this.approach_alpha = 0;
            this.approach_scale = 1;
            return;
        }

        // after hit time - hit animations
        const elapsed = time - hit_time;

        const FLASH_IN = 40;
        const FLASH_OUT = 100;
        const SCALE_DURATION = 400;
        const FADE_OUT = 240;

        // approach circle: quick fadeout (50ms)
        this.approach_alpha = 0.9 * (1 - clamp(elapsed / 50, 0, 1));
        this.approach_scale = 1;

        // flash: fadeto 0.8 in 40ms, then fadeout 100ms
        if (elapsed < FLASH_IN) {
            this.flash_alpha = 0.8 * (elapsed / FLASH_IN);
        } else if (elapsed < FLASH_IN + FLASH_OUT) {
            this.flash_alpha = 0.8 * (1 - (elapsed - FLASH_IN) / FLASH_OUT);
        }

        // explode: fadein over 40ms, then fades out
        if (elapsed < FLASH_IN) {
            this.explode_alpha = elapsed / FLASH_IN;
        } else {
            this.explode_alpha = 1 - clamp((elapsed - FLASH_IN) / (FADE_OUT * 2), 0, 1);
        }

        // scale: 1 - 1.4 over scale duration with OutQuad
        const scale_progress = clamp(elapsed / SCALE_DURATION, 0, 1);
        this.circle_scale = 1 + 0.4 * Easing.OutQuad(scale_progress);

        // circle: fade out over FADE_OUT duration while scaling
        this.circle_alpha = 1 - clamp(elapsed / FADE_OUT, 0, 1);
    }

    render(time: number): void {
        const { backend, skin, config, hit_object } = this;
        const { radius } = config;
        const pos = this.position;
        const combo_color = get_combo_color(skin, this.combo_number, 1);

        // early exit if nothing to draw
        if (this.circle_alpha <= 0 && this.approach_alpha <= 0 && this.flash_alpha <= 0 && this.explode_alpha <= 0) {
            return;
        }

        const scaled_radius = radius * this.circle_scale;

        // circle (before hit)
        if (this.circle_alpha > 0.01) {
            const border_width = radius * skin.circle_border_width;
            const inner_radius = radius * (1 - skin.circle_border_width / 2);

            backend.set_alpha(this.circle_alpha * skin.hit_circle_opacity);

            // main circle fill
            backend.draw_circle(pos[0], pos[1], inner_radius, combo_color, "rgba(255,255,255,1)", border_width);

            // combo number
            const font_size = radius * 0.8;
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

        // flash (white burst, additive)
        if (skin.enable_hit_explode && this.flash_alpha > 0.01) {
            backend.save();
            backend.set_blend_mode("lighter");
            backend.set_alpha(this.flash_alpha);
            backend.draw_circle(pos[0], pos[1], scaled_radius, "rgba(255,255,255,1)", "transparent", 0);
            backend.restore();
        }

        // explode (colored burst, additive)
        if (skin.enable_hit_explode && this.explode_alpha > 0.01) {
            backend.save();
            backend.set_blend_mode("lighter");
            backend.set_alpha(this.explode_alpha * 0.15);
            backend.draw_circle(pos[0], pos[1], scaled_radius * 1.2, combo_color, "transparent", 0);
            backend.restore();
        }
    }
}
