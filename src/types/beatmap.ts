import type { OsuFileFormat, HitObject, TimingPoint, HitSample, CurvePoint } from "@rel-packages/osu-beatmap-parser/dist/types/types";

// game modes
export enum GameMode {
    Standard = 0,
    Taiko = 1,
    Catch = 2,
    Mania = 3
}

export type IBeatmap = OsuFileFormat;
export type IHitObject = HitObject;
export type ITimingPoint = TimingPoint;
export type IHitSample = HitSample;
export type ICurvePoint = CurvePoint;

export interface IBeatmapInfo {
    filename: string;
    title: string;
    artist: string;
    version: string;
    mode: GameMode;
    ar: number;
    cs: number;
    od: number;
    hp: number;
}

export enum SampleSet {
    Auto = 0,
    Normal = 1,
    Soft = 2,
    Drum = 3
}

export const HitObjectType = {
    Circle: 1 << 0,
    Slider: 1 << 1,
    NewCombo: 1 << 2,
    Spinner: 1 << 3,
    ComboSkip: (1 << 4) | (1 << 5) | (1 << 6),
    Hold: 1 << 7
} as const;

export const HitSoundType = {
    Normal: 1 << 0,
    Whistle: 1 << 1,
    Finish: 1 << 2,
    Clap: 1 << 3
} as const;

export const is_circle = (obj: IHitObject): boolean => (obj.type & HitObjectType.Circle) !== 0;
export const is_slider = (obj: IHitObject): boolean => (obj.type & HitObjectType.Slider) !== 0;
export const is_spinner = (obj: IHitObject): boolean => (obj.type & HitObjectType.Spinner) !== 0;
export const is_hold = (obj: IHitObject): boolean => (obj.type & HitObjectType.Hold) !== 0;
export const is_new_combo = (obj: IHitObject): boolean => (obj.type & HitObjectType.NewCombo) !== 0;
