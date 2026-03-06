import type { IRenderBackend } from "../backend/render_backend";
import type { DrawableConfig } from "./drawable";
import type { ISkinConfig } from "../../skin/skin_config";
import type { Vec2 } from "../../math/vector2";
import type { RenderImage } from "../backend/render_backend";
import { clamp, lerp } from "../../math/vector2";
import { Easing } from "./transforms";
import { Mods, has_mod } from "../../types/mods";
import type { StandardSkinElements } from "../../skin/skin_elements";

const LEGACY_CIRCLE_RENDER_SCALE = 1.04;

type circle_visual_state = {
    circle_alpha: number;
    circle_scale: number;
    number_alpha: number;
};

type CircleVisualTextureOverride = {
    circle?: RenderImage;
    overlay?: RenderImage;
};

export class CircleVisual {
    private state: circle_visual_state = {
        circle_alpha: 0,
        circle_scale: 1,
        number_alpha: 1
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

        const pre_hit_alpha = get_pre_hit_alpha(hit_time, appear_time, hit_time, config);
        this.update_post_hit(time, hit_time, config, pre_hit_alpha);
    }

    render(
        backend: IRenderBackend,
        skin: ISkinConfig,
        position: Vec2,
        radius: number,
        combo_color: string,
        combo_count: number,
        skin_elements?: StandardSkinElements | null,
        texture_override?: CircleVisualTextureOverride,
        show_number: boolean = true,
        show_overlay: boolean = true
    ): void {
        const { circle_alpha, circle_scale, number_alpha } = this.state;

        if (circle_alpha <= 0.01) return;

        if (circle_alpha > 0.01) {
            backend.set_alpha(circle_alpha * skin.hit_circle_opacity);

            const hitcircle = texture_override?.circle ?? skin_elements?.hitcircle;
            const hitcircleoverlay = texture_override?.overlay ?? skin_elements?.hitcircleoverlay;
            const overlay_above_number = skin.hit_circle_overlay_above_number;
            const has_textured_circle = !!hitcircle;
            if (hitcircle) {
                const size = radius * 2 * circle_scale * LEGACY_CIRCLE_RENDER_SCALE;
                backend.draw_image(hitcircle, position[0] - size / 2, position[1] - size / 2, size, size, combo_color);
            } else {
                const border_width = radius * skin.circle_border_width * circle_scale;
                const inner_radius = radius * (1 - skin.circle_border_width / 2) * circle_scale;
                backend.draw_circle(position[0], position[1], inner_radius, combo_color, "rgba(255,255,255,1)", border_width);
            }

            if (show_overlay && !overlay_above_number && hitcircleoverlay && has_textured_circle) {
                backend.set_alpha(circle_alpha * skin.hit_circle_opacity);
                const size = radius * 2 * circle_scale * LEGACY_CIRCLE_RENDER_SCALE;
                backend.draw_image(hitcircleoverlay, position[0] - size / 2, position[1] - size / 2, size, size);
            }

            if (show_number && number_alpha > 0.01) {
                backend.set_alpha(number_alpha * skin.hit_circle_opacity);
                const rendered = draw_combo_number_from_skin(backend, position, radius, circle_scale, combo_count, skin_elements);
                if (!rendered) {
                    const font_size = radius * 0.7 * circle_scale;
                    const font_name = skin.default_font ?? '"Trebuchet MS", Verdana, Arial, sans-serif';
                    const font = `600 ${font_size}px ${font_name}`;
                    backend.draw_text(String(combo_count), position[0], position[1], font, "rgba(255,255,255,1)", "center", "middle");
                }
            }

            if (show_overlay && overlay_above_number && hitcircleoverlay && has_textured_circle) {
                backend.set_alpha(circle_alpha * skin.hit_circle_opacity);
                const size = radius * 2 * circle_scale * LEGACY_CIRCLE_RENDER_SCALE;
                backend.draw_image(hitcircleoverlay, position[0] - size / 2, position[1] - size / 2, size, size);
            }

            backend.set_alpha(1);
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
    }

    private update_pre_hit(time: number, appear_time: number, hit_time: number, config: DrawableConfig): void {
        const alpha = get_pre_hit_alpha(time, appear_time, hit_time, config);
        this.state.circle_alpha = alpha;
        this.state.circle_scale = 1;
        this.state.number_alpha = alpha;
    }

    private update_post_hit(time: number, hit_time: number, config: DrawableConfig, pre_hit_alpha: number): void {
        const elapsed = time - hit_time;
        const { skin } = config;
        const duration = Math.max(110, skin.hit_animation_duration * 0.62);
        const progress = clamp(elapsed / duration, 0, 1);

        const base_alpha = has_mod(config.mods, Mods.Hidden) ? clamp(pre_hit_alpha, 0, 1) : clamp(Math.max(pre_hit_alpha, 0.25), 0, 1);
        this.state.circle_alpha = base_alpha * (1 - Easing.OutQuad(progress));
        this.state.circle_scale = lerp(1, Math.max(skin.hit_animation_scale, 1.34), Easing.OutCubic(progress));
        this.state.number_alpha = this.state.circle_alpha * (1 - 0.55 * progress);
    }
}

export const get_pre_hit_alpha = (time: number, appear_time: number, hit_time: number, config: DrawableConfig): number => {
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
};

const draw_combo_number_from_skin = (
    backend: IRenderBackend,
    position: Vec2,
    radius: number,
    circle_scale: number,
    combo_count: number,
    skin_elements?: StandardSkinElements | null
): boolean => {
    const digits = skin_elements?.combo_digits;
    if (!digits || digits.length < 10) {
        return false;
    }

    const text = String(combo_count);
    const legacy_circle_texture_size = 128;
    const legacy_hitcircle_text_scale = 0.8;
    const digit_scale = ((radius * 2) / legacy_circle_texture_size) * legacy_hitcircle_text_scale * circle_scale;
    const overlap = (skin_elements?.combo_overlap ?? -2) * digit_scale;

    const widths: number[] = [];
    const heights: number[] = [];
    let total = 0;
    for (let i = 0; i < text.length; i++) {
        const n = text.charCodeAt(i) - 48;
        const image = digits[n];
        if (!image || image.height <= 0) {
            return false;
        }
        const width = image.width * digit_scale;
        const height = image.height * digit_scale;
        widths.push(width);
        heights.push(height);
        total += width;
        if (i < text.length - 1) {
            total -= overlap;
        }
    }

    let x = position[0] - total / 2;
    for (let i = 0; i < text.length; i++) {
        const n = text.charCodeAt(i) - 48;
        const image = digits[n];
        const width = widths[i];
        const height = heights[i];
        const y = position[1] - height / 2;
        backend.draw_image(image, x, y, width, height);
        x += width;
        if (i < text.length - 1) {
            x -= overlap;
        }
    }

    return true;
};
