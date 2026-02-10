import { type Vec2, vec2_add, vec2_sub, vec2_mul, vec2_len, vec2_lerp } from "./vector2";

export const flatten_bezier = (points: Vec2[], tolerance: number = 0.08): Vec2[] => {
    if (points.length < 2) return [...points];

    const result: Vec2[] = [];
    flatten_bezier_recursive(points, result, tolerance);
    return result;
};

const flatten_bezier_recursive = (points: Vec2[], output: Vec2[], tolerance: number): void => {
    if (is_flat_enough(points, tolerance)) {
        if (output.length === 0) {
            output.push(points[0]);
        }
        output.push(points[points.length - 1]);
        return;
    }

    const left: Vec2[] = [];
    const right: Vec2[] = [];
    subdivide_bezier(points, left, right);

    flatten_bezier_recursive(left, output, tolerance);
    flatten_bezier_recursive(right, output, tolerance);
};

const is_flat_enough = (points: Vec2[], tolerance: number): boolean => {
    if (points.length <= 2) return true;

    // check if all middle points are close enough to the line from first to last
    const start = points[0];
    const end = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
        if (point_to_line_dist(points[i], start, end) > tolerance) {
            return false;
        }
    }
    return true;
};

const point_to_line_dist = (point: Vec2, line_start: Vec2, line_end: Vec2): number => {
    const line = vec2_sub(line_end, line_start);
    const len_sq = line[0] * line[0] + line[1] * line[1];

    if (len_sq === 0) return vec2_len(vec2_sub(point, line_start));

    const t = Math.max(0, Math.min(1, ((point[0] - line_start[0]) * line[0] + (point[1] - line_start[1]) * line[1]) / len_sq));

    const proj: Vec2 = [line_start[0] + t * line[0], line_start[1] + t * line[1]];

    return vec2_len(vec2_sub(point, proj));
};

const subdivide_bezier = (points: Vec2[], left: Vec2[], right: Vec2[]): void => {
    const n = points.length;
    const midpoints: Vec2[][] = [points];

    for (let i = 1; i < n; i++) {
        midpoints[i] = [];
        for (let j = 0; j < n - i; j++) {
            midpoints[i][j] = vec2_lerp(midpoints[i - 1][j], midpoints[i - 1][j + 1], 0.5);
        }
    }

    for (let i = 0; i < n; i++) {
        left.push(midpoints[i][0]);
        right.push(midpoints[n - 1 - i][i]);
    }
};

export const flatten_linear = (start: Vec2, end: Vec2, distance: number): Vec2[] => {
    const dir = vec2_sub(end, start);
    const len = vec2_len(dir);

    if (len === 0) return [start];

    const normalized: Vec2 = [dir[0] / len, dir[1] / len];
    const actual_end: Vec2 = vec2_add(start, vec2_mul(normalized, distance));

    return [start, actual_end];
};

export const flatten_perfect = (points: Vec2[], distance: number): Vec2[] => {
    if (points.length !== 3) {
        // fallback to bezier if not exactly 3 points
        return flatten_bezier(points);
    }

    const [a, b, c] = points;

    // find circle center using 3 points
    const center = find_circle_center(a, b, c);
    if (!center) {
        // points are collinear, treat as linear
        return flatten_linear(a, c, distance);
    }

    const radius = vec2_len(vec2_sub(a, center));
    const start_angle = Math.atan2(a[1] - center[1], a[0] - center[0]);
    const end_angle = Math.atan2(c[1] - center[1], c[0] - center[0]);

    // determine direction (clockwise or counter-clockwise)
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const ccw = cross > 0;

    // calculate arc length and clamp to distance
    let arc_angle = end_angle - start_angle;
    if (ccw && arc_angle < 0) arc_angle += 2 * Math.PI;
    if (!ccw && arc_angle > 0) arc_angle -= 2 * Math.PI;

    const arc_length = Math.abs(arc_angle) * radius;

    // match osu! arc approximation (max error ~= 0.1)
    let num_points = 2;
    if (radius * 2 > 0.1) {
        const theta_range = Math.abs(arc_angle);
        const step = 2 * Math.acos(1 - 0.1 / radius);
        num_points = Math.max(2, Math.ceil(theta_range / step));
        if (num_points >= 1000) {
            num_points = 1000;
        }
    }
    const result: Vec2[] = [];

    for (let i = 0; i <= num_points; i++) {
        const t = i / num_points;
        const angle = start_angle + arc_angle * t;
        result.push([center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)]);
    }

    return result;
};

const find_circle_center = (a: Vec2, b: Vec2, c: Vec2): Vec2 | null => {
    const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));

    if (Math.abs(d) < 0.001) return null; // collinear

    const ux =
        ((a[0] * a[0] + a[1] * a[1]) * (b[1] - c[1]) + (b[0] * b[0] + b[1] * b[1]) * (c[1] - a[1]) + (c[0] * c[0] + c[1] * c[1]) * (a[1] - b[1])) / d;
    const uy =
        ((a[0] * a[0] + a[1] * a[1]) * (c[0] - b[0]) + (b[0] * b[0] + b[1] * b[1]) * (a[0] - c[0]) + (c[0] * c[0] + c[1] * c[1]) * (b[0] - a[0])) / d;

    return [ux, uy];
};

export const flatten_catmull = (points: Vec2[]): Vec2[] => {
    if (points.length < 2) return [...points];

    const result: Vec2[] = [];

    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(0, i - 1)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(points.length - 1, i + 2)];

        const segment_length = vec2_len(vec2_sub(p2, p1));
        const segments = Math.max(8, Math.ceil(segment_length / 3));
        for (let j = 0; j <= segments; j++) {
            const t = j / segments;
            result.push(catmull_point(p0, p1, p2, p3, t));
        }
    }

    return result;
};

const catmull_point = (p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 => {
    const t2 = t * t;
    const t3 = t2 * t;

    return [
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
    ];
};
