import type { ITimingPoint, IHitObject, IHitSample } from "../types/beatmap";
import { SampleSet, HitObjectType } from "../types/beatmap";
import type { IBeatmapResources } from "../types/resources";
import { calculate_slider_duration, calculate_tick_spacing } from "../renderer/standard/slider_math";
import { generate_slider_events } from "../renderer/standard/slider_events";
import { TimingStateResolver } from "../renderer/standard/timing_state";
import { AudioEngine } from "./audio_engine";

const DEFAULT_HITSOUND_LOOKAHEAD_MS = 100;
const HIT_WINDOW_MS = 20;

type SampleSettings = {
    normal_set: SampleSet;
    addition_set: SampleSet;
    index: number;
    volume: number;
    custom_filename?: string;
};

type NightcorePoint = {
    time: number;
    beat_length: number;
    meter: number;
    volume: number;
};

type HitsoundOutput = {
    play: (
        normal_set: SampleSet,
        addition_set: SampleSet,
        hit_sound: number,
        index: number,
        volume: number,
        custom_filename: string | undefined,
        when: number
    ) => void;
    play_sample: (set: SampleSet, sample_name: string, index: number, volume: number, when: number) => void;
    play_custom: (sample_key: string, volume: number, when: number) => boolean;
};

export class PlayerHitsoundScheduler {
    private resources: IBeatmapResources | null = null;
    private timing_points: ITimingPoint[] = [];
    private timing_resolver: TimingStateResolver | null = null;
    private audio_offset: number = 20;
    private next_hit_object_index: number = 0;
    private hitsound_lookahead_ms: number = DEFAULT_HITSOUND_LOOKAHEAD_MS;
    private last_schedule_time: number = -Infinity;
    private nightcore_enabled: boolean = false;
    private nightcore_points: NightcorePoint[] = [];
    private nightcore_index: number = 0;
    private nightcore_next_time: number = 0;
    private nightcore_last_schedule_time: number = -Infinity;

    constructor(
        private audio: AudioEngine,
        private hitsounds: HitsoundOutput
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
        this.last_schedule_time = -Infinity;
        this.configure_nightcore_points();
    }

    set_audio_offset(offset_ms: number): void {
        this.audio_offset = offset_ms;
    }

    set_hitsound_lookahead(lookahead_ms: number): void {
        this.hitsound_lookahead_ms = Math.max(0, lookahead_ms);
    }

    set_nightcore_enabled(enabled: boolean): void {
        this.nightcore_enabled = enabled;
        this.reset_nightcore_state(0);
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

        this.last_schedule_time = time;
        this.reset_nightcore_state(time);
    }

    schedule_hitsounds(time: number): number {
        if (!this.resources?.beatmap) {
            return 0;
        }

        let scheduled_count = 0;
        const objects = this.resources.beatmap.HitObjects;
        const schedule_window = time + this.hitsound_lookahead_ms;
        const schedule_start = Math.max(time - HIT_WINDOW_MS, this.last_schedule_time);

        while (this.next_hit_object_index < objects.length && objects[this.next_hit_object_index].time <= schedule_window) {
            const obj = objects[this.next_hit_object_index];

            if (obj.time >= schedule_start) {
                this.play_hitsound(obj);
                scheduled_count++;
            }

            this.next_hit_object_index++;
        }

        if (this.nightcore_enabled) {
            scheduled_count += this.schedule_nightcore(time);
        }

        if (time > this.last_schedule_time) {
            this.last_schedule_time = time;
        }

        return scheduled_count;
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
        let span_duration = calculate_slider_duration(length, beatmap, timing_state);
        const span_count = Math.max(1, obj.slides || 1);

        if (span_duration <= 0 || length <= 0) {
            this.play_node_hitsound(obj.time, obj.hitSound, base, base.custom_filename);
            return;
        }

        if (obj.endTime && obj.endTime > obj.time && span_count > 0) {
            const total_duration = obj.endTime - obj.time;
            if (Number.isFinite(total_duration) && total_duration > 0) {
                span_duration = total_duration / span_count;
            }
        }

        const edge_sounds = obj.edgeSounds ?? [];
        const edge_sets = obj.edgeSets ?? [];

        for (let i = 0; i <= span_count; i++) {
            const node_time = obj.time + span_duration * i;
            const node_sound = edge_sounds.length > 0 ? (edge_sounds[i] ?? 0) : i == 0 ? obj.hitSound : 0;
            const node_sets = edge_sets.length > 0 ? edge_sets[i] : undefined;
            const node_timing = this.get_timing_point(node_time);
            const node_sample = this.resolve_sample_settings(node_timing, obj.hitSample);
            const resolved = this.resolve_edge_sets(node_sample, node_sets);
            const custom = i == 0 ? node_sample.custom_filename : undefined;
            this.play_node_hitsound(node_time, node_sound, { ...node_sample, ...resolved }, custom);
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
            const tick_timing = this.get_timing_point(tick.time);
            const tick_sample = this.resolve_sample_settings(tick_timing, obj.hitSample);
            const when = this.audio.get_host_time(tick.time + this.audio_offset);
            this.hitsounds.play_sample(tick_sample.normal_set, "slidertick", tick_sample.index, tick_sample.volume, when);
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
        const target_time = Math.round(time);
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
            if (points[i].time <= target_time) {
                return points[i];
            }
        }
        return points[0];
    }

