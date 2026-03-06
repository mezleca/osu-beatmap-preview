const resolve_asset_url = (relative_path: string): string => {
    return new URL(relative_path, import.meta.url).toString();
};

export const get_default_skin_folder_manifest_url = (): string => {
    return resolve_asset_url("./default-skin/manifest.json");
};

export const resolve_default_skin_folder_asset_url = (relative_path: string): string => {
    return resolve_asset_url(`./default-skin/${relative_path}`);
};

export const resolve_runtime_asset_url = (relative_path: string): string => {
    return resolve_asset_url(relative_path);
};
