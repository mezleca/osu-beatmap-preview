import type { IBeatmap } from "../../types/beatmap";
import { is_hold } from "../../types/beatmap";
import { Mods, has_mod } from "../../types/mods";
import { BaseRenderer, type IRendererConfig, DEFAULT_RENDERER_CONFIG, PLAYFIELD_WIDTH, PLAYFIELD_HEIGHT } from "../base_renderer";
import type { IRenderBackend, RenderImage } from "../backend/render_backend";
import type { ISkinConfig } from "../../skin/skin_config";
import { get_mania_lane_color } from "../../skin/skin_config";
import type { RenderHitObject, RenderHoldData } from "../render_types";
import { build_render_objects } from "../render_objects";
import type { StandardSkinElements } from "../../skin/skin_elements";

const MAX_TIME_RANGE = 11485;
const BASE_SCROLL_SPEED = 8;
const HIT_WINDOW = 50;
const LANE_LIGHT_ALPHA = 0.4;
const LANE_FILL_ALPHA = 0.2;
const LANE_SEPARATOR_ALPHA = 0.68;
const NOTE_GRADIENT_TOP_ALPHA = 0.18;
const NOTE_GRADIENT_MID_ALPHA = 0.04;
const NOTE_GRADIENT_BOTTOM_ALPHA = 0.2;
const GLOW_MAIN_ALPHA = 0.5;
const GLOW_SECONDARY_ALPHA = 0.18;
const GLOW_FLASH_ALPHA = 0.5;

type LaneMetrics = {
    lane_width: number;
    note_height: number;
    spacing: number;
    hit_pos: number;
};

export class ManiaRenderer extends BaseRenderer {
    private static readonly MIN_KEY_COUNT = 1;
    private static readonly MAX_KEY_COUNT = 18;
    private static readonly DEFAULT_KEY_COUNT = 4;

    private key_count = 4;
    private scroll_time: number = MAX_TIME_RANGE / BASE_SCROLL_SPEED;
    private hd_coverage = 0.25;
    private fi_coverage = 0.6;
    private gradient_ratio = 0.2;

    private press_start_sorted: RenderHitObject[] = [];
    private press_end_sorted: RenderHitObject[] = [];
    private press_start_index = 0;
    private press_end_index = 0;
    private active_press_objects = new Set<RenderHitObject>();
    private active_press_lane_counts: number[] = [];
    private lane_impacts: number[] = [];
    private last_press_time = Number.NEGATIVE_INFINITY;

    private base_timing_points: Array<{ time: number; beat_length: number; meter: number }> = [];

    constructor(
        backend: IRenderBackend,
        skin: ISkinConfig,
        mods: number = 0,
        config: IRendererConfig = DEFAULT_RENDERER_CONFIG,
        skin_elements: StandardSkinElements | null = null
    ) {
        super(backend, skin, mods, config, skin_elements);
        this.update_scroll_time();
    }

    initialize(beatmap: IBeatmap): void {
        this.beatmap = beatmap;
        this.objects = build_render_objects(beatmap).sort((a, b) => a.time - b.time);
        this.key_count = this.resolve_key_count(beatmap);
        this.press_start_sorted = this.objects;
        this.press_end_sorted = this.objects.slice().sort((a, b) => a.end_time - b.end_time);
        this.base_timing_points = this.extract_base_timing_points(beatmap);
        this.reset_pressed_state();
    }

    set_mods(mods: number): void {
        this.mods = mods;
        this.update_scroll_time();
    }

    private update_scroll_time(): void {
        this.scroll_time = MAX_TIME_RANGE / BASE_SCROLL_SPEED;
    }

    private get_lane_metrics(): LaneMetrics {
        const lane_width = Math.max(1, Number.isFinite(this.skin.mania_lane_width) ? this.skin.mania_lane_width : 30);
        const note_height = Math.max(4, Number.isFinite(this.skin.mania_note_height) ? this.skin.mania_note_height : 15);
        const spacing = Math.max(0, Number.isFinite(this.skin.mania_lane_spacing) ? this.skin.mania_lane_spacing : 1);
        const hit_pos = Math.max(8, Math.min(PLAYFIELD_HEIGHT, Number.isFinite(this.skin.mania_hit_position) ? this.skin.mania_hit_position : 364));
        return { lane_width, note_height, spacing, hit_pos };
    }

