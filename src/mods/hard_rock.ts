import type { IMod, IApplicableToDifficulty, IBeatmapDifficulty } from "./types";

const ADJUST_RATIO = 1.4;
const CS_RATIO = 1.3;

export const ModHardRock: IMod & IApplicableToDifficulty = {
    name: "Hard Rock",
    acronym: "HR",

    apply_to_difficulty(d: IBeatmapDifficulty): void {
        d.cs = Math.min(d.cs * CS_RATIO, 10);
        d.ar = Math.min(d.ar * ADJUST_RATIO, 10);
        d.od = Math.min(d.od * ADJUST_RATIO, 10);
        d.hp = Math.min(d.hp * ADJUST_RATIO, 10);
    }
};
