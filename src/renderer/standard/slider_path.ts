import type { ISliderData } from "../../types/beatmap";
import { flatten_bezier, flatten_linear, flatten_perfect, flatten_catmull } from "../../math/curves";
import { vec2_len, vec2_sub, vec2_lerp, type Vec2 } from "../../math/vector2";

export const compute_slider_path = (slider: ISliderData): Vec2[] => {
    let points: Vec2[];

    if (slider.path_type === "L") {
        points = flatten_linear(slider.pos, slider.control_points[0], slider.distance);
    } else {
        const all_points: Vec2[] = [slider.pos, ...slider.control_points];

        switch (slider.path_type) {
            case "P":
                points = flatten_perfect(all_points, slider.distance);
                break;
            case "C":
                points = flatten_catmull(all_points);
                break;
            default:
                points = flatten_multibezier(all_points);
                break;
        }
    }

    return clamp_path_to_distance(points, slider.distance);
};

export const get_slider_end_position = (slider: ISliderData): Vec2 => {
    if (!slider.computed_path || slider.computed_path.length === 0) return slider.pos;
    return slider.repetitions % 2 === 0 ? slider.pos : slider.computed_path[slider.computed_path.length - 1];
};

const flatten_multibezier = (points: Vec2[]): Vec2[] => {
    const segments: Vec2[][] = [];
    let current: Vec2[] = [points[0]];

    for (let i = 1; i < points.length; i++) {
        const [prev, cur] = [points[i - 1], points[i]];

        if (prev[0] === cur[0] && prev[1] === cur[1]) {
            if (current.length > 1) segments.push(current);
            current = [cur];
        } else {
            current.push(cur);
        }
    }

    if (current.length > 1) segments.push(current);

    const all_points: Vec2[] = [];

    for (const segment of segments) {
        all_points.push(...flatten_bezier(segment));
    }

    return all_points;
};

const clamp_path_to_distance = (path: Vec2[], max_distance: number): Vec2[] => {
    if (path.length < 2) return path;
    const result: Vec2[] = [path[0]];
    let distance = 0;
    let last_dir: Vec2 | null = null;
    let reached_limit = false;

    for (let i = 1; i < path.length; i++) {
        const segment_length = vec2_len(vec2_sub(path[i], path[i - 1]));
        const dir = vec2_sub(path[i], path[i - 1]);
        if (segment_length > 0) {
            last_dir = [dir[0] / segment_length, dir[1] / segment_length];
        }

        if (segment_length === 0) {
            continue;
        }

        if (distance + segment_length >= max_distance) {
            const remaining = max_distance - distance;
            result.push(vec2_lerp(path[i - 1], path[i], remaining / segment_length));
            distance = max_distance;
            reached_limit = true;
            break;
        }

        distance += segment_length;
        result.push(path[i]);
    }

    if (!reached_limit && distance < max_distance && last_dir) {
        const remaining = max_distance - distance;
        const last_point = result[result.length - 1];
        result.push([last_point[0] + last_dir[0] * remaining, last_point[1] + last_dir[1] * remaining]);
    }
    return result;
};
