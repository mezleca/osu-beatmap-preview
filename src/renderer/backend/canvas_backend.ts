import type { IRenderBackend, GradientStop, RenderImage, LineCap, LineJoin, TextAlign, TextBaseline, CompositeOperation } from "./render_backend";

export class CanvasBackend implements IRenderBackend {
    private ctx!: CanvasRenderingContext2D;
    private _width: number = 0;
    private _height: number = 0;
    private _dpr: number = 1;

    get width(): number {
        return this._width;
    }
    get height(): number {
        return this._height;
    }

    initialize(container: HTMLCanvasElement, use_high_dpi: boolean = true): void {
        this._dpr = use_high_dpi ? window.devicePixelRatio || 1 : 1;

        const display_width = container.clientWidth || container.width;
        const display_height = container.clientHeight || container.height;

        container.width = display_width * this._dpr;
        container.height = display_height * this._dpr;

        const ctx = container.getContext("2d", {
            alpha: true,
            desynchronized: true
        });

        if (!ctx) {
            throw new Error("Failed to get 2D context");
        }

        this.ctx = ctx;
        this._width = display_width;
        this._height = display_height;

        ctx.scale(this._dpr, this._dpr);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
    }

    clear(): void {
        this.ctx.save();
        this.ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
        this.ctx.clearRect(0, 0, this._width, this._height);
        this.ctx.restore();
    }

    dispose(): void {
        // no-op for canvas
    }

    resize(width: number, height: number): void {
        this._width = width;
        this._height = height;
        this._dpr = window.devicePixelRatio || 1;

        const canvas = this.ctx.canvas;
        canvas.width = width * this._dpr;
        canvas.height = height * this._dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;

        this.ctx.resetTransform();
        this.ctx.scale(this._dpr, this._dpr);
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = "high";
    }

    draw_circle(x: number, y: number, radius: number, fill_color: string, stroke_color?: string, stroke_width?: number): void {
        const ctx = this.ctx;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);

        if (fill_color && fill_color !== "transparent") {
            ctx.fillStyle = fill_color;
            ctx.fill();
        }