    private time_to_y(time_diff: number, hit_pos: number): number {
        const progress = time_diff / this.scroll_time;
        return hit_pos - progress * hit_pos;
    }

    private get_stage_bottom_height(time: number, total_width: number): number {
        const stage_bottom = this.get_mania_texture("mania-stage-bottom", time);
        if (!stage_bottom) {
            return 0;
        }
        return Math.max(1, Math.round(stage_bottom.height * (total_width / Math.max(1, stage_bottom.width))));
    }

    private draw_clipped_note_with_gradient(
        x: number,
        y: number,
        width: number,
        height: number,
        color: string,
        clip_top: number,
        clip_bottom: number
    ): void {
        const top = Math.max(clip_top, y);
        const bottom = Math.min(clip_bottom, y + height);
        const clipped_height = bottom - top;
        if (clipped_height <= 0 || width <= 0) {
            return;
        }

        const backend = this.backend;
        backend.draw_rect(x, top, width, clipped_height, color);
        const gradient = backend.create_linear_gradient(x, top, x, top + clipped_height, [
            { offset: 0, color: `rgba(255,255,255,${NOTE_GRADIENT_TOP_ALPHA})` },
            { offset: 0.45, color: `rgba(255,255,255,${NOTE_GRADIENT_MID_ALPHA})` },
            { offset: 1, color: `rgba(0,0,0,${NOTE_GRADIENT_BOTTOM_ALPHA})` }
        ]);
        backend.draw_rect_gradient(x, top, width, clipped_height, gradient);
    }

    private get_lane(obj: RenderHitObject): number {
        const pos = (obj.data as { pos?: [number, number] }).pos;
        const x = Number.isFinite(pos?.[0]) ? (pos as [number, number])[0] : obj.x;
        let lane = Math.floor((x * this.key_count) / 512);
        if (!Number.isFinite(lane)) {
            lane = 0;
        }

        if (has_mod(this.mods, Mods.Mirror)) {
            lane = this.key_count - 1 - lane;
        }

        return Math.max(0, Math.min(this.key_count - 1, lane));
    }

    private resolve_key_count(beatmap: IBeatmap): number {
        const cs = beatmap?.Difficulty?.CircleSize;
        if (Number.isFinite(cs)) {
            const rounded = Math.round(cs as number);
            if (rounded >= ManiaRenderer.MIN_KEY_COUNT) {
                return Math.max(ManiaRenderer.MIN_KEY_COUNT, Math.min(ManiaRenderer.MAX_KEY_COUNT, rounded));
            }
        }

        const unique_x = new Set<number>();
        for (let i = 0; i < beatmap.HitObjects.length; i++) {
            const x = beatmap.HitObjects[i].x;
            if (Number.isFinite(x)) {
                unique_x.add(Math.round(x));
            }
        }

        const inferred = unique_x.size;
        if (inferred >= ManiaRenderer.MIN_KEY_COUNT && inferred <= ManiaRenderer.MAX_KEY_COUNT) {
            return inferred;
        }

        return ManiaRenderer.DEFAULT_KEY_COUNT;
    }

    private reset_pressed_state(): void {
        this.press_start_index = 0;
        this.press_end_index = 0;
        this.active_press_objects.clear();
        this.active_press_lane_counts = new Array(this.key_count).fill(0);
        this.lane_impacts = new Array(this.key_count).fill(0);
        this.last_press_time = Number.NEGATIVE_INFINITY;
    }

    private add_pressed_object(obj: RenderHitObject): void {
        if (this.active_press_objects.has(obj)) {
            return;
        }
        this.active_press_objects.add(obj);
        const lane = this.get_lane(obj);
        if (lane >= 0 && lane < this.active_press_lane_counts.length) {
            this.active_press_lane_counts[lane]++;
        }
    }

    private remove_pressed_object(obj: RenderHitObject): void {
        if (!this.active_press_objects.delete(obj)) {
            return;
        }
        const lane = this.get_lane(obj);
        if (lane >= 0 && lane < this.active_press_lane_counts.length && this.active_press_lane_counts[lane] > 0) {
            this.active_press_lane_counts[lane]--;
        }
    }

