import type { IBeatmap, IHitObject, IHoldData } from "../../types/beatmap";
import { is_hold } from "../../types/beatmap";
import { get_rate_multiplier } from "../../mods";
import { BaseRenderer, type IRendererConfig, DEFAULT_RENDERER_CONFIG, PLAYFIELD_WIDTH, PLAYFIELD_HEIGHT } from "../base_renderer";
import type { IRenderBackend } from "../backend/render_backend";
import type { ISkinConfig } from "../../skin/skin_config";
import { get_mania_lane_color } from "../../skin/skin_config";

// lazer scroll time constants (from DrawableManiaRuleset.cs)
const MAX_TIME_RANGE = 11485;
const BASE_SCROLL_SPEED = 20;

export class ManiaRenderer extends BaseRenderer {
    private key_count: number = 4;
    private scroll_time: number = MAX_TIME_RANGE / BASE_SCROLL_SPEED;

    constructor(backend: IRenderBackend, skin: ISkinConfig, mods: number = 0, config: IRendererConfig = DEFAULT_RENDERER_CONFIG) {
        super(backend, skin, mods, config);
        this.update_scroll_time();
    }

    initialize(beatmap: IBeatmap): void {
        this.beatmap = beatmap;
        this.objects = [...beatmap.objects];
        this.key_count = Math.floor(beatmap.cs);

        for (const obj of this.objects) {
            if (is_hold(obj)) {
                obj.end_time = (obj.data as IHoldData).end_time;
            }
        }
    }

    set_mods(mods: number): void {
        this.mods = mods;
        this.update_scroll_time();
    }

    private update_scroll_time(): void {
        const rate = get_rate_multiplier(this.mods);
        // base scroll time adjusted by rate (DT makes notes scroll faster)
        this.scroll_time = MAX_TIME_RANGE / (BASE_SCROLL_SPEED * rate);
    }

    // convert time difference to Y position on screen
    private time_to_y(time_diff: number): number {
        const hit_pos = this.skin.mania_hit_position;
        // notes scroll from top (y=0) toward hit position (y=hit_pos)
        // time_diff > 0 means note is in the future, so above hit line
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

        // render visible objects (those that haven't ended yet)
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

        backend.restore();
        backend.restore();
    }

    private get_lane(obj: IHitObject): number {
        const pos = (obj.data as { pos: [number, number] }).pos;
        return Math.floor((pos[0] * this.key_count) / 512);
    }

    private draw_note(obj: IHitObject, time: number, x_offset: number): void {
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

    private draw_hold_note(obj: IHitObject, time: number, x_offset: number): void {
        const { backend, skin, key_count } = this;
        const data = obj.data as IHoldData;
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
    }

    private draw_judgment_line(x_offset: number): void {
        const { backend, skin, key_count } = this;
        const lane_width = skin.mania_lane_width;
        const hit_pos = skin.mania_hit_position;

        backend.draw_rect(x_offset, hit_pos - 1, lane_width * key_count, 2, "#ffffff");
    }

    private draw_lane_keys(time: number, x_offset: number): void {
        const { backend, skin, key_count } = this;
        const lane_width = skin.mania_lane_width;
        const hit_pos = skin.mania_hit_position;
        const key_height = skin.mania_note_height + 5;

        // detect pressed lanes (autoplay simulation)
        const pressed = new Set<number>();
        const HIT_WINDOW = 50;

        for (const obj of this.objects) {
            if (time >= obj.time - HIT_WINDOW && time <= obj.end_time + HIT_WINDOW) {
                pressed.add(this.get_lane(obj));
            }
        }

        // draw keys at judgment line position
        for (let i = 0; i < key_count; i++) {
            const is_pressed = pressed.has(i);
            const x = x_offset + i * lane_width;
            const color = get_mania_lane_color(skin, key_count, i);

            // keys at bottom of playfield, just below judgment line
            const key_y = hit_pos;

            // key background
            backend.set_alpha(0.3);
            backend.draw_rect(x + skin.mania_lane_spacing, key_y, lane_width - 2 * skin.mania_lane_spacing, key_height, color);

            // key pressed highlight
            if (is_pressed) {
                backend.set_alpha(1.0);
                backend.draw_rect(x + skin.mania_lane_spacing, key_y, lane_width - 2 * skin.mania_lane_spacing, key_height, "#ff6666");
            }
        }

        backend.set_alpha(1);
    }
}
