export interface IDifficultyRange {
    min: number;
    mid: number;
    max: number;
}

export const PREEMPT_RANGE: IDifficultyRange = { min: 1800, mid: 1200, max: 450 };
export const PREEMPT_MIN = 450;

export const difficulty_range = (difficulty: number, range: IDifficultyRange): number => {
    if (difficulty > 5) {
        return range.mid + ((range.max - range.mid) * (difficulty - 5)) / 5;
    }
    if (difficulty < 5) {
        return range.mid + ((range.mid - range.min) * (difficulty - 5)) / 5;
    }
    return range.mid;
};

export const inverse_difficulty_range = (value: number, range: IDifficultyRange): number => {
    const toward_max = Math.sign(value - range.mid) === Math.sign(range.max - range.mid);
    if (toward_max) return ((value - range.mid) / (range.max - range.mid)) * 5 + 5;
    return ((value - range.mid) / (range.mid - range.min)) * 5 + 5;
};

export const calculate_preempt = (ar: number): number => difficulty_range(ar, PREEMPT_RANGE);
export const calculate_fade_in = (preempt: number): number => 400 * Math.min(1, preempt / PREEMPT_MIN);

// lazer formula: scale = (1 - 0.7 * ((cs - 5) / 5)) / 2
// CS 0 = scale 0.85, radius = 54.4
// CS 5 = scale 0.50, radius = 32
// CS 10 = scale 0.15, radius = 9.6
export const calculate_scale = (cs: number): number => {
    const normalized = (cs - 5) / 5; // maps [0, 10] to [-1, 1]
    return (1 - 0.7 * normalized) / 2;
};

// OBJECT_RADIUS in lazer is 64, so radius = scale * 64
export const calculate_radius = (cs: number): number => calculate_scale(cs) * 64;
