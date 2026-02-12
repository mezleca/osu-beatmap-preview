import type { ITimingPoint, IHitObject, IHitSample } from "../types/beatmap";
import { SampleSet, HitObjectType } from "../types/beatmap";
import type { IBeatmapResources } from "../types/resources";
import { calculate_slider_duration, calculate_tick_spacing } from "../renderer/standard/slider_math";
import { generate_slider_events } from "../renderer/standard/slider_events";
import { TimingStateResolver } from "../renderer/standard/timing_state";
import { AudioController } from "./audio_controller";
import { HitsoundController } from "./hitsound_controller";

const HITSOUND_LOOKAHEAD_MS = 100;
const HIT_WINDOW_MS = 20;

type SampleSettings = {
    normal_set: SampleSet;
    addition_set: SampleSet;
    index: number;
    volume: number;
    custom_filename?: string;
};

export class PlayerHitsoundScheduler {
    private resources: IBeatmapResources | null = null;
    private timing_points: ITimingPoint[] = [];
    private timing_resolver: TimingStateResolver | null = null;
    private audio_offset: number = 20;
    private next_hit_object_index: number = 0;

    constructor(
        private audio: AudioController,
        private hitsounds: HitsoundController
    ) {}

    set_context(
        resources: IBeatmapResources | null,
        timing_points: ITimingPoint[],
        timing_resolver: TimingStateResolver | null,
        audio_offset: number
    ): void {
        this.resources = resources;
        this.timing_points = timing_points;
        this.timing_resolver = timing_resolver;
        this.audio_offset = audio_offset;
        this.next_hit_object_index = 0;
    }

    set_audio_offset(offset_ms: number): void {
        this.audio_offset = offset_ms;
    }

    update_hit_index(time: number): void {
        if (!this.resources?.beatmap) {
            return;
        }

        const objects = this.resources.beatmap.HitObjects;

        if (this.next_hit_object_index > 0 && objects[this.next_hit_object_index - 1].time > time) {
            this.next_hit_object_index = 0;
        }

        while (this.next_hit_object_index < objects.length && objects[this.next_hit_object_index].time < time) {
            this.next_hit_object_index++;
        }
    }

    schedule_hitsounds(time: number): void {
        if (!this.resources?.beatmap || !this.audio.is_playing) {
            return;
        }

        const objects = this.resources.beatmap.HitObjects;
        const schedule_window = time + HITSOUND_LOOKAHEAD_MS;

        while (this.next_hit_object_index < objects.length && objects[this.next_hit_object_index].time <= schedule_window) {
            const obj = objects[this.next_hit_object_index];

            if (obj.time >= time - HIT_WINDOW_MS) {
                this.play_hitsound(obj);
            }

            this.next_hit_object_index++;
        }
    }

    private play_hitsound(obj: IHitObject): void {
        const timing = this.get_timing_point(obj.time);
        const base = this.resolve_sample_settings(timing, obj.hitSample);

        if ((obj.type & HitObjectType.Slider) === 0) {
            this.play_node_hitsound(obj.time, obj.hitSound, base, base.custom_filename);
            return;
        }

        const beatmap = this.resources?.beatmap;
        if (!beatmap) {
            return;
        }

        const timing_state = this.timing_resolver?.get_state_at(obj.time) ?? { base_beat_length: 600, sv_multiplier: 1 };
        const length = obj.length ?? 0;
        const span_duration = calculate_slider_duration(length, beatmap, timing_state);
        const span_count = Math.max(1, obj.slides || 1);

        if (span_duration <= 0 || length <= 0) {
            this.play_node_hitsound(obj.time, obj.hitSound, base, base.custom_filename);
            return;
        }

        const edge_sounds = obj.edgeSounds ?? [];
        const edge_sets = obj.edgeSets ?? [];

        for (let i = 0; i <= span_count; i++) {
            const node_time = obj.time + span_duration * i;
            const node_sound = edge_sounds.length > 0 ? (edge_sounds[i] ?? 0) : i == 0 ? obj.hitSound : 0;
            const node_sets = edge_sets.length > 0 ? edge_sets[i] : undefined;
            const resolved = this.resolve_edge_sets(base, node_sets);
            const custom = i == 0 ? base.custom_filename : undefined;
            this.play_node_hitsound(node_time, node_sound, { ...base, ...resolved }, custom);
        }

        const spacing = calculate_tick_spacing(beatmap, timing_state);
        const events = generate_slider_events({
            start_time: obj.time,
            span_duration,
            span_count,
            length,
            tick_distance: spacing.tick_distance,
            min_distance_from_end: spacing.min_distance_from_end,
            get_position_at_progress: () => [0, 0]
        });

        for (const tick of events.ticks) {
            const when = this.audio.get_host_time(tick.time + this.audio_offset);
            this.hitsounds.play_sample(base.normal_set, "slidertick", base.index, base.volume, when);
        }
    }

