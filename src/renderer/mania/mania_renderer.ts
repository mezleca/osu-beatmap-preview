import type { IBeatmap } from "../../types/beatmap";
import { is_hold } from "../../types/beatmap";
import { Mods, has_mod } from "../../types/mods";
import { get_rate_multiplier } from "../../mods";
import { BaseRenderer, type IRendererConfig, DEFAULT_RENDERER_CONFIG, PLAYFIELD_WIDTH, PLAYFIELD_HEIGHT } from "../base_renderer";
import type { IRenderBackend } from "../backend/render_backend";
import type { ISkinConfig } from "../../skin/skin_config";
import { get_mania_lane_color } from "../../skin/skin_config";
import type { RenderHitObject, RenderHoldData } from "../render_types";
import { build_render_objects } from "../render_objects";

const MAX_TIME_RANGE = 11485;
const BASE_SCROLL_SPEED = 20;

export class ManiaRenderer extends BaseRenderer {
    private key_count: number = 4;
    private scroll_time: number = MAX_TIME_RANGE / BASE_SCROLL_SPEED;
    private hd_coverage: number = 0.25; // bottom 25% for hidden
    private fi_coverage: number = 0.6; // top 60% for fade-in
    private gradient_ratio: number = 0.2; // fade region is 20% of playfield height

    constructor(backend: IRenderBackend, skin: ISkinConfig, mods: number = 0, config: IRendererConfig = DEFAULT_RENDERER_CONFIG) {
        super(backend, skin, mods, config);
        this.update_scroll_time();
    }

    initialize(beatmap: IBeatmap): void {
        this.beatmap = beatmap;
        this.objects = build_render_objects(beatmap);
        this.key_count = Math.floor(beatmap.Difficulty.CircleSize);
    }

    set_mods(mods: number): void {
        this.mods = mods;
        this.update_scroll_time();
    }

    private update_scroll_time(): void {
        const rate = get_rate_multiplier(this.mods);
        this.scroll_time = MAX_TIME_RANGE / (BASE_SCROLL_SPEED * rate);
    }

    private time_to_y(time_diff: number): number {
        const hit_pos = this.skin.mania_hit_position;
        const progress = time_diff / this.scroll_time;
        return hit_pos - progress * hit_pos;
    }

    render(time: number): void {
        const { backend, config, skin, key_count } = this;

        this.render_background();

        const total_width = key_count * skin.mania_lane_width;
        const x_offset = Math.floor((PLAYFIELD_WIDTH - total_width) / 2);
        const hit_pos = skin.mania_hit_position;

        backend.save();
        backend.translate(config.offset_x, config.offset_y);
        backend.scale(config.scale, config.scale);

        this.render_playfield(total_width, PLAYFIELD_HEIGHT, x_offset);

        // draw lane keys at judgment line
        this.draw_lane_keys(time, x_offset);
        this.draw_judgment_line(x_offset);

        // clip notes to playfield above judgment line
        backend.save();
        backend.begin_path();
        backend.rect(x_offset, 0, total_width, hit_pos);
        backend.clip();

        // dim background for lanes
        backend.set_alpha(0.7);
        backend.draw_rect(x_offset, 0, total_width, hit_pos, "#000000");
        backend.set_alpha(1);

        // draw visible objects (those that haven't ended yet)
        for (const obj of this.objects) {
            if (obj.end_time < time) {
                continue;
            }

            if (is_hold(obj)) {
                this.draw_hold_note(obj, time, x_offset);
            } else {
                this.draw_note(obj, time, x_offset);
            }
        }

        // draw cover overlay for hd/fadein
        if (has_mod(this.mods, Mods.Hidden) || has_mod(this.mods, Mods.FadeIn)) {
            const coverage_ratio = has_mod(this.mods, Mods.Hidden) ? this.hd_coverage : this.fi_coverage;
            const total_h = hit_pos * coverage_ratio;
            const grad_h = hit_pos * this.gradient_ratio;

            if (has_mod(this.mods, Mods.Hidden)) {
                const start_y = hit_pos - total_h;
                const fade_end = grad_h / total_h;

                const gradient = backend.create_linear_gradient(x_offset, start_y, x_offset, hit_pos, [
                    { offset: 0.0, color: "rgba(0,0,0,0)" },
                    { offset: fade_end * 0.4, color: "rgba(0,0,0,0.3)" },
                    { offset: fade_end * 0.7, color: "rgba(0,0,0,0.75)" },
                    { offset: fade_end * 0.9, color: "rgba(0,0,0,0.95)" },
                    { offset: fade_end, color: "rgba(0,0,0,1)" },
                    { offset: 1.0, color: "rgba(0,0,0,1)" }
                ]);
                backend.draw_rect_gradient(x_offset, start_y, total_width, total_h, gradient);
            } else {
                const fade_start = (total_h - grad_h) / total_h;
                const gradient = backend.create_linear_gradient(x_offset, 0, x_offset, total_h, [
                    { offset: 0.0, color: "rgba(0,0,0,1)" },
                    { offset: fade_start, color: "rgba(0,0,0,1)" },
                    { offset: fade_start + (1 - fade_start) * 0.1, color: "rgba(0,0,0,0.95)" },
                    { offset: fade_start + (1 - fade_start) * 0.4, color: "rgba(0,0,0,0.75)" },
                    { offset: fade_start + (1 - fade_start) * 0.7, color: "rgba(0,0,0,0.3)" },
                    { offset: 1.0, color: "rgba(0,0,0,0)" }
                ]);
                backend.draw_rect_gradient(x_offset, 0, total_width, total_h, gradient);
            }
        }
        backend.restore();
        backend.restore();
    }

