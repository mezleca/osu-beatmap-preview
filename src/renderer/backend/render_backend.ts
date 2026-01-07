export type LineCap = "butt" | "round" | "square";
export type LineJoin = "bevel" | "round" | "miter";
export type TextAlign = "left" | "right" | "center" | "start" | "end";
export type TextBaseline = "top" | "hanging" | "middle" | "alphabetic" | "ideographic" | "bottom";
export type CompositeOperation =
    | "source-over"
    | "source-in"
    | "source-out"
    | "source-atop"
    | "destination-over"
    | "destination-in"
    | "destination-out"
    | "destination-atop"
    | "lighter"
    | "copy"
    | "xor"
    | "multiply"
    | "screen"
    | "overlay"
    | "darken"
    | "lighten"
    | "color-dodge"
    | "color-burn"
    | "hard-light"
    | "soft-light"
    | "difference"
    | "exclusion"
    | "hue"
    | "saturation"
    | "color"
    | "luminosity";

export interface RenderImage {
    source: any;
    width: number;
    height: number;
    min_x?: number;
    min_y?: number;
}

export interface GradientStop {
    offset: number;
    color: string;
}

export interface IRenderBackend {
    initialize(container: any, use_high_dpi?: boolean): void;
    resize(width: number, height: number): void;
    clear(): void;
    dispose(): void;

    get width(): number;
    get height(): number;

    draw_circle(x: number, y: number, radius: number, fill_color: string, stroke_color?: string, stroke_width?: number): void;

    draw_arc(
        x: number,
        y: number,
        radius: number,
        start_angle: number,
        end_angle: number,
        stroke_color: string,
        stroke_width: number,
        ccw?: boolean
    ): void;

    draw_rect(x: number, y: number, width: number, height: number, fill_color: string): void;
    draw_rect_gradient(x: number, y: number, width: number, height: number, gradient: any): void;
    create_linear_gradient(x0: number, y0: number, x1: number, y1: number, stops: GradientStop[]): any;
    draw_text(text: string, x: number, y: number, font: string, fill_color: string, align?: TextAlign, baseline?: TextBaseline): void;
    begin_path(): void;
    move_to(x: number, y: number): void;
    line_to(x: number, y: number): void;
    bezier_curve_to(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
    quadratic_curve_to(cpx: number, cpy: number, x: number, y: number): void;
    arc_to(x: number, y: number, radius: number, start: number, end: number, ccw?: boolean): void;
    rect(x: number, y: number, width: number, height: number): void;
    clip(): void;
    stroke_path(color: string, width: number, cap?: LineCap, join?: LineJoin): void;
    fill_path(color: string): void;
    close_path(): void;
    save(): void;
    restore(): void;
    translate(x: number, y: number): void;
    scale(x: number, y: number): void;
    rotate(angle: number): void;
    set_alpha(alpha: number): void;
    set_shadow(color: string, blur: number): void;
    set_composite_operation(op: CompositeOperation): void;
    set_blend_mode(mode: "normal" | "lighter" | "multiply" | "screen"): void;
    draw_image(image: RenderImage, x: number, y: number, width?: number, height?: number): void;
    draw_image_part(image: RenderImage, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
    render_slider_to_image(
        path: [number, number][],
        radius: number,
        border_color: string,
        body_color: string,
        scale: number,
        body_opacity?: number,
        border_opacity?: number
    ): RenderImage | null;
}
