import type { IHitObject } from "../../types/beatmap";
import { Drawable, type DrawableConfig } from "./drawable";
import { CircleVisual } from "./circle_visual";
import { get_combo_color } from "../../skin/skin_config";

export class DrawableHitCircle extends Drawable {
    private visual = new CircleVisual();

    constructor(hit_object: IHitObject, config: DrawableConfig) {
        super(hit_object, config);
    }

    update(time: number): void {
        super.update(time);
        this.visual.update(time, this.hit_object.time, this.config);
    }

    render(time: number): void {
        const { backend, skin, config } = this;
        const { radius } = config;
        const pos = this.position;
        const combo_color = get_combo_color(skin, this.combo_number, 1);

        this.visual.render(backend, skin, pos, radius, combo_color, this.combo_count);
    }
}
