import { describe, expect, test } from "bun:test";
import { process_timing_points } from "../src/beatmap/timing";
import { SampleSet, type ITimingPoint } from "../src/types/beatmap";

const make_timing_point = (time: number, uninherited: number, sample_index: number): ITimingPoint => ({
    time,
    beatLength: uninherited === 1 ? 500 : -100,
    meter: 4,
    sampleSet: SampleSet.Normal,
    sampleIndex: sample_index,
    volume: 100,
    uninherited,
    effects: 0
});

describe("process_timing_points", () => {
    test("orders by time and keeps uninherited before inherited on same timestamp", () => {
        const points: ITimingPoint[] = [make_timing_point(1000, 0, 2), make_timing_point(1000, 1, 1), make_timing_point(800, 1, 3)];

        const ordered = process_timing_points(points);
        expect(ordered.map((p) => [p.time, p.uninherited, p.sampleIndex])).toEqual([
            [800, 1, 3],
            [1000, 1, 1],
            [1000, 0, 2]
        ]);
    });

    test("keeps original order for full ties", () => {
        const points: ITimingPoint[] = [make_timing_point(1000, 1, 3), make_timing_point(1000, 1, 7), make_timing_point(1000, 1, 9)];

        const ordered = process_timing_points(points);
        expect(ordered.map((p) => p.sampleIndex)).toEqual([3, 7, 9]);
    });
});
