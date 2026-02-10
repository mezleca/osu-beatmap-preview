import type { HitObject as OsuHitObject } from "@rel-packages/osu-beatmap-parser/dist/types/types";
import type { Vec2 } from "../math/vector2";

export type SliderPathType = "L" | "B" | "P" | "C";

export type RenderCircleData = { pos: Vec2 };
export type RenderSliderData = {
    pos: Vec2;
    path_type: SliderPathType;
    control_points: Vec2[];
    distance: number;
    repetitions: number;
    duration?: number;
    computed_path?: Vec2[];
};
export type RenderSpinnerData = { end_time: number };
export type RenderHoldData = { pos: Vec2; end_time: number };
export type RenderObjectData = RenderCircleData | RenderSliderData | RenderSpinnerData | RenderHoldData;

export type RenderHitObject = OsuHitObject & {
    end_time: number;
    end_pos: Vec2;
    combo_number: number;
    combo_count: number;
    data: RenderObjectData;
};
