import { describe, expect, test } from "bun:test";
import { generate_slider_events } from "../src/renderer/standard/slider_events";

describe("generate_slider_events", () => {
    test("does not place ticks near slider end according to min_distance_from_end", () => {
        const events = generate_slider_events({
            start_time: 1000,
            span_duration: 1000,
            span_count: 1,
            length: 100,
            tick_distance: 25,
            min_distance_from_end: 30,
            get_position_at_progress: (progress) => [progress, 0]
        });

        expect(events.ticks.length).toBe(2);
        expect(events.ticks.map((t) => Number(t.path_progress.toFixed(2)))).toEqual([0.25, 0.5]);
    });

    test("keeps tick time ordering across reversed spans", () => {
        const events = generate_slider_events({
            start_time: 0,
            span_duration: 1000,
            span_count: 2,
            length: 100,
            tick_distance: 25,
            min_distance_from_end: 1,
            get_position_at_progress: (progress) => [progress, 0]
        });

        expect(events.repeats.length).toBe(1);
        expect(events.repeats[0].time).toBe(1000);

        const tick_times = events.ticks.map((t) => t.time);
        for (let i = 1; i < tick_times.length; i++) {
            expect(tick_times[i]).toBeGreaterThanOrEqual(tick_times[i - 1]);
        }
    });
});
