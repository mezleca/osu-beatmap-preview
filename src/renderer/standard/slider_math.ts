import type { IBeatmap } from "../../types/beatmap";
import type { TimingState } from "./timing_state";

const BASE_SCORING_DISTANCE = 100;

export const calculate_slider_duration = (distance: number, beatmap: IBeatmap, timing_state: TimingState): number => {
    if (distance <= 0) return 0;
    return (distance * timing_state.base_beat_length) / (BASE_SCORING_DISTANCE * beatmap.sv * timing_state.sv_multiplier);
};

export const calculate_tick_spacing = (beatmap: IBeatmap, timing_state: TimingState): { tick_distance: number; min_distance_from_end: number } => {
    const sv_multiplier = timing_state.sv_multiplier || 1;
    const scoring_distance = BASE_SCORING_DISTANCE * beatmap.sv * sv_multiplier;
    const tick_distance_multiplier = beatmap.format_version < 8 ? 1 / sv_multiplier : 1;
    const tick_distance = (scoring_distance / beatmap.tick_rate) * tick_distance_multiplier;
    const velocity = scoring_distance / timing_state.base_beat_length;

    return {
        tick_distance,
        min_distance_from_end: velocity * 10
    };
};
