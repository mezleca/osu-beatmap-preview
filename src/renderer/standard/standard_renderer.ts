import type { IBeatmap, ITimingPoint } from "../../types/beatmap";
import { is_circle, is_slider, is_spinner, is_new_combo } from "../../types/beatmap";
import { Mods, has_mod } from "../../types/mods";
import { calculate_preempt, calculate_fade_in, calculate_radius } from "../../math/difficulty";
import { get_adjusted_difficulty } from "../../mods";
import { clamp, vec2_add, vec2_dist, type Vec2 } from "../../math/vector2";
import { BaseRenderer, type IRendererConfig, DEFAULT_RENDERER_CONFIG } from "../base_renderer";
import type { IRenderBackend } from "../backend/render_backend";
import type { ISkinConfig } from "../../skin/skin_config";
import { get_combo_color } from "../../skin/skin_config";
import { Drawable, DrawableHitCircle, DrawableSlider, type DrawableConfig } from "../drawable";
import { Easing } from "../drawable/transforms";
import { FollowPointRenderer } from "./follow_points";
import { compute_slider_path, get_slider_end_position } from "./slider_path";
import { calculate_slider_duration, calculate_tick_spacing } from "./slider_math";
import { TimingStateResolver } from "./timing_state";
import { STANDARD_RUNTIME_DEFAULTS } from "../../config/standard";
import { process_timing_points } from "../../beatmap/timing";
import type { RenderHitObject, RenderSliderData } from "../render_types";
import { build_render_objects } from "../render_objects";
import type { StandardSkinElements } from "../../skin/skin_elements";

const flip_y = (y: number): number => 384 - y;

export class StandardRenderer extends BaseRenderer {
    private radius = 32;
    private preempt = 1200;
    private fade_in = 600;
    private timing_points: ITimingPoint[] = [];
    private timing_resolver: TimingStateResolver | null = null;

    private drawables: Drawable[] = [];
    private slider_drawables: DrawableSlider[] = [];
    private slider_cache_lru: DrawableSlider[] = [];
    private precompute_focus_time = 0;
    private precompute_handle: number | null = null;
    private precompute_pause_until = 0;
    private last_seek_prefetch_at = 0;
    private drawable_config!: DrawableConfig;
    private follow_point_renderer: FollowPointRenderer;
    private spinner_objects: RenderHitObject[] = [];
    private frame_visible_drawables: Drawable[] = [];
    private frame_visible_sliders: DrawableSlider[] = [];
    private frame_visible_other: Drawable[] = [];
    private slider_cache_limit: number = STANDARD_RUNTIME_DEFAULTS.slider_cache.max_entries;
    private slider_cache_bytes = 0;
    private last_cache_trim_at = 0;

    constructor(
        backend: IRenderBackend,
        skin: ISkinConfig,
        mods: number = 0,
        config: IRendererConfig = DEFAULT_RENDERER_CONFIG,
        skin_elements: StandardSkinElements | null = null
    ) {
        super(backend, skin, mods, config, skin_elements);
        this.follow_point_renderer = new FollowPointRenderer(skin, mods, this.preempt, this.fade_in, this.radius, skin_elements);
    }

    initialize(beatmap: IBeatmap): void {
        this.release_drawables();

        this.beatmap = beatmap;
        this.objects = build_render_objects(beatmap).sort((a: RenderHitObject, b: RenderHitObject) => a.time - b.time);
        this.timing_points = process_timing_points([...beatmap.TimingPoints]);
        this.timing_resolver = new TimingStateResolver(this.timing_points);

        const ar = beatmap.Difficulty.ApproachRate >= 0 ? beatmap.Difficulty.ApproachRate : beatmap.Difficulty.OverallDifficulty;
        const difficulty = get_adjusted_difficulty(beatmap.Difficulty.CircleSize, ar, 0, 0, this.mods);
        this.radius = calculate_radius(difficulty.cs);
        this.preempt = calculate_preempt(difficulty.ar);
        this.fade_in = calculate_fade_in(this.preempt);
        if (has_mod(this.mods, Mods.Hidden)) {
            this.fade_in = this.preempt * 0.4;
        }

        this.follow_point_renderer.update_settings(this.mods, this.preempt, this.fade_in, this.radius, this.skin_elements);

        this.preprocess_objects();
        this.follow_point_renderer.build(this.objects);
        this.create_drawables();
    }