    private play_node_hitsound(time: number, hit_sound: number, sample: SampleSettings, custom_filename?: string): void {
        const when = this.audio.get_host_time(time + this.audio_offset);
        this.hitsounds.play(sample.normal_set, sample.addition_set, hit_sound, sample.index, sample.volume, custom_filename, when);
    }

    private resolve_sample_settings(timing: ITimingPoint, hit_sample?: IHitSample): SampleSettings {
        let volume = timing.volume;
        let normal_set = timing.sampleSet as SampleSet;
        let addition_set = timing.sampleSet as SampleSet;
        let index = timing.sampleIndex;
        let custom_filename: string | undefined = undefined;

        if (hit_sample) {
            if (hit_sample.normalSet !== SampleSet.Auto) {
                normal_set = hit_sample.normalSet as SampleSet;
                if (hit_sample.additionSet === SampleSet.Auto) {
                    addition_set = normal_set;
                }
            }

            if (hit_sample.additionSet !== SampleSet.Auto) {
                addition_set = hit_sample.additionSet as SampleSet;
            }

            if (hit_sample.index !== 0) {
                index = hit_sample.index;
            }
            if (hit_sample.volume !== 0) {
                volume = hit_sample.volume;
            }
            custom_filename = hit_sample.filename || undefined;
        }

        if (normal_set === SampleSet.Auto) {
            normal_set = SampleSet.Normal;
        }
        if (addition_set === SampleSet.Auto) {
            addition_set = normal_set;
        }

        return { normal_set, addition_set, index, volume, custom_filename };
    }

    private resolve_edge_sets(
        base: { normal_set: SampleSet; addition_set: SampleSet },
        edge_set?: { normalSet: number; additionSet: number }
    ): {
        normal_set: SampleSet;
        addition_set: SampleSet;
    } {
        let normal_set = base.normal_set;
        let addition_set = base.addition_set;

        if (edge_set) {
            const edge_normal = edge_set.normalSet as SampleSet;
            const edge_add = edge_set.additionSet as SampleSet;

            if (edge_normal !== SampleSet.Auto) {
                normal_set = edge_normal;
            }
            if (edge_add !== SampleSet.Auto) {
                addition_set = edge_add;
            } else {
                addition_set = normal_set;
            }
        }

        if (normal_set === SampleSet.Auto) {
            normal_set = SampleSet.Normal;
        }
        if (addition_set === SampleSet.Auto) {
            addition_set = normal_set;
        }

        return { normal_set, addition_set };
    }

    private get_timing_point(time: number): ITimingPoint {
        const points = this.timing_points;
        if (points.length == 0) {
            return {
                time: 0,
                beatLength: 600,
                meter: 4,
                sampleSet: SampleSet.Normal,
                sampleIndex: 1,
                volume: 100,
                uninherited: 1,
                effects: 0
            };
        }

        for (let i = points.length - 1; i >= 0; i--) {
            if (points[i].time <= time) {
                return points[i];
            }
        }
        return points[0];
    }
}
