export const Mods = {
    None: 0,
    NoFail: 1 << 0,
    Easy: 1 << 1,
    TouchDevice: 1 << 2,
    Hidden: 1 << 3,
    HardRock: 1 << 4,
    SuddenDeath: 1 << 5,
    DoubleTime: 1 << 6,
    Relax: 1 << 7,
    HalfTime: 1 << 8,
    Nightcore: 1 << 9,
    Flashlight: 1 << 10,
    Autoplay: 1 << 11,
    SpunOut: 1 << 12,
    Autopilot: 1 << 13,
    Perfect: 1 << 14,
    FadeIn: 1 << 23,
    Mirror: 1 << 30
} as const;

export const SpeedChangingMods = Mods.DoubleTime | Mods.HalfTime | Mods.Nightcore;
export const DifficultyChangingMods = Mods.HardRock | Mods.Easy | SpeedChangingMods;

export const mods_from_string = (str: string): number => {
    let mask = 0;
    const lower = str.toLowerCase();
    const mod_map: Record<string, number> = {
        nf: Mods.NoFail,
        ez: Mods.Easy,
        td: Mods.TouchDevice,
        hd: Mods.Hidden,
        hr: Mods.HardRock,
        sd: Mods.SuddenDeath,
        dt: Mods.DoubleTime,
        rx: Mods.Relax,
        ht: Mods.HalfTime,
        nc: Mods.Nightcore,
        fl: Mods.Flashlight,
        at: Mods.Autoplay,
        so: Mods.SpunOut,
        ap: Mods.Autopilot,
        pf: Mods.Perfect,
        fi: Mods.FadeIn,
        mr: Mods.Mirror
    };

    for (let i = 0; i < lower.length - 1; i += 2) {
        const mod = lower.slice(i, i + 2);
        if (mod_map[mod]) {
            mask |= mod_map[mod];
        }
    }

    return mask;
};

export const mods_to_string = (mods: number): string => {
    const names: string[] = [];

    if (mods & Mods.NoFail) names.push("NF");
    if (mods & Mods.Easy) names.push("EZ");
    if (mods & Mods.Hidden) names.push("HD");
    if (mods & Mods.HardRock) names.push("HR");
    if (mods & Mods.SuddenDeath) names.push("SD");
    if (mods & Mods.DoubleTime) names.push("DT");
    if (mods & Mods.HalfTime) names.push("HT");
    if (mods & Mods.Nightcore) names.push("NC");
    if (mods & Mods.Flashlight) names.push("FL");
    if (mods & Mods.SpunOut) names.push("SO");
    if (mods & Mods.FadeIn) names.push("FI");
    if (mods & Mods.Mirror) names.push("MR");

    const idx_dt = names.indexOf("DT");
    const idx_nc = names.indexOf("NC");

    if (idx_dt >= 0 && idx_nc >= 0) {
        names.splice(idx_dt, 1);
    }

    return names.join("");
};

export const get_speed_multiplier = (mods: number): number => {
    if (mods & (Mods.DoubleTime | Mods.Nightcore)) return 1.5;
    if (mods & Mods.HalfTime) return 0.75;
    return 1.0;
};

const EXCLUSIVE_MOD_GROUPS = [Mods.HardRock | Mods.Easy, Mods.DoubleTime | Mods.HalfTime | Mods.Nightcore, Mods.Hidden | Mods.FadeIn];

export const toggle_mod = (current: number, mod: number): number => {
    // turn off
    if (current & mod) {
        return current & ~mod;
    }

    // turn on
    let result = current;

    for (const group of EXCLUSIVE_MOD_GROUPS) {
        if (mod & group) {
            result &= ~group;
        }
    }

    return result | mod;
};

export const has_mod = (mods: number, mod: number): boolean => (mods & mod) !== 0;

export type GameModeType = "standard" | "mania" | "taiko" | "catch";

export interface IModInfo {
    name: string;
    acronym: string;
    value: number;
}

export const get_available_mods = (mode: GameModeType): IModInfo[] => {
    const common: IModInfo[] = [
        { name: "No Fail", acronym: "NF", value: Mods.NoFail },
        { name: "Easy", acronym: "EZ", value: Mods.Easy },
        { name: "Hidden", acronym: "HD", value: Mods.Hidden },
        { name: "Double Time", acronym: "DT", value: Mods.DoubleTime },
        { name: "Half Time", acronym: "HT", value: Mods.HalfTime },
        { name: "Nightcore", acronym: "NC", value: Mods.Nightcore }
    ];

    switch (mode) {
        case "standard":
            return [
                ...common,
                { name: "Hard Rock", acronym: "HR", value: Mods.HardRock },
                { name: "Flashlight", acronym: "FL", value: Mods.Flashlight }
            ];

        case "mania":
            return [...common, { name: "Fade In", acronym: "FI", value: Mods.FadeIn }, { name: "Mirror", acronym: "MR", value: Mods.Mirror }];

        case "taiko":
        case "catch":
            return [...common, { name: "Hard Rock", acronym: "HR", value: Mods.HardRock }];

        default:
            return common;
    }
};