    private rebuild_pressed_state(time: number): void {
        this.active_press_objects.clear();
        this.active_press_lane_counts.fill(0);

        for (let i = 0; i < this.objects.length; i++) {
            const obj = this.objects[i];
            if (time >= obj.time - HIT_WINDOW && time <= obj.end_time + HIT_WINDOW) {
                this.add_pressed_object(obj);
            }
        }

        this.press_start_index = 0;
        while (this.press_start_index < this.press_start_sorted.length && this.press_start_sorted[this.press_start_index].time - HIT_WINDOW <= time) {
            this.press_start_index++;
        }

        this.press_end_index = 0;
        while (this.press_end_index < this.press_end_sorted.length && this.press_end_sorted[this.press_end_index].end_time + HIT_WINDOW < time) {
            this.press_end_index++;
        }
    }

    private update_pressed_state(time: number): void {
        const requires_rebuild = !Number.isFinite(this.last_press_time) || time < this.last_press_time || time - this.last_press_time > 1000;

        if (requires_rebuild) {
            this.rebuild_pressed_state(time);
            this.last_press_time = time;
            return;
        }

        while (this.press_start_index < this.press_start_sorted.length && this.press_start_sorted[this.press_start_index].time - HIT_WINDOW <= time) {
            this.add_pressed_object(this.press_start_sorted[this.press_start_index]);
            this.press_start_index++;
        }

        while (this.press_end_index < this.press_end_sorted.length && this.press_end_sorted[this.press_end_index].end_time + HIT_WINDOW < time) {
            this.remove_pressed_object(this.press_end_sorted[this.press_end_index]);
            this.press_end_index++;
        }

        this.last_press_time = time;
    }

    private extract_base_timing_points(beatmap: IBeatmap): Array<{ time: number; beat_length: number; meter: number }> {
        const points: Array<{ time: number; beat_length: number; meter: number }> = [];
        for (let i = 0; i < beatmap.TimingPoints.length; i++) {
            const p = beatmap.TimingPoints[i] as unknown as {
                time?: number;
                beatLength?: number;
                meter?: number;
                uninherited?: number;
            };
            const time = Number(p.time);
            const beat_length = Number(p.beatLength);
            const meter = Math.max(1, Math.round(Number(p.meter) || 4));
            const uninherited = Number(p.uninherited);
            if (!Number.isFinite(time) || !Number.isFinite(beat_length) || beat_length <= 0) {
                continue;
            }
            if (Number.isFinite(uninherited) && uninherited === 0) {
                continue;
            }
            points.push({ time, beat_length, meter });
        }

        if (points.length === 0) {
            points.push({ time: 0, beat_length: 600, meter: 4 });
        }

        points.sort((a, b) => a.time - b.time);
        return points;
    }

    private get_mania_texture(name: string, time: number): RenderImage | null {
        const key = name.toLowerCase();
        const animation = this.skin_elements?.mania_animations?.[key];
        if (animation && animation.length > 0) {
            const fps = this.skin.animation_framerate > 0 ? this.skin.animation_framerate : 60;
            const index = Math.floor((Math.max(0, time) / 1000) * fps) % animation.length;
            return animation[index];
        }
        return this.skin_elements?.mania_textures?.[key] ?? null;
    }

    private draw_column_sprite(texture: RenderImage, x: number, y: number, width: number, height: number): void {
        this.backend.draw_image(texture, x, y, Math.max(1, width), Math.max(1, height));
    }

    private get_column_fallback_index(lane: number): string {
        if (this.key_count % 2 === 1 && lane === Math.floor(this.key_count / 2)) {
            return "s";
        }

        const column_in_stage = lane % this.key_count;
        const distance_to_edge = Math.min(column_in_stage, this.key_count - 1 - column_in_stage);
        return distance_to_edge % 2 === 0 ? "1" : "2";
    }

