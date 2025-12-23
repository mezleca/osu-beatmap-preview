// game modes
export enum GameMode {
    Standard = 0,
    Taiko = 1,
    Catch = 2,
    Mania = 3
}

export interface IBeatmap {
    format_version: number;
    mode: GameMode;

    title: string;
    title_unicode: string;
    artist: string;
    artist_unicode: string;
    creator: string;
    version: string;

    ar: number;
    cs: number;
    od: number;
    hp: number;
    sv: number;
    tick_rate: number;

    timing_points: ITimingPoint[];
    objects: IHitObject[];

    circle_count: number;
    slider_count: number;
    spinner_count: number;
    hold_count: number;
}

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

export interface ITimingPoint {
    time: number;
    ms_per_beat: number;
    change: boolean;
    sample_set: SampleSet;
    sample_index: number;
    volume: number;
    kiai: boolean;
    velocity: number;
    beat_length: number;
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

export interface IHitSample {
    normal_set: SampleSet;
    addition_set: SampleSet;
    index: number;
    volume: number;
    filename?: string;
}

export interface IHitObject {
    time: number;
    type: number;

    hit_sound: number;
    hit_sample?: IHitSample;
    edge_sounds?: number[];
    edge_sets?: [SampleSet, SampleSet][];

    end_time: number;
    end_pos: [number, number];
    combo_number: number;
    combo_count: number;
    data: ICircleData | ISliderData | ISpinnerData | IHoldData;
}

export interface ICircleData {
    pos: [number, number];
}

export type SliderPathType = "L" | "B" | "P" | "C";

export interface ISliderData {
    pos: [number, number];
    path_type: SliderPathType;
    control_points: [number, number][];
    distance: number;
    repetitions: number;
    duration?: number;
    computed_path?: [number, number][];
}

export interface ISpinnerData {
    end_time: number;
}

export interface IHoldData {
    pos: [number, number];
    end_time: number;
}

export const is_circle = (obj: IHitObject): boolean => (obj.type & HitObjectType.Circle) !== 0;
export const is_slider = (obj: IHitObject): boolean => (obj.type & HitObjectType.Slider) !== 0;
export const is_spinner = (obj: IHitObject): boolean => (obj.type & HitObjectType.Spinner) !== 0;
export const is_hold = (obj: IHitObject): boolean => (obj.type & HitObjectType.Hold) !== 0;
export const is_new_combo = (obj: IHitObject): boolean => (obj.type & HitObjectType.NewCombo) !== 0;
