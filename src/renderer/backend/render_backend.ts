export interface IRenderBackend {
    initialize(canvas: HTMLCanvasElement, use_high_dpi?: boolean): void;
    resize(width: number, height: number): void;
    clear(): void;
    dispose(): void;

    // canvas dimensions
    get width(): number;
    get height(): number;

    // basic shapes
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

    draw_text(text: string, x: number, y: number, font: string, fill_color: string, align?: CanvasTextAlign, baseline?: CanvasTextBaseline): void;

    // path drawing (for sliders)
    begin_path(): void;
    move_to(x: number, y: number): void;
    line_to(x: number, y: number): void;
    bezier_curve_to(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
    quadratic_curve_to(cpx: number, cpy: number, x: number, y: number): void;
    arc_to(x: number, y: number, radius: number, start: number, end: number, ccw?: boolean): void;
    rect(x: number, y: number, width: number, height: number): void;
    clip(): void;
    stroke_path(color: string, width: number, cap?: CanvasLineCap, join?: CanvasLineJoin): void;
    fill_path(color: string): void;

    // transform stack
    save(): void;
    restore(): void;
    translate(x: number, y: number): void;
    scale(x: number, y: number): void;
    rotate(angle: number): void;

    // global state
    set_alpha(alpha: number): void;
    set_shadow(color: string, blur: number): void;
    set_composite_operation(op: GlobalCompositeOperation): void;

    draw_image(image: CanvasImageSource, x: number, y: number, width?: number, height?: number): void;

    draw_image_part(image: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
}