    private get_lane(obj: RenderHitObject): number {
        const pos = (obj.data as { pos: [number, number] }).pos;
        let lane = Math.floor((pos[0] * this.key_count) / 512);

        if (has_mod(this.mods, Mods.Mirror)) {
            lane = this.key_count - 1 - lane;
        }

        return lane;
    }

    private draw_note(obj: RenderHitObject, time: number, x_offset: number): void {
        const { backend, skin, key_count } = this;
        const lane = this.get_lane(obj);

        const lane_width = skin.mania_lane_width;
        const note_height = skin.mania_note_height;
        const spacing = skin.mania_lane_spacing;

        // calculate Y position from time difference
        const time_diff = obj.time - time;
        const y = this.time_to_y(time_diff);

        // skip if note is too far above screen
        if (y < -note_height - 64) {
            return;
        }

        const x = x_offset + lane * lane_width;
        const color = get_mania_lane_color(skin, key_count, lane);

        backend.set_alpha(1.0);
        backend.draw_rect(x + spacing, y - note_height, lane_width - 2 * spacing, note_height, color);
    }

    private draw_hold_note(obj: RenderHitObject, time: number, x_offset: number): void {
        const { backend, skin, key_count } = this;
        const data = obj.data as RenderHoldData;
        const lane = this.get_lane(obj);

        const lane_width = skin.mania_lane_width;
        const note_height = skin.mania_note_height;
        const spacing = skin.mania_lane_spacing;

        // calculate head and tail Y positions
        const head_time_diff = obj.time - time;
        const tail_time_diff = data.end_time - time;

        const head_y = this.time_to_y(head_time_diff);
        const tail_y = this.time_to_y(tail_time_diff);

        const x = x_offset + lane * lane_width;
        const color = get_mania_lane_color(skin, key_count, lane);

        // skip if entirely off screen
        if (tail_y < -64 && head_y < -64) {
            return;
        }

        // draw body (from tail to judgment line or head, whichever is lower)
        const body_top = tail_y;
        const body_bottom = head_time_diff < 0 ? skin.mania_hit_position : head_y;
        const body_height = body_bottom - body_top;

        if (body_height > 0) {
            backend.set_alpha(0.9);
            backend.draw_rect(x + spacing, body_top, lane_width - 2 * spacing, body_height, color);
        }

        // only draw head if not yet hit (before hit time)
        if (head_time_diff >= 0) {
            backend.set_alpha(1.0);
            backend.draw_rect(x + spacing, head_y - note_height, lane_width - 2 * spacing, note_height, color);
        }

        backend.set_alpha(1); // reset after hold note
    }

    private draw_judgment_line(x_offset: number): void {
        const { backend, skin, key_count } = this;
        const lane_width = skin.mania_lane_width;
        const hit_pos = skin.mania_hit_position;

        backend.draw_rect(x_offset, hit_pos - 1, lane_width * key_count, 2, "#ffffff");
    }

    private draw_lane_keys(time: number, x_offset: number): void {
        const { backend, skin, key_count } = this;
        const { mania_lane_width: lane_width, mania_hit_position: hit_pos, mania_lane_spacing: spacing, mania_note_height: note_height } = skin;
        const key_height = note_height + 5;

        const pressed = new Set<number>();
        const HIT_WINDOW = 50;

        for (const obj of this.objects) {
            if (time >= obj.time - HIT_WINDOW && time <= obj.end_time + HIT_WINDOW) {
                pressed.add(this.get_lane(obj));
            }
        }

        for (let i = 0; i < key_count; i++) {
            const is_pressed = pressed.has(i);
            const x = x_offset + i * lane_width;
            const color = get_mania_lane_color(skin, key_count, i);

            backend.set_alpha(0.3);
            backend.draw_rect(x + spacing, hit_pos, lane_width - 2 * spacing, key_height, color);

            if (is_pressed) {
                backend.set_alpha(1.0);
                backend.draw_rect(x + spacing, hit_pos, lane_width - 2 * spacing, key_height, "#ff6666");
            }
        }

        backend.set_alpha(1);
    }
}
