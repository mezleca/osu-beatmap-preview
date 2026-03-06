import type { ISkinConfig } from "./skin_config";

export interface SkinIniData {
    general: {
        name?: string;
        author?: string;
        version?: string;
        hit_circle_overlay_above_number?: boolean;
        slider_ball_flip?: boolean;
        allow_slider_ball_tint?: boolean;
        slider_ball_frames?: number;
        animation_framerate?: number;
    };
    fonts: {
        hit_circle_prefix?: string;
        hit_circle_overlap?: number;
    };
    colours: {
        combo_colors: string[];
        slider_border?: string;
        slider_track_override?: string;
        slider_ball?: string;
        spinner_background?: string;
    };
}

const DEFAULT_COMBO_COLORS = ["rgb(255, 192, 0)", "rgb(0, 202, 0)", "rgb(18, 124, 255)", "rgb(242, 24, 57)"];
const parse_skin_bool = (value: string): boolean | undefined => {
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true" || normalized === "yes") {
        return true;
    }
    if (normalized === "0" || normalized === "false" || normalized === "no") {
        return false;
    }
    return undefined;
};

export const parse_skin_ini = (content: string): SkinIniData => {
    const result: SkinIniData = {
        general: {},
        fonts: {},
        colours: {
            combo_colors: []
        }
    };

    let current_section = "";
    const lines = content.split(/\r?\n/);

    for (const raw_line of lines) {
        const line = raw_line.trim();
        if (line.length === 0 || line.startsWith("//")) continue;

        // section header
        if (line.startsWith("[") && line.endsWith("]")) {
            current_section = line.slice(1, -1).toLowerCase();
            continue;
        }

        // key: value
        const colon_idx = line.indexOf(":");
        if (colon_idx === -1) continue;

        const key = line.slice(0, colon_idx).trim().toLowerCase();
        const value = line.slice(colon_idx + 1).trim();

        switch (current_section) {
            case "general":
                parse_general(result.general, key, value);
                break;
            case "colours":
                parse_colours(result.colours, key, value);
                break;
            case "fonts":
                parse_fonts(result.fonts, key, value);
                break;
        }
    }

    // set defaults if no combo colors defined
    if (result.colours.combo_colors.length === 0) {
        result.colours.combo_colors = [...DEFAULT_COMBO_COLORS];
    }

    return result;
};

const parse_fonts = (fonts: SkinIniData["fonts"], key: string, value: string): void => {
    switch (key) {
        case "hitcircleprefix":
            if (value.length > 0) {
                fonts.hit_circle_prefix = value.trim();
            }
            break;
        case "hitcircleoverlap": {
            const overlap = Number.parseInt(value, 10);
            if (Number.isFinite(overlap)) {
                fonts.hit_circle_overlap = overlap;
            }
            break;
        }
    }
};

const parse_general = (general: SkinIniData["general"], key: string, value: string): void => {
    switch (key) {
        case "name":
            general.name = value;
            break;
        case "author":
            general.author = value;
            break;
        case "version":
            general.version = value;
            break;
        case "hitcircleoverlayabovenumber":
        case "hitcircleoverlayabovenumer":
            general.hit_circle_overlay_above_number = parse_skin_bool(value);
            break;
        case "sliderballflip":
            general.slider_ball_flip = parse_skin_bool(value);
            break;
        case "allowslidertainttint":
        case "allowsliderballtint":
            general.allow_slider_ball_tint = parse_skin_bool(value);
            break;
        case "sliderballframes": {
            const frames = Number.parseInt(value, 10);
            if (Number.isFinite(frames) && frames > 0) {
                general.slider_ball_frames = frames;
            }
            break;
        }
        case "animationframerate": {
            const framerate = Number.parseInt(value, 10);
            if (Number.isFinite(framerate)) {
                general.animation_framerate = framerate;
            }
            break;
        }
    }
};

const parse_colours = (colours: SkinIniData["colours"], key: string, value: string): void => {
    const rgb = parse_rgb(value);
    if (!rgb) return;

    // combo colors (Combo1-8)
    const combo_match = key.match(/^combo(\d+)$/);

    if (combo_match) {
        const idx = parseInt(combo_match[1]) - 1;
        while (colours.combo_colors.length <= idx) {
            colours.combo_colors.push("");
        }
        colours.combo_colors[idx] = rgb;
        return;
    }

    switch (key) {
        case "sliderborder":
            colours.slider_border = rgb;
            break;
        case "slidertrackoverride":
            colours.slider_track_override = rgb;
            break;
        case "sliderball":
            colours.slider_ball = rgb;
            break;
        case "spinnerbackground":
            colours.spinner_background = rgb;
            break;
    }
};

const parse_rgb = (value: string): string | null => {
    const parts = value.split(",").map((s) => parseInt(s.trim()));
    if (parts.length < 3 || parts.some(isNaN)) return null;

    const [r, g, b] = parts;
    if (parts.length >= 4) {
        const a = parts[3] / 255;
        return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
    }
    return `rgb(${r}, ${g}, ${b})`;
};

export const apply_skin_ini = (config: ISkinConfig, ini: SkinIniData): ISkinConfig => {
    const result = { ...config };

    // combo colors
    if (ini.colours.combo_colors.length > 0) {
        result.combo_colors = ini.colours.combo_colors.filter((c) => c.length > 0);
    }

    // slider colors
    if (ini.colours.slider_border) {
        result.slider_border_color = ini.colours.slider_border;
    }
    if (ini.colours.slider_track_override) {
        result.slider_track_override = ini.colours.slider_track_override;
    }
    if (ini.colours.slider_ball) {
        result.slider_ball_color = ini.colours.slider_ball;
    }
    if (ini.colours.spinner_background) {
        result.spinner_background_color = ini.colours.spinner_background;
    }

    if (ini.general.hit_circle_overlay_above_number !== undefined) {
        result.hit_circle_overlay_above_number = ini.general.hit_circle_overlay_above_number;
    }
    if (ini.general.slider_ball_flip !== undefined) {
        result.slider_ball_flip = ini.general.slider_ball_flip;
    }
    if (ini.general.allow_slider_ball_tint !== undefined) {
        result.allow_slider_ball_tint = ini.general.allow_slider_ball_tint;
    }
    if (ini.general.slider_ball_frames !== undefined) {
        result.slider_ball_frames = ini.general.slider_ball_frames;
    }
    if (ini.general.animation_framerate !== undefined) {
        result.animation_framerate = ini.general.animation_framerate;
    }
    if (ini.fonts.hit_circle_prefix !== undefined) {
        result.hit_circle_prefix = ini.fonts.hit_circle_prefix;
    }
    if (ini.fonts.hit_circle_overlap !== undefined) {
        result.hit_circle_overlap = ini.fonts.hit_circle_overlap;
    }

    return result;
};
