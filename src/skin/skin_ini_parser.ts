import type { ISkinConfig } from "./skin_config";

export interface SkinIniData {
    general: {
        name?: string;
        author?: string;
        version?: string;
        hit_circle_overlay_above_number?: boolean;
        slider_ball_flip?: boolean;
        allow_slider_ball_tint?: boolean;
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

export const parse_skin_ini = (content: string): SkinIniData => {
    const result: SkinIniData = {
        general: {},
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
        }
    }

    // set defaults if no combo colors defined
    if (result.colours.combo_colors.length === 0) {
        result.colours.combo_colors = [...DEFAULT_COMBO_COLORS];
    }

    return result;
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
            general.hit_circle_overlay_above_number = value === "1";
            break;
        case "sliderballflip":
            general.slider_ball_flip = value === "1";
            break;
        case "allowslidertainttint":
        case "allowsliderballtint":
            general.allow_slider_ball_tint = value === "1";
            break;
    }
};

const parse_colours = (colours: SkinIniData["colours"], key: string, value: string): void => {
    const rgb = parse_rgb(value);
    if (!rgb) return;

    // combo colors (Combo1-8)
    const combo_match = key.match(/^combo(\d)$/);
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

    return result;
};
