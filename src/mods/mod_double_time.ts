import type { IMod, IApplicableToRate } from "./types";

const RATE_MULTIPLIER = 1.5;

export const ModDoubleTime: IMod & IApplicableToRate = {
    name: "Double Time",
    acronym: "DT",

    get_rate_multiplier: () => RATE_MULTIPLIER
};

export const ModNightcore: IMod & IApplicableToRate = {
    name: "Nightcore",
    acronym: "NC",

    get_rate_multiplier: () => RATE_MULTIPLIER
};
