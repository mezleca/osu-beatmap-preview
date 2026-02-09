import type { ITimingPoint } from "../../types/beatmap";
import { clamp } from "../../math/vector2";

export type TimingState = {
    base_beat_length: number;
    sv_multiplier: number;
};

export const process_timing_points = (points: ITimingPoint[]): ITimingPoint[] => {
    if (points.length === 0) {
        return points;
    }

    return points.sort((a, b) => {
        if (a.time !== b.time) return a.time - b.time;
        if (a.change === b.change) return 0;
        return a.change ? -1 : 1;
    });
};

export class TimingStateResolver {
    private points: ITimingPoint[];
    private index = 0;
    private last_time = Number.NEGATIVE_INFINITY;
    private base_beat_length = 600;
    private sv_multiplier = 1;

    constructor(points: ITimingPoint[]) {
        this.points = points;
        if (points.length > 0 && points[0].change && points[0].ms_per_beat > 0) {
            this.base_beat_length = points[0].ms_per_beat;
        }
    }

    reset(): void {
        this.index = 0;
        this.last_time = Number.NEGATIVE_INFINITY;
        this.base_beat_length = 600;
        this.sv_multiplier = 1;
    }

    get_state_at(time: number): TimingState {
        if (this.points.length === 0) {
            return { base_beat_length: 600, sv_multiplier: 1 };
        }

        if (time < this.last_time) {
            this.reset();
        }

        for (let i = this.index; i < this.points.length; i++) {
            const point = this.points[i];
            if (point.time > time) break;

            if (point.change && point.ms_per_beat > 0) {
                this.base_beat_length = point.ms_per_beat;
                this.sv_multiplier = 1;
            } else if (!point.change) {
                if (point.velocity > 0) {
                    this.sv_multiplier = point.velocity;
                }
            }

            this.index = i;
        }

        this.last_time = time;
        this.sv_multiplier = clamp(this.sv_multiplier, 0.1, 10);

        return {
            base_beat_length: this.base_beat_length,
            sv_multiplier: this.sv_multiplier
        };
    }
}
