import type { IMod, IApplicableToRate } from "./types";

const RATE_MULTIPLIER = 0.75;

export const ModHalfTime: IMod & IApplicableToRate = {
    name: "Half Time",
    acronym: "HT",

    get_rate_multiplier: () => RATE_MULTIPLIER
};
