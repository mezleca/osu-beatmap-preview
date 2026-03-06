import type { ITimingPoint } from "../types/beatmap";

export const process_timing_points = (points: ITimingPoint[]): ITimingPoint[] => {
    if (points.length === 0) {
        return points;
    }

    const indexed = points.map((point, index) => ({ point, index }));

    indexed.sort((a, b) => {
        if (a.point.time !== b.point.time) {
            return a.point.time - b.point.time;
        }

        if (a.point.uninherited !== b.point.uninherited) {
            return a.point.uninherited > b.point.uninherited ? -1 : 1;
        }

        return a.index - b.index;
    });

    for (let i = 0; i < points.length; i++) {
        points[i] = indexed[i].point;
    }

    return points;
};
