export interface ISkinConfig {
    combo_colors: string[];

    // circle rendering
    circle_border_width: number;
    hit_circle_opacity: number;
    approach_circle_width: number;

    // slider rendering
    slider_body_opacity: number;
    slider_border_opacity: number;
    slider_tick_opacity: number;
    slider_tick_size: number;

    // follow point/circle
    follow_circle_factor: number;
    follow_circle_width: number;
    follow_circle_opacity: number;
    follow_point_width: number;

    // spinner
    spinner_size: number;
    spinner_center_size: number;

    // mania
    mania_lane_width: number;
    mania_note_height: number;
    mania_hit_position: number;
    mania_lane_spacing: number;
    mania_lane_colors: Record<number, string[]>;

    // general
    font_family: string;
    hit_animation_duration: number;
    hit_animation_scale: number;
}

const MANIA_KEY_COLORS: Record<number, string[]> = {
    1: ["#d5bc00"],
    2: ["#ffffff", "#ffffff"],
    3: ["#ffffff", "#d5bc00", "#ffffff"],
    4: ["#ffffff", "#dc8dba", "#dc8dba", "#ffffff"],
    5: ["#ffffff", "#dc8dba", "#d5bc00", "#dc8dba", "#ffffff"],
    6: ["#ffffff", "#dc8dba", "#ffffff", "#ffffff", "#dc8dba", "#ffffff"],
    7: ["#ffffff", "#dc8dba", "#ffffff", "#d5bc00", "#ffffff", "#dc8dba", "#ffffff"],
    8: ["#d5bc00", "#ffffff", "#dc8dba", "#ffffff", "#d5bc00", "#ffffff", "#dc8dba", "#ffffff"],
    9: ["#ffffff", "#dc8dba", "#ffffff", "#dc8dba", "#d5bc00", "#dc8dba", "#ffffff", "#dc8dba", "#ffffff"],
    10: ["#ffffff", "#dc8dba", "#d5bc00", "#dc8dba", "#ffffff", "#ffffff", "#dc8dba", "#d5bc00", "#dc8dba", "#ffffff"]
};

export const DEFAULT_SKIN: ISkinConfig = {
    combo_colors: ["0,185,0", "7, 105, 227", "224, 4, 38", "227, 171, 2"],

    circle_border_width: 0.13,
    hit_circle_opacity: 1.0,
    approach_circle_width: 0.1,

    slider_body_opacity: 0.85,
    slider_border_opacity: 1.0,
    slider_tick_opacity: 0.75,
    slider_tick_size: 0.1,

    follow_circle_factor: 2,
    follow_circle_width: 3,
    follow_circle_opacity: 0.7,
    follow_point_width: 2,

    spinner_size: 180,
    spinner_center_size: 10,

    mania_lane_width: 30,
    mania_note_height: 15,
    mania_hit_position: 364,
    mania_lane_spacing: 1,
    mania_lane_colors: MANIA_KEY_COLORS,

    font_family: '"Exo 2", sans-serif',
    hit_animation_duration: 300,
    hit_animation_scale: 1.3
};

export const merge_skin = (partial?: Partial<ISkinConfig>): ISkinConfig => {
    if (!partial) return { ...DEFAULT_SKIN };

    return {
        ...DEFAULT_SKIN,
        ...partial,
        mania_lane_colors: partial.mania_lane_colors ? { ...MANIA_KEY_COLORS, ...partial.mania_lane_colors } : MANIA_KEY_COLORS
    };
};

export const get_combo_color = (skin: ISkinConfig, combo_number: number, alpha: number = 1): string => {
    const color = skin.combo_colors[combo_number % skin.combo_colors.length];
    return `rgba(${color},${alpha})`;
};

export const get_mania_lane_color = (skin: ISkinConfig, key_count: number, lane: number): string => {
    const colors = skin.mania_lane_colors[key_count] ?? skin.mania_lane_colors[4];
    return colors[lane % colors.length] ?? "#ffffff";
};
