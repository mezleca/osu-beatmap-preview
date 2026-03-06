import type { IBeatmap } from "../types/beatmap";
import { HitObjectType } from "../types/beatmap";
import type { RenderHitObject, RenderCircleData, RenderSliderData, RenderSpinnerData, RenderHoldData, SliderPathType } from "./render_types";

type RawHitObject = Record<string, unknown> & {
    type?: number;
    objectType?: number;
    time?: number;
    startTime?: number;
    start_time?: number;
    endTime?: number;
    end_time?: number;
    x?: number;
    y?: number;
    column?: number;
    curveType?: string;
    curvePoints?: Array<{ x: number; y: number }>;
    slides?: number;
    length?: number;
};

const num = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
};

const resolve_start_time = (obj: RawHitObject): number => num(obj.time) ?? num(obj.startTime) ?? num(obj.start_time) ?? 0;
const resolve_end_time = (obj: RawHitObject, start: number): number => {
    const end = num(obj.endTime) ?? num(obj.end_time);
    if (end === null) return start;
    return Math.max(start, end);
};
const resolve_type = (obj: RawHitObject): number => num(obj.type) ?? num(obj.objectType) ?? 0;
const resolve_x = (obj: RawHitObject, default_columns: number): number => {
    const direct = num(obj.x);
    if (direct !== null) return direct;

    const column = num(obj.column);
    if (column !== null && default_columns > 0) {
        const clamped_column = Math.max(0, Math.min(default_columns - 1, Math.round(column)));
        return ((clamped_column + 0.5) / default_columns) * 512;
    }

    return 256;
};
const resolve_y = (obj: RawHitObject): number => num(obj.y) ?? 192;

export const build_render_objects = (beatmap: IBeatmap): RenderHitObject[] => {
    const objects: RenderHitObject[] = [];
    const default_columns = Math.max(
        1,
        Math.round(num((beatmap as unknown as { Difficulty?: { CircleSize?: unknown } }).Difficulty?.CircleSize) ?? 4)
    );

    for (const ho of beatmap.HitObjects) {
        const raw = ho as unknown as RawHitObject;
        const time = resolve_start_time(raw);
        const end_time = resolve_end_time(raw, time);
        const x = resolve_x(raw, default_columns);
        const y = resolve_y(raw);
        const type = resolve_type(raw);

        const base = {
            ...(ho as unknown as Record<string, unknown>),
            time,
            x,
            y,
            type,
            endTime: end_time,
            end_time,
            end_pos: [x, y],
            combo_number: 0,
            combo_count: 0,
            stack_height: 0,
            stack_offset: [0, 0],
            data: { pos: [x, y] } as RenderCircleData
        } as RenderHitObject;

        if ((type & HitObjectType.Slider) !== 0) {
            const curve_points = raw.curvePoints || [];
            const control_points: [number, number][] = [];
            for (let i = 0; i < curve_points.length; i++) {
                const point = curve_points[i];
                control_points.push([point.x, point.y]);
            }
            const slider_data: RenderSliderData = {
                pos: [x, y],
                path_type: ((raw.curveType as string | undefined) || "L") as SliderPathType,
                control_points,
                repetitions: (num(raw.slides) ?? 1) | 0,
                distance: num(raw.length) ?? 0
            };
            base.data = slider_data;
        } else if ((type & HitObjectType.Spinner) !== 0) {
            base.data = { end_time } as RenderSpinnerData;
            base.end_time = end_time;
            base.end_pos = [256, 192];
        } else if ((type & HitObjectType.Hold) !== 0) {
            base.data = { pos: [x, y], end_time } as RenderHoldData;
            base.end_time = end_time;
        }

        objects.push(base);
    }

    return objects;
};