    private draw_stage_background(time: number, x_offset: number, total_width: number, hit_pos: number, frame_bottom: number): void {
        const { backend, key_count } = this;
        const { lane_width, spacing } = this.get_lane_metrics();
        const lane_draw_width = Math.max(1, lane_width - 2 * spacing);

        const left = this.get_mania_texture("mania-stage-left", time);
        if (left && left.height > 0) {
            const width = left.width * (frame_bottom / left.height);
            backend.set_alpha(1);
            backend.draw_image(left, x_offset - width, 0, width, frame_bottom);
        }

        const right = this.get_mania_texture("mania-stage-right", time);
        if (right && right.height > 0) {
            const width = right.width * (frame_bottom / right.height);
            backend.set_alpha(1);
            backend.draw_image(right, x_offset + total_width, 0, width, frame_bottom);
        }

        const lane_light = this.get_mania_texture("mania-stage-light", time);
        if (lane_light) {
            for (let lane = 0; lane < key_count; lane++) {
                const x = x_offset + lane * lane_width + spacing;
                backend.set_alpha(LANE_LIGHT_ALPHA);
                this.draw_column_sprite(lane_light, x, 0, lane_draw_width, hit_pos);
            }
            backend.set_alpha(1);
            return;
        }

        for (let lane = 0; lane < key_count; lane++) {
            const x = x_offset + lane * lane_width + spacing;
            const color = get_mania_lane_color(this.skin, key_count, lane);
            backend.set_alpha(LANE_FILL_ALPHA);
            backend.draw_rect(x, 0, lane_draw_width, hit_pos, color);
        }

        backend.set_alpha(LANE_SEPARATOR_ALPHA);
        for (let lane = 1; lane < key_count; lane++) {
            const x = x_offset + lane * lane_width;
            backend.draw_rect(x - 0.75, 0, 1.5, hit_pos, "#ffffff");
        }
        backend.set_alpha(1);
    }

    private draw_bar_lines(time: number, x_offset: number, total_width: number, hit_pos: number): void {
        const backend = this.backend;
        const window_end = time + this.scroll_time;

        for (let i = 0; i < this.base_timing_points.length; i++) {
            const tp = this.base_timing_points[i];
            const next_time = i + 1 < this.base_timing_points.length ? this.base_timing_points[i + 1].time : Number.POSITIVE_INFINITY;
            const seg_start = Math.max(time, tp.time);
            const seg_end = Math.min(window_end, next_time);
            if (seg_end <= seg_start) {
                continue;
            }

            const first_index = Math.max(0, Math.ceil((seg_start - tp.time) / tp.beat_length));
            const last_index = Math.floor((seg_end - tp.time) / tp.beat_length);
            for (let beat_index = first_index; beat_index <= last_index; beat_index++) {
                const beat_time = tp.time + beat_index * tp.beat_length;
                const y = this.time_to_y(beat_time - time, hit_pos);
                if (y < 0 || y > hit_pos) {
                    continue;
                }

                const is_bar = beat_index % tp.meter === 0;
                backend.set_alpha(is_bar ? 0.3 : 0.16);
                backend.draw_rect(x_offset, y, total_width, is_bar ? 1.25 : 1, "#ffffff");
            }
        }

        backend.set_alpha(1);
    }

    private draw_note(obj: RenderHitObject, time: number, x_offset: number, metrics: LaneMetrics): void {
        const { lane_width, note_height, spacing, hit_pos } = metrics;
        const lane = this.get_lane(obj);
        const y = this.time_to_y(obj.time - time, hit_pos);

        if (y < -note_height - 64 || y > hit_pos + note_height + 8) {
            return;
        }

        const x = x_offset + lane * lane_width;
        const width = Math.max(1, lane_width - 2 * spacing);
        const color = get_mania_lane_color(this.skin, this.key_count, lane);

        this.backend.set_alpha(1);
        this.draw_clipped_note_with_gradient(x + spacing, y - note_height, width, note_height, color, 0, hit_pos);
    }

    private draw_hold_note(obj: RenderHitObject, time: number, x_offset: number, metrics: LaneMetrics): void {
        const { lane_width, note_height, spacing, hit_pos } = metrics;
        const hold = obj.data as RenderHoldData;
        const lane = this.get_lane(obj);

        const head_y = this.time_to_y(obj.time - time, hit_pos);
        const tail_y = this.time_to_y(hold.end_time - time, hit_pos);
        if (tail_y > hit_pos + note_height + 8 && head_y > hit_pos + note_height + 8) {
            return;
        }
        if (tail_y < -64 && head_y < -64) {
            return;
        }

        const x = x_offset + lane * lane_width;
        const width = Math.max(1, lane_width - 2 * spacing);
        const color = get_mania_lane_color(this.skin, this.key_count, lane);

        const body_top = tail_y;
        const body_bottom = obj.time <= time ? hit_pos : head_y;
        const body_height = body_bottom - body_top;

        if (body_height > 0) {
            this.backend.set_alpha(0.92);
            this.draw_clipped_note_with_gradient(x + spacing, body_top, width, body_height, color, 0, hit_pos);
        }

        if (obj.time >= time) {
            this.backend.set_alpha(1);
            this.draw_clipped_note_with_gradient(x + spacing, head_y - note_height, width, note_height, color, 0, hit_pos);
        }

        if (hold.end_time >= time) {
            this.backend.set_alpha(1);
            this.draw_clipped_note_with_gradient(x + spacing, tail_y - note_height, width, note_height, color, 0, hit_pos);
        }

        this.backend.set_alpha(1);
    }

