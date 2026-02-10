import type { IBeatmap } from "../types/beatmap";
import { HitObjectType } from "../types/beatmap";
import type { RenderHitObject, RenderCircleData, RenderSliderData, RenderSpinnerData, RenderHoldData, SliderPathType } from "./render_types";

export const build_render_objects = (beatmap: IBeatmap): RenderHitObject[] => {
    const objects: RenderHitObject[] = [];

    for (const ho of beatmap.HitObjects) {
        const base: RenderHitObject = {
            ...ho,
            end_time: ho.endTime || ho.time,
            end_pos: [ho.x, ho.y],
            combo_number: 0,
            combo_count: 0,
            data: { pos: [ho.x, ho.y] } as RenderCircleData
        };

        if (ho.type & HitObjectType.Slider) {
            const slider_data: RenderSliderData = {
                pos: [ho.x, ho.y],
                path_type: (ho.curveType || "L") as SliderPathType,
                control_points: (ho.curvePoints || []).map((p) => [p.x, p.y] as [number, number]),
                repetitions: ho.slides || 1,
                distance: ho.length || 0
            };
            base.data = slider_data;
        } else if (ho.type & HitObjectType.Spinner) {
            const end_time = ho.endTime || ho.time;
            base.data = { end_time } as RenderSpinnerData;
            base.end_time = end_time;
            base.end_pos = [256, 192];
        } else if (ho.type & HitObjectType.Hold) {
            const end_time = ho.endTime || ho.time;
            base.data = { pos: [ho.x, ho.y], end_time } as RenderHoldData;
            base.end_time = end_time;
        }

        objects.push(base);
    }

    return objects;
};
