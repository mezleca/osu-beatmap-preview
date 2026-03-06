import { describe, expect, test } from "bun:test";
import { PlayerHitsoundScheduler } from "../src/player/player_hitsound";
import { SampleSet, type ITimingPoint } from "../src/types/beatmap";

const make_timing_point = (time: number, sample_index: number): ITimingPoint => ({
    time,
    beatLength: 500,
    meter: 4,
    sampleSet: SampleSet.Normal,
    sampleIndex: sample_index,
    volume: 100,
    uninherited: 1,
    effects: 0
});

describe("PlayerHitsoundScheduler timing selection", () => {
    test("uses latest timing point at same timestamp", () => {
        const scheduler = new PlayerHitsoundScheduler(
            {
                is_playing: false
            } as never,
            {} as never
        );

        (scheduler as unknown as { timing_points: ITimingPoint[] }).timing_points = [make_timing_point(1000, 2), make_timing_point(1000, 7)];

        const selected = (scheduler as unknown as { get_timing_point: (time: number) => ITimingPoint }).get_timing_point(1000);
        expect(selected.sampleIndex).toBe(7);
    });
});
