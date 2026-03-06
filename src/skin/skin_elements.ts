import type { RenderImage } from "../renderer/backend/render_backend";
import type { ISkinConfig } from "./skin_config";
import { apply_skin_ini, parse_skin_ini } from "./skin_ini_parser";

export type StandardSkinElements = {
    hitcircle?: RenderImage;
    hitcircleoverlay?: RenderImage;
    sliderstartcircle?: RenderImage;
    sliderstartcircleoverlay?: RenderImage;
    sliderendcircle?: RenderImage;
    sliderendcircleoverlay?: RenderImage;
    approachcircle?: RenderImage;
    sliderball?: RenderImage;
    sliderball_frames?: RenderImage[];
    sliderball_nd?: RenderImage;
    sliderball_spec?: RenderImage;
    sliderfollowcircle?: RenderImage;
    reversearrow?: RenderImage;
    reversearrow_frames?: RenderImage[];
    sliderb?: RenderImage;
    sliderscorepoint?: RenderImage;
    combo_digits?: RenderImage[];
    combo_overlap?: number;
    followpoint?: RenderImage;
    followpoint_frames?: RenderImage[];
    mania_textures?: Record<string, RenderImage>;
    mania_animations?: Record<string, RenderImage[]>;
};

export type LoadedBeatmapSkin = {
    config: ISkinConfig;
    elements: StandardSkinElements;
    dispose: () => void;
};

type LoadedImage = {
    image: RenderImage;
    url: string;
};

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

const find_file_case_insensitive = (files: Map<string, ArrayBuffer>, filename: string): { name: string; data: ArrayBuffer } | null => {
    if (files.has(filename)) {
        return { name: filename, data: files.get(filename) as ArrayBuffer };
    }

    const lower = filename.toLowerCase();
    for (const [name, data] of files) {
        if (name.toLowerCase() === lower) {
            return { name, data };
        }
    }

    // fallback for archives containing subfolders:
    // allow matching by basename (e.g. "Skin/hitcircle.png")
    for (const [name, data] of files) {
        const basename = name.split("/").pop();
        if (basename && basename.toLowerCase() === lower) {
            return { name, data };
        }
    }

    return null;
};

const resolve_file_entry = (files: Map<string, ArrayBuffer>, base_names: string[]): { filename: string; data: ArrayBuffer } | null => {
    for (let i = 0; i < base_names.length; i++) {
        const base = base_names[i];
        for (let j = 0; j < IMAGE_EXTENSIONS.length; j++) {
            const filename = `${base}${IMAGE_EXTENSIONS[j]}`;
            const data = find_file_case_insensitive(files, filename);
            if (data) {
                return { filename: data.name, data: data.data };
            }
        }
    }

    return null;
};

const create_render_image = async (entry: { filename: string; data: ArrayBuffer }): Promise<LoadedImage | null> => {
    const blob = new Blob([entry.data]);
    const url = URL.createObjectURL(blob);
    try {
        const image = new Image();
        image.src = url;
        await image.decode();

        const scale_factor = entry.filename.toLowerCase().includes("@2x") ? 2 : 1;
        return {
            image: {
                source: image,
                width: image.naturalWidth / scale_factor,
                height: image.naturalHeight / scale_factor
            },
            url
        };
    } catch (error) {
        URL.revokeObjectURL(url);
        console.warn(`[Skin] Failed to decode ${entry.filename}`, error);
        return null;
    }
};

