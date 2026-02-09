const has_font_api = (): boolean => typeof document !== "undefined" && "fonts" in document;

export const wait_for_fonts_ready = async (): Promise<void> => {
    if (!has_font_api()) return;
    try {
        await document.fonts.ready;
    } catch {}
};

export const load_default_fonts = async (base_url: string = "/assets/fonts"): Promise<void> => {
    if (!has_font_api()) return;

    const fonts: FontFace[] = [];

    try {
        fonts.push(new FontFace("Aller", `url(${base_url}/Aller-Regular.ttf)`, { weight: "400", style: "normal" }));
    } catch {}

    try {
        fonts.push(new FontFace("Aller", `url(${base_url}/Aller-Bold.ttf)`, { weight: "600", style: "normal" }));
    } catch {}

    try {
        fonts.push(new FontFace("Kozuka Gothic Pro R", `url(${base_url}/KozGoProRegular.otf)`, { weight: "400", style: "normal" }));
    } catch {}

    try {
        fonts.push(new FontFace("Kozuka Gothic Pro B", `url(${base_url}/KozGoProBold.otf)`, { weight: "600", style: "normal" }));
    } catch {}

    if (fonts.length === 0) return;

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

    await wait_for_fonts_ready();
};
