import type { ITimingPoint } from "../types/beatmap";

export const process_timing_points = (points: ITimingPoint[]): ITimingPoint[] => {
    if (points.length === 0) {
        return points;
    }

    return points.sort((a, b) => {
        if (a.time !== b.time) return a.time - b.time;
        if (a.uninherited === b.uninherited) return 0;
        return a.uninherited > b.uninherited ? -1 : 1;
    });
};