    set_mods(mods: number): void {
        this.mods = mods;
        if (this.beatmap) {
            this.initialize(this.beatmap);
        }
    }

    private preprocess_objects(): void {
        let combo_number = 0;
        let combo_count = 1;
        if (this.timing_resolver) {
            this.timing_resolver.reset();
        }

        for (const obj of this.objects) {
            if (is_new_combo(obj)) {
                combo_number = (combo_number + 1) % this.skin.combo_colors.length;
                combo_count = 1;
            } else {
                combo_count++;
            }
            obj.combo_number = combo_number;
            obj.combo_count = combo_count;

            if (is_slider(obj)) {
                const data = obj.data as RenderSliderData;

                if (has_mod(this.mods, Mods.HardRock)) {
                    data.pos = [data.pos[0], flip_y(data.pos[1])];
                    data.control_points = data.control_points.map((p) => [p[0], flip_y(p[1])] as [number, number]);
                }

                data.computed_path = compute_slider_path(data);

                const timing_state = this.timing_resolver?.get_state_at(obj.time) ?? { base_beat_length: 600, sv_multiplier: 1 };
                const duration = calculate_slider_duration(data.distance, this.beatmap, timing_state);

                data.duration = duration;
                obj.end_time = obj.time + duration * data.repetitions;
                obj.end_pos = get_slider_end_position(data);
            } else if (is_spinner(obj)) {
                obj.end_pos = [256, 192];
            } else {
                const data = obj.data as { pos: Vec2 };
                if (has_mod(this.mods, Mods.HardRock)) {
                    data.pos = [data.pos[0], flip_y(data.pos[1])];
                }
                obj.end_pos = data.pos;
            }
        }

        this.apply_stacking_if_enabled();
    }

    private apply_stacking_if_enabled(): void {
        if (!this.config.enable_stacking || this.objects.length < 2) {
            return;
        }

        const stack_leniency = this.resolve_stack_leniency();
        const stack_threshold = this.preempt * stack_leniency;
        const stack_scale = this.radius / 64;
        const stack_offset_unit = -STANDARD_RUNTIME_DEFAULTS.stack.offset_multiplier * stack_scale;

        for (let i = 0; i < this.objects.length; i++) {
            this.objects[i].stack_height = 0;
            this.objects[i].stack_offset = [0, 0];
        }

        for (let i = this.objects.length - 1; i > 0; i--) {
            let object_i = this.objects[i];

            if (is_spinner(object_i)) {
                continue;
            }

            for (let n = i - 1; n >= 0; n--) {
                const object_n = this.objects[n];
                if (is_spinner(object_n)) {
                    continue;
                }

                if ((object_i.time as number) - (object_n.end_time as number) > stack_threshold) {
                    break;
                }

                const object_i_position = this.get_object_start_position(object_i);
                const object_n_position = this.get_object_start_position(object_n);
                const start_distance = vec2_dist(object_n_position, object_i_position);
                const end_distance = is_slider(object_n) ? vec2_dist(object_n.end_pos, object_i_position) : Infinity;

                if (is_circle(object_i) && is_slider(object_n) && end_distance < STANDARD_RUNTIME_DEFAULTS.stack.distance) {
                    const offset = object_i.stack_height - object_n.stack_height + 1;

                    for (let j = n + 1; j <= i; j++) {
                        const object_j = this.objects[j];
                        if (is_spinner(object_j)) {
                            continue;
                        }

                        const object_j_position = this.get_object_start_position(object_j);
                        if (vec2_dist(object_n.end_pos, object_j_position) < STANDARD_RUNTIME_DEFAULTS.stack.distance) {
                            object_j.stack_height -= offset;
                        }
                    }

                    break;
                }

                if (start_distance < STANDARD_RUNTIME_DEFAULTS.stack.distance || end_distance < STANDARD_RUNTIME_DEFAULTS.stack.distance) {
                    object_n.stack_height = object_i.stack_height + 1;
                    object_i = object_n;
                }
            }
        }

        for (let i = 0; i < this.objects.length; i++) {
            const obj = this.objects[i];
            if (obj.stack_height === 0) {
                continue;
            }

            const offset_value = obj.stack_height * stack_offset_unit;
            const offset: Vec2 = [offset_value, offset_value];
            obj.stack_offset = offset;
            obj.end_pos = vec2_add(obj.end_pos, offset);

            if (is_slider(obj)) {
                const data = obj.data as RenderSliderData;
                data.pos = vec2_add(data.pos, offset);

                const shifted_controls: Vec2[] = [];
                for (let j = 0; j < data.control_points.length; j++) {
                    shifted_controls.push(vec2_add(data.control_points[j], offset));
                }
                data.control_points = shifted_controls;

                if (data.computed_path) {
                    const shifted_path: Vec2[] = [];
                    for (let j = 0; j < data.computed_path.length; j++) {
                        shifted_path.push(vec2_add(data.computed_path[j], offset));
                    }
                    data.computed_path = shifted_path;
                }
                continue;
            }

            if (!is_spinner(obj)) {
                const data = obj.data as { pos: Vec2 };
                data.pos = vec2_add(data.pos, offset);
            }
        }
    }

