import type { RenderHitObject } from "../render_types";
import { Drawable, type DrawableConfig } from "./drawable";
import { CircleVisual } from "./circle_visual";
import { HitBurstEffect } from "./hit_burst";
import { get_combo_color } from "../../skin/skin_config";

export class DrawableHitCircle extends Drawable {
    private visual = new CircleVisual();
    private hitburst = new HitBurstEffect();

    constructor(hit_object: RenderHitObject, config: DrawableConfig) {
        super(hit_object, config);
    }

    update(time: number): void {
        super.update(time);
        this.visual.update(time, this.hit_object.time, this.config);
        this.hitburst.update(time, this.hit_object.time, this.config);
    }

    render(time: number): void {
        const { backend, skin, config } = this;
        const { radius } = config;
        const pos = this.position;
        const combo_color = get_combo_color(skin, this.combo_number, 1);

        this.visual.render(backend, skin, pos, radius, combo_color, this.combo_count);
        this.hitburst.render(backend, skin, pos, radius, combo_color);
    }
}
