import { fontSpec } from "./types/fonts";

const build_font = (spec: fontSpec): FontFace | null => {
    try {
        return new FontFace(spec.family, spec.url, { weight: spec.weight, style: "normal" });
    } catch (err) {
        console.error(err);
        return null;
    }
};

export const load_font = async (spec: fontSpec): Promise<boolean> => {
    const result = build_font(spec);

    if (!result) {
        return false;
    }

    try {
        await result.load();
        document.fonts.add(result);
    } catch (err) {
        console.error(err);
        return false;
    }

    return true;
};