    private resolve_stack_leniency(): number {
        const beatmap = this.beatmap as unknown as {
            StackLeniency?: number;
            Difficulty?: { StackLeniency?: number };
            General?: { StackLeniency?: number };
        };
        const value =
            beatmap.StackLeniency ??
            beatmap.Difficulty?.StackLeniency ??
            beatmap.General?.StackLeniency ??
            STANDARD_RUNTIME_DEFAULTS.stack.default_leniency;
        if (value <= 0) {
            return STANDARD_RUNTIME_DEFAULTS.stack.default_leniency;
        }

        return value;
    }

    private get_object_start_position(obj: RenderHitObject): Vec2 {
        if (is_slider(obj)) {
            return (obj.data as RenderSliderData).pos;
        }
        if (is_spinner(obj)) {
            return [256, 192];
        }

        return (obj.data as { pos: Vec2 }).pos;
    }

    private create_drawables(): void {
        this.release_drawables();
        const dpr = this.config.use_high_dpi ? window.devicePixelRatio || 1 : 1;
        this.drawable_config = {
            backend: this.backend,
            skin: this.skin,
            skin_elements: this.skin_elements,
            preempt: this.preempt,
            fade_in: this.fade_in,
            radius: this.radius,
            scale: this.config.scale * dpr,
            mods: this.mods
        };

        if (this.timing_resolver) {
            this.timing_resolver.reset();
        }

        this.spinner_objects = [];
        for (const obj of this.objects) {
            if (is_circle(obj)) {
                this.drawables.push(new DrawableHitCircle(obj, this.drawable_config));
            } else if (is_slider(obj)) {
                const data = obj.data as RenderSliderData;
                const path = data.computed_path || [];
                const span_duration = data.duration || 0;

                const timing_state = this.timing_resolver?.get_state_at(obj.time) ?? { base_beat_length: 600, sv_multiplier: 1 };
                const { tick_distance, min_distance_from_end } = calculate_tick_spacing(this.beatmap, timing_state);

                const slider = new DrawableSlider(obj, this.drawable_config, path, span_duration, tick_distance, min_distance_from_end);
                this.drawables.push(slider);
                this.slider_drawables.push(slider);
            } else if (is_spinner(obj)) {
                this.spinner_objects.push(obj);
            }
        }
        this.slider_cache_limit = Math.min(STANDARD_RUNTIME_DEFAULTS.slider_cache.max_entries, this.slider_drawables.length);
        this.slider_cache_bytes = 0;
    }

