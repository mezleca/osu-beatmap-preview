import type { IRenderBackend } from "./render_backend";
import { PixiBackend } from "./pixi_backend";

export type BackendType = "auto" | "pixi";

export const create_backend = (_: BackendType): IRenderBackend => {
    return new PixiBackend();
};
