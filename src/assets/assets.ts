const resolve_asset_url = (relative_path: string): string => {
    return new URL(relative_path, import.meta.url).toString();
};

const DEFAULT_SKIN_BASE_PATHS = ["./default-skin/", "./assets/default-skin/"];

export const get_default_skin_folder_base_urls = (): string[] => {
    const urls: string[] = [];
    for (let i = 0; i < DEFAULT_SKIN_BASE_PATHS.length; i++) {
        urls.push(resolve_asset_url(DEFAULT_SKIN_BASE_PATHS[i]));
    }
    return urls;
};

export const get_default_skin_folder_manifest_url = (): string => {
    return new URL("manifest.json", get_default_skin_folder_base_urls()[0]).toString();
};

export const resolve_default_skin_folder_asset_url = (relative_path: string, base_url?: string): string => {
    const base = base_url ?? get_default_skin_folder_base_urls()[0];
    return new URL(relative_path, base).toString();
};

export const resolve_runtime_asset_url = (relative_path: string): string => {
    return resolve_asset_url(relative_path);
};
