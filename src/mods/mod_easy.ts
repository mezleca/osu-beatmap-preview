import type { IMod, IApplicableToDifficulty, IBeatmapDifficulty } from "./types";

const ADJUST_RATIO = 0.5;

export const ModEasy: IMod & IApplicableToDifficulty = {
    name: "Easy",
    acronym: "EZ",

    apply_to_difficulty(d: IBeatmapDifficulty): void {
        d.cs *= ADJUST_RATIO;
        d.ar *= ADJUST_RATIO;
        d.od *= ADJUST_RATIO;
        d.hp *= ADJUST_RATIO;
    }
};