const clamp_image_max_size = (image: RenderImage, max_logical_size: number): RenderImage => {
    if (image.width <= max_logical_size && image.height <= max_logical_size) {
        return image;
    }

    const source = image.source as { width?: number; height?: number };
    const source_width = Number(source?.width ?? 0);
    const source_height = Number(source?.height ?? 0);
    if (source_width <= 0 || source_height <= 0 || image.width <= 0 || image.height <= 0) {
        return image;
    }

    const scale_x = source_width / image.width;
    const scale_y = source_height / image.height;

    const target_logical_width = Math.min(image.width, max_logical_size);
    const target_logical_height = Math.min(image.height, max_logical_size);

    const crop_source_width = Math.max(1, Math.round(target_logical_width * scale_x));
    const crop_source_height = Math.max(1, Math.round(target_logical_height * scale_y));
    const crop_source_x = Math.max(0, Math.floor((source_width - crop_source_width) / 2));
    const crop_source_y = Math.max(0, Math.floor((source_height - crop_source_height) / 2));

    const canvas = document.createElement("canvas");
    canvas.width = crop_source_width;
    canvas.height = crop_source_height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        return image;
    }

    ctx.drawImage(image.source, crop_source_x, crop_source_y, crop_source_width, crop_source_height, 0, 0, crop_source_width, crop_source_height);

    return {
        source: canvas,
        width: target_logical_width,
        height: target_logical_height
    };
};

const require_min_size = (image: RenderImage, min_logical_size: number): RenderImage | null => {
    if (image.width < min_logical_size || image.height < min_logical_size) {
        return null;
    }
    return image;
};

const load_optional_image = async (files: Map<string, ArrayBuffer>, base_names: string[]): Promise<LoadedImage | null> => {
    const entry = resolve_file_entry(files, base_names);
    if (!entry) {
        return null;
    }

    return create_render_image(entry);
};

const load_sliderball_frames = async (files: Map<string, ArrayBuffer>, max_frames: number): Promise<LoadedImage[]> => {
    const frames: LoadedImage[] = [];
    const limit = Math.max(1, Math.min(120, max_frames));

    for (let i = 0; i < limit; i++) {
        const frame = await load_optional_image(files, [`sliderb${i}@2x`, `sliderb${i}`]);
        if (!frame) {
            if (i === 0) {
                continue;
            }
            break;
        }

        frames.push(frame);
    }

    return frames;
};

const load_number_frames = async (files: Map<string, ArrayBuffer>, prefix: string): Promise<LoadedImage[]> => {
    const frames: LoadedImage[] = [];
    for (let i = 0; i < 10; i++) {
        const frame = await load_optional_image(files, [`${prefix}-${i}@2x`, `${prefix}-${i}`]);
        if (!frame) {
            return [];
        }
        frames.push(frame);
    }
    return frames;
};

const load_optional_sequence = async (files: Map<string, ArrayBuffer>, names: string[]): Promise<LoadedImage[]> => {
    for (let i = 0; i < names.length; i++) {
        const base = names[i];
        const frames: LoadedImage[] = [];
        for (let index = 0; index < 64; index++) {
            const frame = await load_optional_image(files, [`${base}${index}@2x`, `${base}${index}`, `${base}-${index}@2x`, `${base}-${index}`]);
            if (!frame) {
                break;
            }
            frames.push(frame);
        }
        if (frames.length > 0) {
            return frames;
        }
    }
    return [];
};

const load_optional_hyphen_sequence = async (files: Map<string, ArrayBuffer>, base: string): Promise<LoadedImage[]> => {
    const frames: LoadedImage[] = [];
    for (let index = 0; index < 128; index++) {
        const frame = await load_optional_image(files, [`${base}-${index}@2x`, `${base}-${index}`]);
        if (!frame) {
            break;
        }
        frames.push(frame);
    }
    return frames;
};

const load_skin_ini = (files: Map<string, ArrayBuffer>): string | null => {
    const data = find_file_case_insensitive(files, "skin.ini");
    if (!data) {
        return null;
    }

    try {
        return new TextDecoder("utf-8").decode(data.data);
    } catch (error) {
        console.warn("[Skin] Failed to parse skin.ini", error);
        return null;
    }
};

