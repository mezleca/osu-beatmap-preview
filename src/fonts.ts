export const load_default_fonts = async (base_url?: string): Promise<void> => {
    // ensure we have fonts api
    if (typeof document === "undefined" || !("fonts" in document)) {
        return;
    }

    if (!base_url) {
        return;
    }

    const font_specs = [
        { family: "Kozuka Gothic Pro R", file: "KozGoProRegular.otf", weight: "400" },
        { family: "Kozuka Gothic Pro B", file: "KozGoProBold.otf", weight: "600" }
    ];

    const fonts: FontFace[] = [];

    for (const spec of font_specs) {
        try {
            fonts.push(new FontFace(spec.family, `url(${base_url}/${spec.file})`, { weight: spec.weight, style: "normal" }));
        } catch {
            console.error("[fonts] Failed to load:", spec.family);
        }
    }

    if (fonts.length === 0) {
        return;
    }

    const loaded = await Promise.all(
        fonts.map(async (font) => {
            try {
                return await font.load();
            } catch {
                return null;
            }
        })
    );

    for (const font of loaded) {
        if (font) document.fonts.add(font);
    }

    await document.fonts.ready;
};