        if (stroke_color && stroke_width && stroke_width > 0) {
            ctx.strokeStyle = stroke_color;
            ctx.lineWidth = stroke_width;
            ctx.stroke();
        }
    }

    draw_arc(
        x: number,
        y: number,
        radius: number,
        start_angle: number,
        end_angle: number,
        stroke_color: string,
        stroke_width: number,
        ccw: boolean = false
    ): void {
        const ctx = this.ctx;
        ctx.beginPath();
        ctx.arc(x, y, radius, start_angle, end_angle, ccw);
        ctx.strokeStyle = stroke_color;
        ctx.lineWidth = stroke_width;
        ctx.stroke();
    }

    draw_rect(x: number, y: number, width: number, height: number, fill_color: string): void {
        this.ctx.fillStyle = fill_color;
        this.ctx.fillRect(x, y, width, height);
    }

    draw_rect_gradient(x: number, y: number, width: number, height: number, gradient: any): void {
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(x, y, width, height);
    }

    create_linear_gradient(x0: number, y0: number, x1: number, y1: number, stops: GradientStop[]): any {
        const gradient = this.ctx.createLinearGradient(x0, y0, x1, y1);
        for (const stop of stops) {
            gradient.addColorStop(stop.offset, stop.color);
        }
        return gradient;
    }

    draw_text(
        text: string,
        x: number,
        y: number,
        font: string,
        fill_color: string,
        align: TextAlign = "left",
        baseline: TextBaseline = "alphabetic"
    ): void {
        const ctx = this.ctx;
        ctx.font = font;
        ctx.fillStyle = fill_color;
        ctx.textAlign = align as CanvasTextAlign;
        ctx.textBaseline = baseline as CanvasTextBaseline;
        ctx.fillText(text, x, y);
    }

    begin_path(): void {
        this.ctx.beginPath();
    }

    move_to(x: number, y: number): void {
        this.ctx.moveTo(x, y);
    }

    line_to(x: number, y: number): void {
        this.ctx.lineTo(x, y);
    }

    bezier_curve_to(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void {
        this.ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
    }

    quadratic_curve_to(cpx: number, cpy: number, x: number, y: number): void {
        this.ctx.quadraticCurveTo(cpx, cpy, x, y);
    }

    arc_to(x: number, y: number, radius: number, start: number, end: number, ccw?: boolean): void {
        this.ctx.arc(x, y, radius, start, end, ccw);
    }

    rect(x: number, y: number, width: number, height: number): void {
        this.ctx.rect(x, y, width, height);
    }

    clip(): void {
        this.ctx.clip();
    }

    stroke_path(color: string, width: number, cap: LineCap = "butt", join: LineJoin = "miter"): void {
        const ctx = this.ctx;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = cap;
        ctx.lineJoin = join;
        ctx.stroke();
    }

    fill_path(color: string): void {
        this.ctx.fillStyle = color;
        this.ctx.fill();
    }

    save(): void {
        this.ctx.save();
    }

    restore(): void {
        this.ctx.restore();
    }

    translate(x: number, y: number): void {
        this.ctx.translate(x, y);
    }

    scale(x: number, y: number): void {
        this.ctx.scale(x, y);
    }

    rotate(angle: number): void {
        this.ctx.rotate(angle);
    }

    set_alpha(alpha: number): void {
        this.ctx.globalAlpha = alpha;
    }

    set_shadow(color: string, blur: number): void {
        this.ctx.shadowColor = color;
        this.ctx.shadowBlur = blur;
    }

    set_composite_operation(op: CompositeOperation): void {
        this.ctx.globalCompositeOperation = op;
    }

    draw_image(image: RenderImage, x: number, y: number, width?: number, height?: number): void {
        if (width !== undefined && height !== undefined) {
            this.ctx.drawImage(image.source, x, y, width, height);
        } else {
            this.ctx.drawImage(image.source, x, y);
        }
    }

    draw_image_part(image: RenderImage, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
    draw_image_part(image: RenderImage, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void {
        this.ctx.drawImage(image.source, sx, sy, sw, sh, dx, dy, dw, dh);
    }

    render_slider_to_image(
        path: [number, number][],
        radius: number,
        border_color: string,
        body_color: string,
        scale: number,
        body_opacity: number = 1.0,
        border_opacity: number = 1.0
    ): RenderImage | null {
        let min_x = Infinity,
            min_y = Infinity,
            max_x = -Infinity,
            max_y = -Infinity;
        for (const p of path) {
            if (p[0] < min_x) min_x = p[0];
            if (p[0] > max_x) max_x = p[0];
            if (p[1] < min_y) min_y = p[1];
            if (p[1] > max_y) max_y = p[1];
        }

        const padding = radius + 2;
        min_x -= padding;
        min_y -= padding;
        max_x += padding;
        max_y += padding;

        const width = Math.ceil((max_x - min_x) * scale);
        const height = Math.ceil((max_y - min_y) * scale);

        if (width <= 0 || height <= 0) return null;

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;

        ctx.save();
        ctx.scale(scale, scale);
        ctx.translate(-min_x, -min_y);

        const draw_path = () => {
            ctx.beginPath();
            if (path.length > 0) {
                ctx.moveTo(path[0][0], path[0][1]);
                for (let i = 1; i < path.length; i++) {
                    ctx.lineTo(path[i][0], path[i][1]);
                }
            }
        };

        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        // draw full border
        ctx.globalAlpha = border_opacity;
        ctx.strokeStyle = border_color;
        ctx.lineWidth = radius * 2;
        draw_path();
        ctx.stroke();

        // if body is semi-transparent, we MUST mask out the center of the border
        // to prevent it from bleeding through the body
        const body_radius = radius * 0.872;
        if (body_opacity < 1.0) {
            ctx.globalCompositeOperation = "destination-out";
            ctx.globalAlpha = 1.0;
            ctx.lineWidth = body_radius * 2;
            draw_path();
            ctx.stroke();
            ctx.globalCompositeOperation = "source-over";
        }

        // draw body
        ctx.globalAlpha = body_opacity;
        ctx.strokeStyle = body_color;
        ctx.lineWidth = body_radius * 2;

        draw_path();

        ctx.stroke();
        ctx.restore();

        return {
            source: canvas,
            width,
            height,
            min_x,
            min_y
        };
    }
}