export const load_beatmap_skin = async (base_config: ISkinConfig, files: Map<string, ArrayBuffer>): Promise<LoadedBeatmapSkin> => {
    const urls: string[] = [];
    let config = base_config;

    const skin_ini_content = load_skin_ini(files);
    if (skin_ini_content) {
        config = apply_skin_ini(config, parse_skin_ini(skin_ini_content));
    }

    const elements: StandardSkinElements = {};

    const hitcircle = await load_optional_image(files, ["hitcircle@2x", "hitcircle"]);
    if (hitcircle) {
        const validated = require_min_size(clamp_image_max_size(hitcircle.image, 512), 32);
        if (validated) {
            elements.hitcircle = validated;
            urls.push(hitcircle.url);
        }
    }

    const hitcircleoverlay = await load_optional_image(files, ["hitcircleoverlay@2x", "hitcircleoverlay"]);
    if (hitcircleoverlay) {
        const validated = require_min_size(clamp_image_max_size(hitcircleoverlay.image, 512), 32);
        if (validated) {
            elements.hitcircleoverlay = validated;
            urls.push(hitcircleoverlay.url);
        }
    }

    const sliderstartcircle = await load_optional_image(files, ["sliderstartcircle@2x", "sliderstartcircle"]);
    if (sliderstartcircle) {
        const validated = require_min_size(clamp_image_max_size(sliderstartcircle.image, 512), 32);
        if (validated) {
            elements.sliderstartcircle = validated;
            urls.push(sliderstartcircle.url);
        }
    }

    const sliderstartcircleoverlay = await load_optional_image(files, ["sliderstartcircleoverlay@2x", "sliderstartcircleoverlay"]);
    if (sliderstartcircleoverlay) {
        const validated = require_min_size(clamp_image_max_size(sliderstartcircleoverlay.image, 512), 32);
        if (validated) {
            elements.sliderstartcircleoverlay = validated;
            urls.push(sliderstartcircleoverlay.url);
        }
    }

    const sliderendcircle = await load_optional_image(files, ["sliderendcircle@2x", "sliderendcircle"]);
    if (sliderendcircle) {
        const validated = require_min_size(clamp_image_max_size(sliderendcircle.image, 512), 32);
        if (validated) {
            elements.sliderendcircle = validated;
            urls.push(sliderendcircle.url);
        }
    }

    const sliderendcircleoverlay = await load_optional_image(files, ["sliderendcircleoverlay@2x", "sliderendcircleoverlay"]);
    if (sliderendcircleoverlay) {
        const validated = require_min_size(clamp_image_max_size(sliderendcircleoverlay.image, 512), 32);
        if (validated) {
            elements.sliderendcircleoverlay = validated;
            urls.push(sliderendcircleoverlay.url);
        }
    }

    const approachcircle = await load_optional_image(files, ["approachcircle@2x", "approachcircle"]);
    if (approachcircle) {
        elements.approachcircle = approachcircle.image;
        urls.push(approachcircle.url);
    }

    const sliderball_frames = await load_sliderball_frames(files, config.slider_ball_frames);
    if (sliderball_frames.length > 0) {
        const frames: RenderImage[] = [];
        for (let i = 0; i < sliderball_frames.length; i++) {
            frames.push(sliderball_frames[i].image);
            urls.push(sliderball_frames[i].url);
        }
        elements.sliderball_frames = frames;
        elements.sliderball = frames[0];
    } else {
        const sliderball = await load_optional_image(files, ["sliderb@2x", "sliderb", "sliderball@2x", "sliderball"]);
        if (sliderball) {
            elements.sliderball = sliderball.image;
            urls.push(sliderball.url);
        }
    }

    const sliderball_nd = await load_optional_image(files, ["sliderb-nd@2x", "sliderb-nd"]);
    if (sliderball_nd) {
        elements.sliderball_nd = sliderball_nd.image;
        urls.push(sliderball_nd.url);
    }

    const sliderball_spec = await load_optional_image(files, ["sliderb-spec@2x", "sliderb-spec"]);
    if (sliderball_spec) {
        elements.sliderball_spec = sliderball_spec.image;
        urls.push(sliderball_spec.url);
    }

    const sliderfollowcircle = await load_optional_image(files, ["sliderfollowcircle@2x", "sliderfollowcircle"]);
    if (sliderfollowcircle) {
        elements.sliderfollowcircle = sliderfollowcircle.image;
        urls.push(sliderfollowcircle.url);
    }

    const reversearrow = await load_optional_image(files, ["reversearrow@2x", "reversearrow"]);
    if (reversearrow) {
        elements.reversearrow = reversearrow.image;
        urls.push(reversearrow.url);
    }
    const reversearrow_frames = await load_optional_sequence(files, ["reversearrow"]);
    if (reversearrow_frames.length > 0) {
        const frames: RenderImage[] = [];
        for (let i = 0; i < reversearrow_frames.length; i++) {
            frames.push(reversearrow_frames[i].image);
            urls.push(reversearrow_frames[i].url);
        }
        elements.reversearrow_frames = frames;
        if (!elements.reversearrow) {
            elements.reversearrow = frames[0];
        }
    }

    const sliderb = await load_optional_image(files, ["sliderb0@2x", "sliderb0", "sliderb@2x", "sliderb"]);
    if (sliderb) {
        elements.sliderb = sliderb.image;
        urls.push(sliderb.url);
    }

    const sliderscorepoint = await load_optional_image(files, ["sliderscorepoint@2x", "sliderscorepoint", "sliderpoint10@2x", "sliderpoint10"]);
    if (sliderscorepoint) {
        elements.sliderscorepoint = sliderscorepoint.image;
        urls.push(sliderscorepoint.url);
    }

    const followpoint = await load_optional_image(files, ["followpoint@2x", "followpoint"]);
    if (followpoint) {
        elements.followpoint = followpoint.image;
        urls.push(followpoint.url);
    }
    const followpoint_frames = await load_optional_hyphen_sequence(files, "followpoint");
    if (followpoint_frames.length > 0) {
        const frames: RenderImage[] = [];
        for (let i = 0; i < followpoint_frames.length; i++) {
            frames.push(followpoint_frames[i].image);
            urls.push(followpoint_frames[i].url);
        }
        elements.followpoint_frames = frames;
        if (!elements.followpoint) {
            elements.followpoint = frames[0];
        }
    }

    const combo_digits = await load_number_frames(files, config.hit_circle_prefix || "default");
    if (combo_digits.length > 0) {
        const digits: RenderImage[] = [];
        for (let i = 0; i < combo_digits.length; i++) {
            digits.push(combo_digits[i].image);
            urls.push(combo_digits[i].url);
        }
        elements.combo_digits = digits;
        elements.combo_overlap = config.hit_circle_overlap;
    }

    const mania_names = [
        "mania-stage-left",
        "mania-stage-right",
        "mania-stage-bottom",
        "mania-stage-light",
        "mania-stage-hint",
        "mania-key1",
        "mania-key1d",
        "mania-key2",
        "mania-key2d",
        "mania-keys",
        "mania-keysd",
        "mania-note1",
        "mania-note2",
        "mania-notes",
        "mania-note1h",
        "mania-note2h",
        "mania-notesh",
        "mania-note1l",
        "mania-note2l",
        "mania-notesl",
        "mania-note1t",
        "mania-note2t",
        "mania-notest"
    ];

    const mania_textures: Record<string, RenderImage> = {};
    const mania_animations: Record<string, RenderImage[]> = {};

    for (let i = 0; i < mania_names.length; i++) {
        const name = mania_names[i];
        const key = name.toLowerCase();
        const image = await load_optional_image(files, [`${name}@2x`, name]);
        if (image) {
            mania_textures[key] = image.image;
            urls.push(image.url);
        }

        const frames = await load_optional_sequence(files, [name]);
        if (frames.length > 0) {
            const animation_frames: RenderImage[] = [];
            for (let j = 0; j < frames.length; j++) {
                animation_frames.push(frames[j].image);
                urls.push(frames[j].url);
            }
            mania_animations[key] = animation_frames;
            if (!mania_textures[key]) {
                mania_textures[key] = animation_frames[0];
            }
        }
    }

    if (Object.keys(mania_textures).length > 0) {
        elements.mania_textures = mania_textures;
    }
    if (Object.keys(mania_animations).length > 0) {
        elements.mania_animations = mania_animations;
    }

    return {
        config,
        elements,
        dispose: () => {
            for (let i = 0; i < urls.length; i++) {
                URL.revokeObjectURL(urls[i]);
            }
        }
    };
};
