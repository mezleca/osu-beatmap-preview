import type { RenderHitObject } from "../render_types";
import type { IRenderBackend } from "../backend/render_backend";
import type { ISkinConfig } from "../../skin/skin_config";
import { Mods, has_mod } from "../../types/mods";
import { clamp, vec2_lerp, type Vec2 } from "../../math/vector2";
import { Easing } from "../drawable/transforms";
import { is_spinner } from "../../types/beatmap";

type FollowPoint = {
    start_pos: Vec2;
    end_pos: Vec2;
    dir: Vec2;
    fade_in_time: number;
    fade_out_time: number;
};

type FollowLine = {
    start_pos: Vec2;
    end_pos: Vec2;
    dir: Vec2;
    start_time: number;
    end_time: number;
    appear_time: number;
    grow_end_time: number;
    shrink_start_time: number;
    shrink_end_time: number;
};

export class FollowPointRenderer {
    private skin: ISkinConfig;
    private mods: number;
    private preempt: number;
    private fade_in: number;
    private radius: number;
    private points: FollowPoint[] = [];
    private lines: FollowLine[] = [];

    constructor(skin: ISkinConfig, mods: number, preempt: number, fade_in: number, radius: number) {
        this.skin = skin;
        this.mods = mods;
        this.preempt = preempt;
        this.fade_in = fade_in;
        this.radius = radius;
    }

    update_settings(mods: number, preempt: number, fade_in: number, radius: number): void {
        this.mods = mods;
        this.preempt = preempt;
        this.fade_in = fade_in;
        this.radius = radius;
    }

