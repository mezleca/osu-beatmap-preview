export type Vec2 = [number, number];

export const vec2_add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const vec2_sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const vec2_mul = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
export const vec2_div = (a: Vec2, s: number): Vec2 => [a[0] / s, a[1] / s];
export const vec2_dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
export const vec2_len = (v: Vec2): number => Math.sqrt(v[0] * v[0] + v[1] * v[1]);
export const vec2_len_sq = (v: Vec2): number => v[0] * v[0] + v[1] * v[1];
export const vec2_dist = (a: Vec2, b: Vec2): number => vec2_len(vec2_sub(a, b));
export const vec2_normalize = (v: Vec2): Vec2 => {
    const len = vec2_len(v);
    return len > 0 ? vec2_div(v, len) : [0, 0];
};

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const vec2_lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
export const clamp = (x: number, min: number, max: number): number => Math.min(max, Math.max(min, x));
