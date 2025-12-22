import type { IRenderBackend } from "./render_backend";

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

    initialize(canvas: HTMLCanvasElement, use_high_dpi: boolean = true): void {
        // high DPI support for sharper rendering
        this._dpr = use_high_dpi ? window.devicePixelRatio || 1 : 1;

        // set canvas size with DPI scaling
        const display_width = canvas.clientWidth || canvas.width;
        const display_height = canvas.clientHeight || canvas.height;

        canvas.width = display_width * this._dpr;
        canvas.height = display_height * this._dpr;

        const ctx = canvas.getContext("2d", {
            alpha: true,
            desynchronized: true // reduces latency
        });

        if (!ctx) {
            throw new Error("Failed to get 2D context");
        }

        this.ctx = ctx;
        this._width = display_width;
        this._height = display_height;

        // scale context for high DPI
        ctx.scale(this._dpr, this._dpr);

        // enable image smoothing for better anti-aliasing
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
        // nothing to dispose for Canvas 2D
    }

    resize(width: number, height: number): void {
        this._width = width;
        this._height = height;

        // update DPR in case it changed (e.g. monitor switch)
        this._dpr = window.devicePixelRatio || 1;

        const canvas = this.ctx.canvas;
        // set internal resolution (render buffer)
        canvas.width = width * this._dpr;
        canvas.height = height * this._dpr;

        // ensure display size matches logical size
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

    draw_text(
        text: string,
        x: number,
        y: number,
        font: string,
        fill_color: string,
        align: CanvasTextAlign = "left",
        baseline: CanvasTextBaseline = "alphabetic"
    ): void {
        const ctx = this.ctx;
        ctx.font = font;
        ctx.fillStyle = fill_color;
        ctx.textAlign = align;
        ctx.textBaseline = baseline;
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

    stroke_path(color: string, width: number, cap: CanvasLineCap = "butt", join: CanvasLineJoin = "miter"): void {
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

    set_composite_operation(op: GlobalCompositeOperation): void {
        this.ctx.globalCompositeOperation = op;
    }

    draw_image(image: CanvasImageSource, x: number, y: number, width?: number, height?: number): void {
        if (width !== undefined && height !== undefined) {
            this.ctx.drawImage(image, x, y, width, height);
        } else {
            this.ctx.drawImage(image, x, y);
        }
    }

    draw_image_part(image: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void {
        this.ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
    }
}
