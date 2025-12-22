export interface IBeatmapDifficulty {
    cs: number;
    ar: number;
    od: number;
    hp: number;
}

export interface IApplicableToDifficulty {
    apply_to_difficulty(difficulty: IBeatmapDifficulty): void;
}

export interface IApplicableToRate {
    get_rate_multiplier(): number;
}

export interface IMod {
    readonly name: string;
    readonly acronym: string;
}