    build(objects: RenderHitObject[]): void {
        this.points = [];
        this.lines = [];

        const SPACING = 32;
        const preempt = Math.max(450, this.preempt * 0.9);

        for (let i = 0; i < objects.length - 1; i++) {
            const prev = objects[i];
            const next = objects[i + 1];

            if (is_spinner(prev) || is_spinner(next)) continue;
            if (prev.combo_number !== next.combo_number) continue;

            const start_pos = prev.end_pos;
            const end_pos = (next.data as { pos: Vec2 }).pos;
            const dx = end_pos[0] - start_pos[0];
            const dy = end_pos[1] - start_pos[1];
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < SPACING * 1.5) continue;

            const start_time = prev.end_time;
            const duration = next.time - start_time;
            if (duration <= 0) continue;

            const inv_distance = distance > 0 ? 1 / distance : 0;
            const dir: Vec2 = [dx * inv_distance, dy * inv_distance];

            const appear_time = start_time - preempt;
            const grow_end_time = next.time - preempt;
            let shrink_start_time = start_time + (grow_end_time - start_time) * 0.5;
            let shrink_end_time = next.time;

            if (has_mod(this.mods, Mods.Hidden)) {
                shrink_start_time = start_time + (grow_end_time - start_time) * 0.3;
                shrink_end_time = start_time + (next.time - start_time) * 0.65;
            }

            this.lines.push({
                start_pos,
                end_pos,
                dir,
                start_time,
                end_time: next.time,
                appear_time,
                grow_end_time,
                shrink_start_time,
                shrink_end_time
            });

            for (let d = SPACING * 1.5; d < distance - SPACING; d += SPACING) {
                const fraction = d / distance;
                let fade_out_time = prev.end_time + fraction * duration;
                const fade_in_time = Math.max(prev.end_time, fade_out_time - preempt);
                if (has_mod(this.mods, Mods.Hidden)) {
                    fade_out_time = Math.min(fade_out_time, start_time + duration * 0.65);
                }

                const point_start: Vec2 = [start_pos[0] + (fraction - 0.1) * dx, start_pos[1] + (fraction - 0.1) * dy];
                const point_end: Vec2 = [start_pos[0] + fraction * dx, start_pos[1] + fraction * dy];

                this.points.push({
                    start_pos: point_start,
                    end_pos: point_end,
                    dir,
                    fade_in_time,
                    fade_out_time
                });
            }
        }
    }

    render(time: number, backend: IRenderBackend, get_circle_alpha: (time: number, hit_time: number) => number): void {
        const shape = this.skin.follow_point_shape;
        const mode = this.skin.follow_point_mode ?? "segments";
        const line_length = this.skin.follow_point_length || this.radius * 0.6;
        const gap_ratio = clamp(this.skin.follow_point_line_gap ?? 0, 0, 0.9);

        const fade_duration = Math.max(this.fade_in * 0.15, 50);
        const alpha_mul = 0.2;

        if (mode === "full") {
            for (const line of this.lines) {
                if (time < line.appear_time || time > line.shrink_end_time) continue;

                let alpha = 0;
                let x0 = line.start_pos[0];
                let y0 = line.start_pos[1];
                let x1 = line.end_pos[0];
                let y1 = line.end_pos[1];

                const line_len = Math.hypot(x1 - x0, y1 - y0);
                const alpha_gate = this.get_alpha_gate(time, line.start_time, line.end_time, get_circle_alpha);
                if (alpha_gate <= 0.01) continue;

                const inset_base = this.radius * 1.05;
                const inset = Math.min(inset_base, line_len * 0.22);
                x0 += line.dir[0] * inset;
                y0 += line.dir[1] * inset;
                x1 -= line.dir[0] * inset;
                y1 -= line.dir[1] * inset;

                if (time < line.grow_end_time) {
                    const duration = Math.max(1, line.grow_end_time - line.appear_time);
                    const progress = clamp((time - line.appear_time) / duration, 0, 1);
                    const eased = Easing.OutQuint(progress);
                    alpha = eased;
                    x1 = x0 + (x1 - x0) * eased;
                    y1 = y0 + (y1 - y0) * eased;
                } else if (time < line.shrink_start_time) {
                    alpha = 1;
                } else {
                    const duration = Math.max(1, line.shrink_end_time - line.shrink_start_time);
                    const progress = clamp((time - line.shrink_start_time) / duration, 0, 1);
                    const eased = Easing.InQuint(progress);
                    alpha = 1;
                    x0 = x0 + (x1 - x0) * eased;
                    y0 = y0 + (y1 - y0) * eased;
                }

                if (alpha <= 0) continue;

                backend.set_alpha(alpha * alpha_mul * alpha_gate);

                if (shape === "line") {
                    if (gap_ratio > 0) {
                        const len = Math.hypot(x1 - x0, y1 - y0);
                        const dir_x = line.dir[0];
                        const dir_y = line.dir[1];
                        const gap_half = (len * gap_ratio) / 2;
                        const mid_x = (x0 + x1) / 2;
                        const mid_y = (y0 + y1) / 2;
                        const gx0 = mid_x - dir_x * gap_half;
                        const gy0 = mid_y - dir_y * gap_half;
                        const gx1 = mid_x + dir_x * gap_half;
                        const gy1 = mid_y + dir_y * gap_half;

                        backend.draw_line(x0, y0, gx0, gy0, "rgba(255,255,255,1)", this.skin.follow_point_width, "round", "round");
                        backend.draw_line(gx1, gy1, x1, y1, "rgba(255,255,255,1)", this.skin.follow_point_width, "round", "round");
                    } else {
                        backend.draw_line(x0, y0, x1, y1, "rgba(255,255,255,1)", this.skin.follow_point_width, "round", "round");
                    }
                } else {
                    const radius = this.radius * 0.12;
                    const x = (line.start_pos[0] + line.end_pos[0]) / 2;
                    const y = (line.start_pos[1] + line.end_pos[1]) / 2;
                    backend.draw_circle(x, y, radius, "rgba(255,255,255,1)", "transparent", 0);
                }
            }
        } else {
            for (const point of this.points) {
                if (time < point.fade_in_time || time > point.fade_out_time + fade_duration) continue;

                let alpha = 0;
                let scale = 1;
                let pos = point.end_pos;

                if (time < point.fade_in_time + fade_duration) {
                    const fade_in_progress = clamp((time - point.fade_in_time) / fade_duration, 0, 1);
                    const eased = Easing.OutCubic(fade_in_progress);
                    alpha = eased;
                    scale = 1.5 - 0.5 * eased;
                    pos = vec2_lerp(point.start_pos, point.end_pos, eased);
                } else if (time <= point.fade_out_time) {
                    alpha = 1;
                    scale = 1;
                    pos = point.end_pos;
                } else {
                    const fade_out_progress = clamp((time - point.fade_out_time) / fade_duration, 0, 1);
                    const eased = Easing.OutCubic(fade_out_progress);
                    alpha = 1 - eased;
                    scale = 1;
                    pos = vec2_lerp(point.start_pos, point.end_pos, 1 - eased);
                }

                if (alpha <= 0) continue;

                const alpha_gate = this.get_alpha_gate(time, point.fade_in_time + this.preempt, point.fade_out_time, get_circle_alpha);
                if (alpha_gate <= 0.01) continue;

                backend.set_alpha(alpha * alpha_mul * alpha_gate);

                if (shape === "line") {
                    const len = line_length * scale;
                    const half = len / 2;
                    const dir_x = point.dir[0];
                    const dir_y = point.dir[1];
                    const x0 = pos[0] - dir_x * half;
                    const y0 = pos[1] - dir_y * half;
                    const x1 = pos[0] + dir_x * half;
                    const y1 = pos[1] + dir_y * half;

                    backend.draw_line(x0, y0, x1, y1, "rgba(255,255,255,1)", this.skin.follow_point_width, "round", "round");
                } else {
                    const radius = this.radius * 0.12 * scale;
                    backend.draw_circle(pos[0], pos[1], radius, "rgba(255,255,255,1)", "transparent", 0);
                }
            }
        }

        backend.set_alpha(1);
    }

    private get_alpha_gate(time: number, start_time: number, end_time: number, get_circle_alpha: (time: number, hit_time: number) => number): number {
        const start_alpha = get_circle_alpha(time, start_time);
        const end_alpha = get_circle_alpha(time, end_time);
        return clamp(Math.min(start_alpha, end_alpha) / 0.7, 0, 1);
    }
}