    render(time: number): void {
        const { backend, config } = this;
        this.precompute_focus_time = time;

        this.render_background();
        backend.save();
        backend.translate(config.offset_x, config.offset_y);
        backend.scale(config.scale, config.scale);
        this.render_playfield();
        this.render_grid();

        const visible_drawables = this.frame_visible_drawables;
        const visible_sliders = this.frame_visible_sliders;
        const visible_other = this.frame_visible_other;
        visible_drawables.length = 0;
        visible_sliders.length = 0;
        visible_other.length = 0;

        for (let i = this.drawables.length - 1; i >= 0; i--) {
            const drawable = this.drawables[i];
            if (!drawable.is_alive(time)) {
                continue;
            }

            drawable.update(time);
            visible_drawables.push(drawable);
            if (drawable instanceof DrawableSlider) {
                visible_sliders.push(drawable);
            } else {
                visible_other.push(drawable);
            }
        }

        this.follow_point_renderer.render(time, backend, (t, hit_time) => this.get_circle_alpha(t, hit_time));

        for (let i = 0; i < this.spinner_objects.length; i++) {
            const obj = this.spinner_objects[i];
            const appear_time = obj.time - this.preempt;
            if (time >= appear_time && time <= obj.end_time + 200) {
                this.draw_spinner(obj, time);
            }
        }

        for (let i = 0; i < visible_sliders.length; i++) {
            const slider = visible_sliders[i];
            slider.render_body_pass(time);
            this.touch_slider_cache(slider);
        }

        const now = performance.now();
        if (now - this.last_cache_trim_at >= STANDARD_RUNTIME_DEFAULTS.slider_cache.trim_interval_ms) {
            this.last_cache_trim_at = now;
            this.trim_slider_cache_by_time(time);
        }

        for (let i = 0; i < visible_sliders.length; i++) {
            visible_sliders[i].render_head_pass(time);
        }
        for (let i = 0; i < visible_other.length; i++) {
            visible_other[i].render(time);
        }

        if (!has_mod(this.mods, Mods.Hidden) && this.skin.enable_approach_circle) {
            for (const drawable of visible_drawables) {
                if (time <= drawable.start_time) {
                    this.draw_approach_circle(drawable, time);
                }
            }
        }

        backend.restore();
    }

    precompute(start_time: number = 0): void {
        this.precompute_focus_time = start_time;
        this.process_precompute_queue(start_time, STANDARD_RUNTIME_DEFAULTS.precompute.bootstrap_budget_ms, true);
        this.start_precompute_loop();
    }

    on_seek(time: number): void {
        this.precompute_focus_time = time;
        this.precompute_pause_until = performance.now() + 90;
        const now = performance.now();
        if (now - this.last_seek_prefetch_at < 48) {
            return;
        }
        this.last_seek_prefetch_at = now;
        this.process_precompute_queue(time, 1.0, false);
    }

    dispose(): void {
        this.stop_precompute_loop();
        this.release_drawables();
        this.timing_points = [];
        this.timing_resolver = null;
        super.dispose();
    }

    private release_drawables(): void {
        this.stop_precompute_loop();
        for (const drawable of this.drawables) {
            drawable.dispose();
        }
        this.drawables = [];
        this.slider_drawables = [];
        this.slider_cache_lru = [];
        this.slider_cache_bytes = 0;
        this.spinner_objects = [];
        this.frame_visible_drawables.length = 0;
        this.frame_visible_sliders.length = 0;
        this.frame_visible_other.length = 0;
    }

    private start_precompute_loop(): void {
        if (this.precompute_handle !== null) {
            return;
        }

        const step = () => {
            this.precompute_handle = null;
            if (!this.has_uncached_sliders()) {
                return;
            }

            if (performance.now() >= this.precompute_pause_until) {
                this.process_precompute_queue(this.precompute_focus_time, STANDARD_RUNTIME_DEFAULTS.precompute.frame_budget_ms, false);
            }

            this.precompute_handle = window.requestAnimationFrame(step);
        };

        this.precompute_handle = window.requestAnimationFrame(step);
    }

