import type { IBeatmapDifficulty } from "./types";
import { Mods } from "../types/mods";
import { ModHardRock } from "./hard_rock";
import { ModEasy } from "./easy";
import { calculate_preempt, inverse_difficulty_range, PREEMPT_RANGE } from "../math/difficulty";

export type { IMod, IApplicableToDifficulty, IApplicableToRate, IBeatmapDifficulty } from "./types";
export { ModHardRock } from "./hard_rock";
export { ModEasy } from "./easy";
export { ModDoubleTime, ModNightcore } from "./double_time";
export { ModHalfTime } from "./half_time";
export { ModHidden, HD_FADE_IN_MULTIPLIER, HD_FADE_OUT_MULTIPLIER } from "./hidden";

// Core rate multiplier used by gameplay timing and audio speed.
export const get_rate_multiplier = (mods: number): number => {
    if (mods & (Mods.DoubleTime | Mods.Nightcore)) {
        return 1.5;
    }
    if (mods & Mods.HalfTime) {
        return 0.75;
    }
    return 1.0;
};

// Applies difficulty-changing mods in-place (CS/AR/OD/HP).
export const apply_mods_to_difficulty = (difficulty: IBeatmapDifficulty, mods: number): void => {
    if (mods & Mods.Easy) ModEasy.apply_to_difficulty(difficulty);
    if (mods & Mods.HardRock) ModHardRock.apply_to_difficulty(difficulty);
};

export const apply_rate_to_ar = (ar: number, rate: number): number => {
    if (rate === 1.0) return ar;

    // ar is defined via preempt ms; rate scales time, so scale preempt then invert back to ar
    const preempt_ms = calculate_preempt(ar) / rate;
    return inverse_difficulty_range(preempt_ms, PREEMPT_RANGE);
};

export const get_adjusted_difficulty = (cs: number, ar: number, od: number, hp: number, mods: number): IBeatmapDifficulty => {
    const difficulty: IBeatmapDifficulty = { cs, ar, od, hp };

    apply_mods_to_difficulty(difficulty, mods);

    const rate = get_rate_multiplier(mods);
    difficulty.ar = apply_rate_to_ar(difficulty.ar, rate);

    return difficulty;
};