    private draw_hit_glow(time: number, x_offset: number, metrics: LaneMetrics): void {
        const { lane_width, spacing, hit_pos } = metrics;
        const { backend, key_count } = this;
        if (this.active_press_objects.size === 0) {
            return;
        }

        const lane_impacts = this.lane_impacts;
        if (lane_impacts.length !== key_count) {
            this.lane_impacts = new Array<number>(key_count).fill(0);
        } else {
            lane_impacts.fill(0);
        }
        const impacts = this.lane_impacts;
        for (const obj of this.active_press_objects) {
            let impact = 0;
            if (is_hold(obj)) {
                const hold = obj.data as RenderHoldData;
                if (time >= obj.time && time <= hold.end_time) {
                    impact = 0.35;
                } else if (time < obj.time) {
                    const in_diff = obj.time - time;
                    if (in_diff <= 120) {
                        impact = (1 - in_diff / 120) * 0.7;
                    }
                } else {
                    const out_diff = time - hold.end_time;
                    if (out_diff <= 120) {
                        impact = (1 - out_diff / 120) * 0.35;
                    }
                }
            } else {
                const diff = Math.abs(time - obj.time);
                if (diff <= 120) {
                    impact = 1 - diff / 120;
                }
            }

            if (impact <= 0) {
                continue;
            }

            const lane = this.get_lane(obj);
            if (impact > impacts[lane]) {
                impacts[lane] = impact;
            }
        }

        const light_texture = this.get_mania_texture("mania-stage-light", time);
        backend.set_blend_mode("lighter");
        for (let lane = 0; lane < key_count; lane++) {
            const impact = impacts[lane];
            if (impact <= 0) {
                continue;
            }

            const x = x_offset + lane * lane_width + spacing;
            const width = Math.max(1, lane_width - 2 * spacing);
            const center_x = x + width * 0.5;

            if (light_texture) {
                const glow_height = Math.max(16, hit_pos * (0.55 + impact * 0.25));
                backend.set_alpha(GLOW_MAIN_ALPHA * impact);
                backend.draw_image(light_texture, x, hit_pos - glow_height, width, glow_height);
                backend.set_alpha(GLOW_SECONDARY_ALPHA * impact);
                backend.draw_image(light_texture, x, hit_pos - glow_height * 0.7, width, glow_height * 0.7);
            } else {
                const beam_height = Math.max(16, 72 * impact);
                const beam_width = Math.max(2, width * 0.16);
                backend.set_alpha(0.4 * impact);
                backend.draw_rect(center_x - beam_width * 0.5, hit_pos - beam_height, beam_width, beam_height, "#cfe9ff");
            }

            const flash_width = Math.max(3, width * 0.6);
            backend.set_alpha(GLOW_FLASH_ALPHA * impact);
            backend.draw_rect(center_x - flash_width * 0.5, hit_pos - 2, flash_width, 4, "#ffffff");
        }
        backend.set_blend_mode("normal");
        backend.set_alpha(1);
    }

    private draw_judgment_line(x_offset: number, metrics: LaneMetrics): void {
        const { lane_width, hit_pos } = metrics;
        const total_width = lane_width * this.key_count;
        const hint_texture = this.get_mania_texture("mania-stage-hint", 0);

        if (hint_texture) {
            const hint_height = Math.max(2, Math.round(hint_texture.height * (total_width / Math.max(1, hint_texture.width))));
            this.backend.set_alpha(1);
            this.backend.draw_image(hint_texture, x_offset, hit_pos - hint_height, total_width, hint_height);
            return;
        }

        this.backend.draw_rect(x_offset, hit_pos - 1, total_width, 2, "#ffffff");
    }