    private stop_precompute_loop(): void {
        if (this.precompute_handle !== null) {
            window.cancelAnimationFrame(this.precompute_handle);
            this.precompute_handle = null;
        }
    }

    private has_uncached_sliders(): boolean {
        for (let i = 0; i < this.slider_drawables.length; i++) {
            if (!this.slider_drawables[i].has_body_cache()) {
                return true;
            }
        }
        return false;
    }

    private process_precompute_queue(focus_time: number, budget_ms: number, prefer_complex: boolean): void {
        if (this.slider_drawables.length === 0) {
            return;
        }

        const deadline = performance.now() + budget_ms;
        let processed = 0;
        const max_per_pass = prefer_complex ? 2 : 1;

        while (performance.now() < deadline && processed < max_per_pass) {
            const slider = this.pick_next_slider_for_precompute(focus_time, prefer_complex);
            if (!slider) {
                break;
            }

            slider.prepare_body_cache();
            this.touch_slider_cache(slider);
            processed++;
        }
    }

    private pick_next_slider_for_precompute(focus_time: number, prefer_complex: boolean): DrawableSlider | null {
        let selected: DrawableSlider | null = null;
        let best_score = -Infinity;

        for (let i = 0; i < this.slider_drawables.length; i++) {
            const slider = this.slider_drawables[i];
            const score = this.score_slider_for_precompute(slider, focus_time, prefer_complex);
            if (score <= best_score) {
                continue;
            }
            best_score = score;
            selected = slider;
        }

        return selected ?? this.pick_nearest_uncached_slider(focus_time);
    }

    private score_slider_for_precompute(slider: DrawableSlider, focus_time: number, prefer_complex: boolean): number {
        if (slider.has_body_cache()) {
            return -Infinity;
        }

        const delta = slider.start_time - focus_time;
        const complexity = slider.estimate_complexity();
        const in_window = delta >= -STANDARD_RUNTIME_DEFAULTS.precompute.lookback_ms && delta <= STANDARD_RUNTIME_DEFAULTS.precompute.lookahead_ms;

        if (in_window) {
            const distance_penalty = Math.abs(delta) * 0.025;
            const complexity_penalty = prefer_complex ? 0 : complexity * 0.02;
            const complexity_bonus = prefer_complex ? complexity * 0.2 : 0;
            return complexity_bonus - distance_penalty - complexity_penalty;
        }

        if (prefer_complex) {
            return complexity;
        }

        return -Infinity;
    }

    private pick_nearest_uncached_slider(focus_time: number): DrawableSlider | null {
        let nearest: DrawableSlider | null = null;
        let nearest_delta = Infinity;

        for (let i = 0; i < this.slider_drawables.length; i++) {
            const slider = this.slider_drawables[i];
            if (slider.has_body_cache()) {
                continue;
            }

            const delta = Math.abs(slider.start_time - focus_time);
            if (delta >= nearest_delta) {
                continue;
            }

            nearest_delta = delta;
            nearest = slider;
        }

        return nearest;
    }

    private touch_slider_cache(slider: DrawableSlider): void {
        if (!slider.has_body_cache()) {
            return;
        }

        const index = this.slider_cache_lru.indexOf(slider);
        if (index >= 0) {
            this.slider_cache_lru.splice(index, 1);
            this.slider_cache_lru.push(slider);
            return;
        }

        this.slider_cache_lru.push(slider);
        this.slider_cache_bytes += slider.get_body_cache_bytes();
        this.enforce_slider_cache_limit();
    }

    private enforce_slider_cache_limit(): void {
        while (this.slider_cache_lru.length > this.slider_cache_limit || this.slider_cache_bytes > STANDARD_RUNTIME_DEFAULTS.slider_cache.max_bytes) {
            const victim = this.slider_cache_lru.shift();
            if (!victim) {
                break;
            }
            this.slider_cache_bytes -= victim.get_body_cache_bytes();
            victim.release_body_cache();
        }
    }

