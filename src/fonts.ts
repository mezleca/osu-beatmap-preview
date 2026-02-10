const has_font_api = (): boolean => typeof document !== "undefined" && "fonts" in document;

export const wait_for_fonts_ready = async (): Promise<void> => {
    if (!has_font_api()) return;
    try {
        await document.fonts.ready;
    } catch {}
};

export const load_default_fonts = async (base_url: string = "/assets/fonts"): Promise<void> => {
    if (!has_font_api()) return;

    const create_font = (family: string, url: string, weight: string): FontFace | null => {
        try {
            return new FontFace(family, `url(${url})`, { weight, style: "normal" });
        } catch {
            return null;
        }
    };

    const fonts = [
        create_font("Aller", `${base_url}/Aller-Regular.ttf`, "400"),
        create_font("Aller", `${base_url}/Aller-Bold.ttf`, "600"),
        create_font("Kozuka Gothic Pro R", `${base_url}/KozGoProRegular.otf`, "400"),
        create_font("Kozuka Gothic Pro B", `${base_url}/KozGoProBold.otf`, "600")
    ].filter((font): font is FontFace => font !== null);

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
