import type { Vec2 } from "../../math/vector2";

export type SliderTickEvent = {
    pos: Vec2;
    time: number;
    span_index: number;
    path_progress: number;
};

export type SliderRepeatEvent = {
    pos: Vec2;
    time: number;
    repeat_index: number;
    path_progress: number;
};

type SliderEventInputs = {
    start_time: number;
    span_duration: number;
    span_count: number;
    length: number;
    tick_distance: number;
    min_distance_from_end: number;
    get_position_at_progress: (progress: number) => Vec2;
};

export const generate_slider_events = (inputs: SliderEventInputs): { ticks: SliderTickEvent[]; repeats: SliderRepeatEvent[] } => {
    const { start_time, span_duration, span_count, length, tick_distance, min_distance_from_end, get_position_at_progress } = inputs;
    const ticks: SliderTickEvent[] = [];
    const repeats: SliderRepeatEvent[] = [];

    if (length <= 0 || span_duration <= 0 || span_count <= 0) {
        return { ticks, repeats };
    }

    const max_length = 100000;
    const clamped_length = Math.min(max_length, length);
    const clamped_tick_distance = Math.min(Math.max(tick_distance, 0), clamped_length);
    const clamped_min_distance = Math.max(0, Math.min(min_distance_from_end, clamped_length));

    for (let span = 0; span < span_count; span++) {
        const span_start_time = start_time + span * span_duration;
        const reversed = span % 2 === 1;

        if (clamped_tick_distance > 0) {
            const span_ticks = generate_ticks(
                span,
                span_start_time,
                span_duration,
                reversed,
                clamped_length,
                clamped_tick_distance,
                clamped_min_distance,
                get_position_at_progress
            );
            if (reversed) {
                span_ticks.reverse();
            }
            ticks.push(...span_ticks);
        }

        if (span < span_count - 1) {
            const path_progress = (span + 1) % 2;
            repeats.push({
                pos: get_position_at_progress(path_progress),
                time: span_start_time + span_duration,
                repeat_index: span,
                path_progress
            });
        }
    }

    ticks.sort((a, b) => a.time - b.time);

    return { ticks, repeats };
};

const generate_ticks = (
    span_index: number,
    span_start_time: number,
    span_duration: number,
    reversed: boolean,
    length: number,
    tick_distance: number,
    min_distance_from_end: number,
    get_position_at_progress: (progress: number) => Vec2
): SliderTickEvent[] => {
    const ticks: SliderTickEvent[] = [];

    for (let d = tick_distance; d <= length; d += tick_distance) {
        if (d >= length - min_distance_from_end) break;

        const path_progress = d / length;
        const time_progress = reversed ? 1 - path_progress : path_progress;

        ticks.push({
            pos: get_position_at_progress(path_progress),
            time: span_start_time + time_progress * span_duration,
            span_index,
            path_progress
        });
    }

    return ticks;
};
