import type { IRenderBackend } from "../backend/render_backend";
import type { RenderHitObject } from "../render_types";
import type { ISkinConfig } from "../../skin/skin_config";
import { TransformSequence, Easing } from "./transforms";

export enum ArmedState {
    Idle,
    Hit,
    Miss
}

export interface DrawableConfig {
    backend: IRenderBackend;
    skin: ISkinConfig;
    preempt: number;
    fade_in: number;
    radius: number;
    scale?: number;
    mods: number;
}

export abstract class Drawable {
    protected backend: IRenderBackend;
    protected skin: ISkinConfig;

    protected hit_object: RenderHitObject;
    protected config: DrawableConfig;

    protected alpha = 1;
    protected scale = 1;
    protected rotation = 0;
    protected x = 0;
    protected y = 0;

    protected armed_state = ArmedState.Idle;
    protected transforms = new TransformSequence();

    protected life_time_start = 0;
    protected life_time_end = 0;

    constructor(hit_object: RenderHitObject, config: DrawableConfig) {
        this.hit_object = hit_object;
        this.config = config;
        this.backend = config.backend;
        this.skin = config.skin;

        const data = hit_object.data as { pos: [number, number] };
        this.x = data.pos[0];
        this.y = data.pos[1];

        this.apply_defaults();
    }

    protected apply_defaults(): void {
        const { hit_object, config } = this;
        const appear_time = hit_object.time - config.preempt;

        this.life_time_start = appear_time;
        this.life_time_end = hit_object.end_time + 800;
    }

    is_alive(time: number): boolean {
        return time >= this.life_time_start && time <= this.life_time_end;
    }

    update(time: number): void {
        this.alpha = this.transforms.get_value("alpha", time, 1);
        this.scale = this.transforms.get_value("scale", time, 1);
        this.rotation = this.transforms.get_value("rotation", time, 0);

        this.update_state(time);
    }

    protected update_state(time: number): void {
        if (this.armed_state === ArmedState.Idle && time >= this.hit_object.time) {
            this.armed_state = ArmedState.Hit;
            // first crossing of hit time, useful for one-shot effects
            this.on_hit(time);
        }
    }

    protected on_hit(time: number): void {
        // override in subclasses
    }

    abstract render(time: number): void;

    // multi-pass rendering support
    render_body_pass(time: number): void {}
    render_head_pass(time: number): void {}

    get start_time(): number {
        return this.hit_object.time;
    }

    get end_time(): number {
        return this.hit_object.end_time;
    }

    get combo_number(): number {
        return this.hit_object.combo_number ?? 0;
    }

    get combo_count(): number {
        return this.hit_object.combo_count ?? 1;
    }

    get position(): [number, number] {
        return [this.x, this.y];
    }
}