    private draw_lane_keys(time: number, x_offset: number, metrics: LaneMetrics): void {
        const { lane_width, hit_pos, spacing, note_height } = metrics;
        const key_height = note_height + 5;
        this.update_pressed_state(time);

        for (let i = 0; i < this.key_count; i++) {
            const is_pressed = (this.active_press_lane_counts[i] ?? 0) > 0;
            const x = x_offset + i * lane_width;
            const color = get_mania_lane_color(this.skin, this.key_count, i);
            const column = this.get_column_fallback_index(i);
            const key_texture = this.get_mania_texture(`mania-key${column}`, time);
            const key_down_texture = this.get_mania_texture(`mania-key${column}d`, time);
            const width = Math.max(1, lane_width - 2 * spacing);

            if (is_pressed && key_down_texture) {
                this.backend.set_alpha(1);
                this.draw_column_sprite(key_down_texture, x + spacing, hit_pos, width, key_height);
                continue;
            }

            if (key_texture) {
                this.backend.set_alpha(1);
                this.draw_column_sprite(key_texture, x + spacing, hit_pos, width, key_height);
                continue;
            }

            this.backend.set_alpha(0.38);
            this.backend.draw_rect(x + spacing, hit_pos, width, key_height, color);

            if (is_pressed) {
                this.backend.set_alpha(0.72);
                this.backend.draw_rect(x + spacing, hit_pos, width, key_height, "#ff6666");
            }
        }

        const stage_bottom = this.get_mania_texture("mania-stage-bottom", time);
        if (stage_bottom) {
            const total_width = this.key_count * lane_width;
            const height = Math.max(1, Math.round(stage_bottom.height * (total_width / Math.max(1, stage_bottom.width))));
            this.backend.set_alpha(1);
            this.backend.draw_image(stage_bottom, x_offset, hit_pos, total_width, height);
        }

        this.backend.set_alpha(1);
    }

    private draw_playfield_frame(x_offset: number, total_width: number, frame_bottom: number): void {
        const frame_top = 0;
        const frame_height = Math.max(1, frame_bottom - frame_top);

        this.backend.set_alpha(0.92);
        this.backend.draw_rect(x_offset, frame_top, total_width, 1.5, "#f0f4ff");
        this.backend.draw_rect(x_offset, frame_bottom - 1.5, total_width, 1.5, "#f0f4ff");
        this.backend.draw_rect(x_offset, frame_top, 1.5, frame_height, "#f0f4ff");
        this.backend.draw_rect(x_offset + total_width - 1.5, frame_top, 1.5, frame_height, "#f0f4ff");
        this.backend.set_alpha(1);
    }

    render(time: number): void {
        const { backend, config } = this;
        const metrics = this.get_lane_metrics();
        const total_width = Math.max(1, this.key_count * metrics.lane_width);
        const x_offset = Math.floor((PLAYFIELD_WIDTH - total_width) / 2);
        const stage_bottom_height = this.get_stage_bottom_height(time, total_width);
        const frame_bottom = metrics.hit_pos + metrics.note_height + 5 + stage_bottom_height;

        this.render_background();

        backend.save();
        backend.translate(config.offset_x, config.offset_y);
        backend.scale(config.scale, config.scale);

        this.draw_stage_background(time, x_offset, total_width, metrics.hit_pos, frame_bottom);
        this.draw_bar_lines(time, x_offset, total_width, metrics.hit_pos);

        backend.set_alpha(0.55);
        backend.draw_rect(x_offset, 0, total_width, metrics.hit_pos, "#000000");
        backend.set_alpha(1);

        for (let i = 0; i < this.objects.length; i++) {
            const obj = this.objects[i];
            if (is_hold(obj)) {
                this.draw_hold_note(obj, time, x_offset, metrics);
            } else {
                this.draw_note(obj, time, x_offset, metrics);
            }
        }

        this.draw_hit_glow(time, x_offset, metrics);
        this.draw_judgment_line(x_offset, metrics);
        this.draw_lane_keys(time, x_offset, metrics);
        this.draw_playfield_frame(x_offset, total_width, frame_bottom);

        const hidden_mod = has_mod(this.mods, Mods.Hidden);
        const fade_in_mod = has_mod(this.mods, Mods.FadeIn);
        if (hidden_mod || fade_in_mod) {
            const coverage_ratio = hidden_mod ? this.hd_coverage : this.fi_coverage;
            const total_h = metrics.hit_pos * coverage_ratio;
            const grad_h = metrics.hit_pos * this.gradient_ratio;

            if (hidden_mod) {
                const start_y = metrics.hit_pos - total_h;
                const fade_end = grad_h / total_h;

                const gradient = backend.create_linear_gradient(x_offset, start_y, x_offset, metrics.hit_pos, [
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
    }
}
