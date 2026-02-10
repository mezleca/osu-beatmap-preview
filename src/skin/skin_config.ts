export interface ISkinConfig {
    combo_colors: string[];

    // circle rendering
    circle_border_width: number;
    hit_circle_opacity: number;

    // approach circle
    enable_approach_circle: boolean;
    approach_circle_width: number;
    approach_circle_opacity: number;
    approach_circle_use_combo_color: boolean;
    approach_circle_color?: string;

    // hitburst effect
    enable_hitburst: boolean;
    hitburst_duration: number;
    hitburst_scale: number;
    hitburst_glow_enabled: boolean;
    hitburst_glow_color?: string;
    hitburst_glow_use_combo_color: boolean;
    hitburst_glow_opacity: number;

    // slider rendering
    slider_body_opacity: number;
    slider_border_opacity: number;
    slider_tick_opacity: number;
    slider_tick_size: number;
    slider_border_color?: string;
    slider_track_override?: string;
    slider_render_scale: number;

    // follow circle (slider ball outer ring)
    follow_circle_factor: number;
    follow_circle_width: number;
    follow_circle_opacity: number;
    follow_circle_color: string;
    follow_circle_use_combo_color: boolean;

    // slider ball (inner circle)
    slider_ball_color: string;
    slider_ball_opacity: number;
    enable_slider_ball: boolean;

    // follow points (dots between objects)
    follow_point_width: number;
    follow_point_shape: "circle" | "line";
    follow_point_mode: "segments" | "full";
    follow_point_length: number;
    follow_point_line_gap: number;

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

    // animation toggles
    enable_hit_animations: boolean;
    enable_follow_circle_animations: boolean;
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

    circle_border_width: 0.12,
    hit_circle_opacity: 0.95,

    enable_approach_circle: true,
    approach_circle_width: 0.1,
    approach_circle_opacity: 0.5,
    approach_circle_use_combo_color: true,

    enable_hitburst: true,
    hitburst_duration: 180,
    hitburst_scale: 1.2,
    hitburst_glow_enabled: false,
    hitburst_glow_use_combo_color: true,
    hitburst_glow_opacity: 0.3,

    slider_body_opacity: 0.9,
    slider_border_opacity: 1.0,
    slider_tick_opacity: 0.75,
    slider_tick_size: 0.1,
    slider_render_scale: 2.0,

    follow_circle_factor: 1.5,
    follow_circle_width: 4,
    follow_circle_opacity: 0.5,
    follow_circle_color: "#d3d3d3ff",
    follow_circle_use_combo_color: false,

    slider_ball_color: "#ffffff",
    slider_ball_opacity: 1.0,
    enable_slider_ball: true,

    follow_point_width: 2,
    follow_point_shape: "line",
    follow_point_mode: "full",
    follow_point_length: 12,
    follow_point_line_gap: 0,

    spinner_size: 180,
    spinner_center_size: 10,

    mania_lane_width: 30,
    mania_note_height: 15,
    mania_hit_position: 364,
    mania_lane_spacing: 1,
    mania_lane_colors: MANIA_KEY_COLORS,

    font_family: '"Kozuka Gothic Pro B", sans-serif',
    hit_animation_duration: 240,
    hit_animation_scale: 1.2,

    enable_hit_animations: true,
    enable_follow_circle_animations: true
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