    private trim_slider_cache_by_time(focus_time: number): void {
        if (this.slider_cache_lru.length === 0) {
            return;
        }

        const retained: DrawableSlider[] = [];
        let retained_bytes = 0;
        for (let i = 0; i < this.slider_cache_lru.length; i++) {
            const slider = this.slider_cache_lru[i];
            if (!slider.has_body_cache()) {
                continue;
            }

            const delta = Math.abs(slider.start_time - focus_time);
            const keep = delta <= STANDARD_RUNTIME_DEFAULTS.slider_cache.retention_ms || slider.is_alive(focus_time);
            if (keep) {
                retained.push(slider);
                retained_bytes += slider.get_body_cache_bytes();
            } else {
                slider.release_body_cache();
            }
        }

        this.slider_cache_lru = retained;
        this.slider_cache_bytes = retained_bytes;
        this.enforce_slider_cache_limit();
    }

    private draw_approach_circle(drawable: Drawable, time: number): void {
        const pos = drawable.position;
        const appear_time = drawable.start_time - this.preempt;
        const progress = clamp((time - appear_time) / this.preempt, 0, 1);
        const scale = 4 - 3 * progress;

        const fade_in_duration = Math.min(this.fade_in * 2, this.preempt);
        const fade_progress = clamp((time - appear_time) / Math.max(1, fade_in_duration), 0, 1);
        const opacity = this.skin.approach_circle_opacity * fade_progress;
        if (opacity <= 0.01) {
            return;
        }

        this.backend.save();
        this.backend.set_alpha(opacity);

        const approach_image = this.skin_elements?.approachcircle;
        if (approach_image) {
            const size = this.radius * 2 * scale;
            this.backend.draw_image(approach_image, pos[0] - size / 2, pos[1] - size / 2, size, size);
        } else {
            const stroke_color = this.skin.approach_circle_use_combo_color
                ? get_combo_color(this.skin, drawable.combo_number, 1)
                : (this.skin.approach_circle_color ?? "rgba(255,255,255,1)");
            this.backend.draw_circle(pos[0], pos[1], this.radius * scale, "transparent", stroke_color, this.radius * this.skin.approach_circle_width);
        }
        this.backend.restore();
    }

    private get_circle_alpha(time: number, hit_time: number): number {
        const appear_time = hit_time - this.preempt;
        if (time < appear_time) return 0;

        let alpha = clamp((time - appear_time) / this.fade_in, 0, 1);

        if (has_mod(this.mods, Mods.Hidden)) {
            const fade_out_start = hit_time - this.preempt + this.fade_in;
            const fade_out_duration = this.preempt * 0.3;
            if (time > fade_out_start) {
                const fade_out_progress = clamp((time - fade_out_start) / fade_out_duration, 0, 1);
                alpha *= 1 - fade_out_progress;
            }
        }

        return alpha;
    }

    private draw_spinner(obj: RenderHitObject, time: number): void {
        const appear_time = obj.time - this.preempt;
        let opacity = clamp((time - appear_time) / this.fade_in, 0, 1);

        if (time > obj.end_time) {
            opacity = 1 - Easing.OutCubic(clamp((time - obj.end_time) / 200, 0, 1));
        }
        if (opacity <= 0) return;

        const x = 256;
        const y = 192;
        const duration = Math.max(1, obj.end_time - obj.time);
        const progress = clamp((time - obj.time) / duration, 0, 1);

        this.backend.save();
        this.backend.set_alpha(opacity);
        const approach_size = this.skin.spinner_size * (1 - progress);

        if (approach_size > 5) {
            this.backend.begin_path();
            this.backend.arc_to(x, y, approach_size, 0, Math.PI * 2);
            this.backend.stroke_path("rgba(255,255,255,0.6)", 4);
        }

        this.backend.draw_circle(x, y, this.skin.spinner_size, "rgba(0,0,0,0.2)");
        this.backend.draw_circle(x, y, 12, "white");
        this.backend.restore();
    }
}