    private configure_nightcore_points(): void {
        const points: NightcorePoint[] = [];

        for (let i = 0; i < this.timing_points.length; i++) {
            const point = this.timing_points[i];
            if (point.uninherited === 1 && point.beatLength > 0) {
                points.push({
                    time: point.time,
                    beat_length: point.beatLength,
                    meter: point.meter || 4,
                    volume: point.volume || 100
                });
            }
        }

        if (points.length == 0) {
            points.push({ time: 0, beat_length: 600, meter: 4, volume: 100 });
        }

        this.nightcore_points = points;
        this.nightcore_index = 0;
        this.nightcore_next_time = points[0].time;
        this.nightcore_last_schedule_time = -Infinity;
    }

    private reset_nightcore_state(time: number): void {
        if (!this.nightcore_enabled || this.nightcore_points.length == 0) {
            return;
        }

        let idx = 0;
        for (let i = 0; i < this.nightcore_points.length; i++) {
            if (this.nightcore_points[i].time <= time) {
                idx = i;
            } else {
                break;
            }
        }

        const point = this.nightcore_points[idx];
        const beat_length = Math.max(1, point.beat_length);
        const offset = time - point.time;
        const beats_since = offset <= 0 ? 0 : Math.floor(offset / beat_length);
        let next_time = point.time + beats_since * beat_length;
        if (next_time < time) {
            next_time += beat_length;
        }

        this.nightcore_index = idx;
        this.nightcore_next_time = next_time;
        this.nightcore_last_schedule_time = time;
    }

    private schedule_nightcore(time: number): number {
        if (this.nightcore_points.length == 0) {
            return 0;
        }

        const schedule_window = time + this.hitsound_lookahead_ms;
        const schedule_start = Math.max(time - HIT_WINDOW_MS, this.nightcore_last_schedule_time);
        let scheduled = 0;

        let idx = this.nightcore_index;
        let next_time = this.nightcore_next_time;

        while (idx < this.nightcore_points.length && next_time <= schedule_window) {
            const point = this.nightcore_points[idx];
            const beat_length = Math.max(1, point.beat_length);
            const next_point_time = idx + 1 < this.nightcore_points.length ? this.nightcore_points[idx + 1].time : Number.POSITIVE_INFINITY;

            if (next_time >= next_point_time) {
                idx++;
                if (idx >= this.nightcore_points.length) {
                    break;
                }
                next_time = Math.max(next_time, this.nightcore_points[idx].time);
                continue;
            }

            if (next_time >= schedule_start) {
                const beat_index = Math.round((next_time - point.time) / beat_length);
                if (this.play_nightcore_beat(point, beat_index, next_time)) {
                    scheduled++;
                }
            }

            next_time += beat_length;
        }

        this.nightcore_index = Math.min(idx, this.nightcore_points.length - 1);
        this.nightcore_next_time = next_time;
        if (time > this.nightcore_last_schedule_time) {
            this.nightcore_last_schedule_time = time;
        }

        return scheduled;
    }

    private play_nightcore_beat(point: NightcorePoint, beat_index: number, time: number): boolean {
        const when = this.audio.get_host_time(time + this.audio_offset);
        const meter = point.meter || 4;
        const beat_in_bar = meter > 0 ? beat_index % meter : beat_index % 4;

        let played = false;

        if (beat_in_bar === 0) {
            played = this.hitsounds.play_custom("nightcore-finish", point.volume, when) || played;
            played = this.hitsounds.play_custom("nightcore-kick", point.volume, when) || played;
        } else if (meter === 3 && beat_in_bar === 1) {
            played = this.hitsounds.play_custom("nightcore-clap", point.volume, when) || played;
        } else if (meter !== 3 && beat_in_bar === 2) {
            played = this.hitsounds.play_custom("nightcore-clap", point.volume, when) || played;
        } else {
            played = this.hitsounds.play_custom("nightcore-hat", Math.max(20, point.volume - 20), when) || played;
        }

        return played;
    }
}
