import { Application, Container, Graphics, Matrix, Rectangle, Sprite, Texture, TextureStyle, type ICanvas } from "pixi.js";
import type { BLEND_MODES } from "pixi.js";
import type { CompositeOperation, GradientStop, IRenderBackend, LineCap, LineJoin, RenderImage, TextAlign, TextBaseline } from "./render_backend";
import { LruCache } from "../../utils/lru";

type PathCommand =
    | { type: "move"; x: number; y: number }
    | { type: "line"; x: number; y: number }
    | { type: "arc"; x: number; y: number; radius: number; start: number; end: number; ccw: boolean }
    | { type: "rect"; x: number; y: number; width: number; height: number }
    | { type: "close" };

type BackendState = {
    matrix: Matrix;
    alpha: number;
    blend_mode: BLEND_MODES;
    container: Container;
    path: PathCommand[];
};

type LinearGradient = {
    type: "linear_gradient";
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    stops: GradientStop[];
};

type ParsedColor = {
    color: number;
    alpha: number;
};

type CachedTextTexture = {
    texture: Texture;
    width: number;
    height: number;
    ascent: number;
    descent: number;
    resolution: number;
};

const DEFAULT_COLOR: ParsedColor = { color: 0xffffff, alpha: 1 };
const MAX_GRADIENT_CACHE_ENTRIES = 128;
const MAX_TEXT_CACHE_ENTRIES = 192;

export class PixiBackend implements IRenderBackend {
    private app: Application | null = null;
    private root: Container | null = null;
    private state!: BackendState;
    private stack: BackendState[] = [];
    private texture_cache: Map<any, Texture> = new Map();
    private gradient_texture_cache = new LruCache<number, Texture>(MAX_GRADIENT_CACHE_ENTRIES, (_key, texture) => {
        texture.destroy(true);
    });
    private text_texture_cache = new LruCache<string, CachedTextTexture>(MAX_TEXT_CACHE_ENTRIES, (_key, entry) => {
        if (entry.texture !== Texture.WHITE) {
            entry.texture.destroy(true);
        }
    });
    private _width = 0;
    private _height = 0;
    private _dpr = 1;
    private is_initialized = false;
    private context_lost_listener: ((event: Event) => void) | null = null;
    private context_restored_listener: (() => void) | null = null;
    private sprite_pool: Sprite[] = [];
    private sprite_pool_index = 0;
    private graphics_pool: Graphics[] = [];
    private graphics_pool_index = 0;
    private container_pool: Container[] = [];
    private container_pool_index = 0;

    get width(): number {
        return this._width;
    }

    get height(): number {
        return this._height;
    }

    async initialize(container: HTMLCanvasElement, use_high_dpi: boolean = true): Promise<void> {
        this.dispose();

        this.ensure_sprite_texture_limit();

        this._dpr = use_high_dpi ? window.devicePixelRatio || 1 : 1;
        const display_width = container.clientWidth || container.width;
        const display_height = container.clientHeight || container.height;

        const app = new Application();
        await app.init({
            canvas: container as unknown as ICanvas,
            width: display_width,
            height: display_height,
            backgroundAlpha: 0,
            antialias: true,
            autoDensity: true,
            resolution: this._dpr,
            clearBeforeRender: true
        });
        app.ticker.stop();
        this.app = app;
        TextureStyle.defaultOptions.scaleMode = "linear";

        const view = this.app.canvas as HTMLCanvasElement;
        this.context_lost_listener = (event: Event): void => {
            event.preventDefault();
        };
        this.context_restored_listener = (): void => {
            this.ensure_sprite_texture_limit();
        };
        view.addEventListener("webglcontextlost", this.context_lost_listener, { passive: false });
        view.addEventListener("webglcontextrestored", this.context_restored_listener);

        this.root = new Container();
        this.app.stage.addChild(this.root);

        this._width = display_width;
        this._height = display_height;
        this.reset_state();
        this.is_initialized = true;
    }

    begin_frame(): void {
        this.clear();
    }

    end_frame(): void {
        if (!this.app) {
            return;
        }

        this.app.renderer.render(this.app.stage);
    }

    clear(): void {
        if (!this.root) {
            return;
        }

        this.root.removeChildren();
        this.sprite_pool_index = 0;
        this.graphics_pool_index = 0;
        this.container_pool_index = 0;

        this.reset_state();
    }

    resize(width: number, height: number): void {
        if (!this.app) {
            return;
        }

        this._width = width;
        this._height = height;
        this._dpr = window.devicePixelRatio || 1;
        this.app.renderer.resolution = this._dpr;
        this.app.renderer.resize(width, height);
    }

    dispose(): void {
        this.clear_texture_caches();

        if (this.app) {
            const view = this.app.canvas as HTMLCanvasElement;
            if (this.context_lost_listener) {
                view.removeEventListener("webglcontextlost", this.context_lost_listener);
            }
            if (this.context_restored_listener) {
                view.removeEventListener("webglcontextrestored", this.context_restored_listener);
            }
            this.app.destroy(false, { children: true, texture: true, textureSource: true });
            this.app = null;
        }

        this.root = null;
        this.stack = [];
        this.is_initialized = false;
        this.context_lost_listener = null;
        this.context_restored_listener = null;
        for (let i = 0; i < this.sprite_pool.length; i++) {
            this.sprite_pool[i].destroy();
        }
        this.sprite_pool.length = 0;
        this.sprite_pool_index = 0;
        for (let i = 0; i < this.graphics_pool.length; i++) {
            this.graphics_pool[i].destroy({ context: true });
        }
        this.graphics_pool.length = 0;
        this.graphics_pool_index = 0;
        for (let i = 0; i < this.container_pool.length; i++) {
            this.container_pool[i].destroy({ children: true });
        }
        this.container_pool.length = 0;
        this.container_pool_index = 0;
    }

    draw_circle(x: number, y: number, radius: number, fill_color: string, stroke_color?: string, stroke_width?: number): void {
        const g = this.make_graphics();
        const fill = parse_color(fill_color);
        const stroke = parse_color(stroke_color);

        g.circle(x, y, radius);

        if (fill_color && fill_color !== "transparent" && fill.alpha > 0) {
            g.fill({ color: fill.color, alpha: fill.alpha * this.state.alpha });
        }

        if (stroke_color && stroke_width && stroke_width > 0 && stroke.alpha > 0) {
            g.stroke({
                width: stroke_width,
                color: stroke.color,
                alpha: stroke.alpha * this.state.alpha
            });
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
        const g = this.make_graphics();
        const stroke = parse_color(stroke_color);
        g.arc(x, y, radius, start_angle, end_angle, ccw);
        g.stroke({
            width: stroke_width,
            color: stroke.color,
            alpha: stroke.alpha * this.state.alpha
        });
    }

    draw_rect(x: number, y: number, width: number, height: number, fill_color: string): void {
        const g = this.make_graphics();
        const fill = parse_color(fill_color);
        g.rect(x, y, width, height);
        g.fill({ color: fill.color, alpha: fill.alpha * this.state.alpha });
    }

    draw_rect_gradient(x: number, y: number, width: number, height: number, gradient: LinearGradient): void {
        const texture = this.get_or_create_gradient_texture(x, y, width, height, gradient);
        const sprite = this.get_sprite(texture);
        sprite.alpha = this.state.alpha;
        sprite.blendMode = this.state.blend_mode;
        sprite.setFromMatrix(this.compose_matrix(x, y, width / texture.width, height / texture.height));
        this.state.container.addChild(sprite);
    }

    create_linear_gradient(x0: number, y0: number, x1: number, y1: number, stops: GradientStop[]): LinearGradient {
        return { type: "linear_gradient", x0, y0, x1, y1, stops };
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
        const fill = parse_color(fill_color);
        const cached = this.get_or_create_text_texture(text, font, fill);
        const sprite = this.get_sprite(cached.texture);
        sprite.alpha = fill.alpha * this.state.alpha;
        sprite.blendMode = this.state.blend_mode;
        let anchor_x = 0;
        switch (align) {
            case "center":
                anchor_x = 0.5;
                break;
            case "right":
            case "end":
                anchor_x = 1;
                break;
            default:
                anchor_x = 0;
                break;
        }

        let anchor_y = 0;
        switch (baseline) {
            case "top":
            case "hanging":
                anchor_y = 0;
                break;
            case "middle":
                anchor_y = 0.5;
                break;
            case "bottom":
            case "ideographic":
                anchor_y = 1;
                break;
            default:
                anchor_y = cached.ascent / Math.max(1, cached.height);
                break;
        }

        sprite.anchor.set(anchor_x, anchor_y);
        sprite.setFromMatrix(this.compose_matrix(x, y, 1 / cached.resolution, 1 / cached.resolution));
        this.state.container.addChild(sprite);
    }

    begin_path(): void {
        this.state.path = [];
    }

    move_to(x: number, y: number): void {
        this.state.path.push({ type: "move", x, y });
    }

    line_to(x: number, y: number): void {
        this.state.path.push({ type: "line", x, y });
    }

    draw_line(x0: number, y0: number, x1: number, y1: number, color: string, width: number): void {
        const g = this.make_graphics();
        const stroke = parse_color(color);
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke({
            width,
            color: stroke.color,
            alpha: stroke.alpha * this.state.alpha
        });
    }

    bezier_curve_to(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void {
        const steps = 24;
        const last = this.get_last_path_point();
        if (!last) {
            return;
        }

        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const mt = 1 - t;
            const px = mt * mt * mt * last.x + 3 * mt * mt * t * cp1x + 3 * mt * t * t * cp2x + t * t * t * x;
            const py = mt * mt * mt * last.y + 3 * mt * mt * t * cp1y + 3 * mt * t * t * cp2y + t * t * t * y;
            this.state.path.push({ type: "line", x: px, y: py });
        }
    }

    quadratic_curve_to(cpx: number, cpy: number, x: number, y: number): void {
        const steps = 20;
        const last = this.get_last_path_point();
        if (!last) {
            return;
        }

        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const mt = 1 - t;
            const px = mt * mt * last.x + 2 * mt * t * cpx + t * t * x;
            const py = mt * mt * last.y + 2 * mt * t * cpy + t * t * y;
            this.state.path.push({ type: "line", x: px, y: py });
        }
    }

    arc_to(x: number, y: number, radius: number, start: number, end: number, ccw: boolean = false): void {
        this.state.path.push({ type: "arc", x, y, radius, start, end, ccw });
    }

    rect(x: number, y: number, width: number, height: number): void {
        this.state.path.push({ type: "rect", x, y, width, height });
    }

    clip(): void {
        if (!this.root || this.state.path.length === 0) {
            return;
        }

        const mask = this.make_graphics();
        this.apply_path(mask, this.state.path);
        const clip_container = this.get_container();
        clip_container.mask = mask;
        this.state.container.addChild(mask);
        this.state.container.addChild(clip_container);
        this.state.container = clip_container;
        this.state.path = [];
    }

    stroke_path(color: string, width: number, _cap: LineCap = "butt", _join: LineJoin = "miter"): void {
        const g = this.make_graphics();
        const stroke = parse_color(color);
        this.apply_path(g, this.state.path);
        g.stroke({
            width,
            color: stroke.color,
            alpha: stroke.alpha * this.state.alpha
        });
    }

    fill_path(color: string): void {
        const g = this.make_graphics();
        const fill = parse_color(color);
        this.apply_path(g, this.state.path);
        g.fill({ color: fill.color, alpha: fill.alpha * this.state.alpha });
    }

    close_path(): void {
        this.state.path.push({ type: "close" });
    }

    save(): void {
        this.stack.push({
            matrix: this.state.matrix.clone(),
            alpha: this.state.alpha,
            blend_mode: this.state.blend_mode,
            container: this.state.container,
            path: this.state.path.slice()
        });
    }

    restore(): void {
        const prev = this.stack.pop();
        if (!prev) {
            return;
        }

        this.state = prev;
    }

    translate(x: number, y: number): void {
        const t = new Matrix();
        t.translate(x, y);
        this.state.matrix.append(t);
    }

    scale(x: number, y: number): void {
        const s = new Matrix();
        s.scale(x, y);
        this.state.matrix.append(s);
    }

    rotate(angle: number): void {
        const r = new Matrix();
        r.rotate(angle);
        this.state.matrix.append(r);
    }

    set_alpha(alpha: number): void {
        this.state.alpha = alpha;
    }

    set_shadow(_color: string, _blur: number): void {}

    set_composite_operation(op: CompositeOperation): void {
        this.state.blend_mode = composite_to_blend(op);
    }

    set_blend_mode(mode: "normal" | "lighter" | "multiply" | "screen"): void {
        switch (mode) {
            case "lighter":
                this.state.blend_mode = "add";
                return;
            case "multiply":
                this.state.blend_mode = "multiply";
                return;
            case "screen":
                this.state.blend_mode = "screen";
                return;
            default:
                this.state.blend_mode = "normal";
                return;
        }
    }

    draw_image(image: RenderImage, x: number, y: number, width?: number, height?: number, tint_color?: string): void {
        const texture = this.get_texture(image.source);
        if (!texture) {
            return;
        }

        const sprite = this.get_sprite(texture);
        sprite.alpha = this.state.alpha;
        sprite.blendMode = this.state.blend_mode;

        if (tint_color) {
            const tint = parse_color(tint_color);
            sprite.tint = tint.color;
            sprite.alpha *= tint.alpha;
        }

        const target_width = width ?? image.width ?? texture.width;
        const target_height = height ?? image.height ?? texture.height;
        const scale_x = target_width / Math.max(1, texture.width);
        const scale_y = target_height / Math.max(1, texture.height);
        sprite.setFromMatrix(this.compose_matrix(x, y, scale_x, scale_y));
        this.state.container.addChild(sprite);
    }

    draw_image_part(image: RenderImage, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void {
        const texture = this.get_texture(image.source);
        if (!texture) {
            return;
        }

        const part = new Texture({
            source: texture.source,
            frame: new Rectangle(sx, sy, sw, sh)
        });
        const sprite = this.get_sprite(part);
        sprite.alpha = this.state.alpha;
        sprite.blendMode = this.state.blend_mode;
        sprite.setFromMatrix(this.compose_matrix(dx, dy, dw / Math.max(1, sw), dh / Math.max(1, sh)));
        this.state.container.addChild(sprite);
    }

    render_slider_to_image(
        path: [number, number][],
        radius: number,
        border_color: string,
        body_color: string,
        scale: number,
        body_opacity: number = 1.0,
        border_opacity: number = 1.0,
        body_texture: RenderImage | null = null
    ): RenderImage | null {
        if (!this.app || path.length < 2) {
            return null;
        }

        const simplified_path = sanitize_slider_path(path);
        if (simplified_path.length < 2) {
            return null;
        }
        const raster_path = simplify_slider_path_for_raster(simplified_path, Math.max(0.02, radius * 0.001));

        let min_x = Infinity;
        let min_y = Infinity;
        let max_x = -Infinity;
        let max_y = -Infinity;
        for (let i = 0; i < raster_path.length; i++) {
            const p = raster_path[i];
            if (p[0] < min_x) min_x = p[0];
            if (p[0] > max_x) max_x = p[0];
            if (p[1] < min_y) min_y = p[1];
            if (p[1] > max_y) max_y = p[1];
        }

        const slider_width_scale = 1.0;
        const padding = radius * slider_width_scale + 2;
        min_x -= padding;
        min_y -= padding;
        max_x += padding;
        max_y += padding;

        const pixel_width = Math.ceil((max_x - min_x) * scale);
        const pixel_height = Math.ceil((max_y - min_y) * scale);
        if (pixel_width <= 0 || pixel_height <= 0) {
            return null;
        }

        const offset_x = -min_x;
        const offset_y = -min_y;

        const border = parse_color(border_color);
        const body = parse_color(body_color);
        const body_radius = radius * 0.9;
        const texture = this.render_slider_canvas_fallback(
            raster_path,
            offset_x,
            offset_y,
            radius * slider_width_scale,
            body_radius,
            border,
            body,
            scale,
            body_opacity,
            border_opacity,
            body_texture,
            pixel_width,
            pixel_height
        );

        return {
            source: texture,
            width: pixel_width,
            height: pixel_height,
            min_x,
            min_y
        };
    }

    private render_slider_canvas_fallback(
        path: [number, number][],
        offset_x: number,
        offset_y: number,
        radius: number,
        body_radius: number,
        border: ParsedColor,
        body: ParsedColor,
        scale: number,
        body_opacity: number,
        border_opacity: number,
        body_texture: RenderImage | null,
        pixel_width: number,
        pixel_height: number
    ): Texture {
        const width = Math.max(1, pixel_width);
        const height = Math.max(1, pixel_height);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            return Texture.WHITE;
        }

        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.scale(scale, scale);
        ctx.translate(offset_x, offset_y);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        const path2d = create_path2d(path);
        const stroke_path = (): void => {
            if (path2d) {
                ctx.stroke(path2d);
                return;
            }
            ctx.beginPath();
            ctx.moveTo(path[0][0], path[0][1]);
            for (let i = 1; i < path.length; i++) {
                ctx.lineTo(path[i][0], path[i][1]);
            }
            ctx.stroke();
        };

        const accent: ParsedColor = { color: body.color, alpha: 0.5 * body_opacity };
        const border_colour: ParsedColor = { color: border.color, alpha: border.alpha * border_opacity };
        const shadow: ParsedColor = { color: 0x000000, alpha: 0.25 * border_opacity };
        const outer_colour = darken_legacy(accent, 0.1);
        const inner_colour = lighten_legacy(accent, 0.22);

        const shadow_portion = 0.078125;
        const border_portion = 0.1875;

        const colour_at = (position: number): ParsedColor => {
            const p = clamp_unit(position);

            if (p <= shadow_portion) {
                return mix_color({ color: 0x000000, alpha: 0 }, shadow, p / Math.max(1e-6, shadow_portion));
            }

            if (p <= border_portion) {
                return border_colour;
            }

            const t = (p - border_portion) / Math.max(1e-6, 1 - border_portion);
            const biased_t = Math.pow(clamp_unit(t), 1.35);
            return mix_color(outer_colour, inner_colour, biased_t);
        };

        const path_complexity = Math.max(1, Math.floor(path.length / 140));
        const steps = Math.max(52, Math.min(76, Math.floor(72 / path_complexity)));
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const width = radius * 2 * t;
            const position = 1 - t;
            const color = colour_at(position);

            ctx.strokeStyle = to_canvas_rgba(color);
            ctx.lineWidth = Math.max(0.5, width);
            stroke_path();
            if (i === 1) {
                ctx.globalCompositeOperation = "destination-over";
            }
        }
        ctx.globalCompositeOperation = "source-over";
        ctx.restore();
        return Texture.from(canvas);
    }

    private reset_state(): void {
        if (!this.root) {
            return;
        }

        this.state = {
            matrix: new Matrix(),
            alpha: 1,
            blend_mode: "normal",
            container: this.root,
            path: []
        };
        this.stack = [];
    }

    private make_graphics(): Graphics {
        const g = this.get_graphics();
        g.blendMode = this.state.blend_mode;
        g.setFromMatrix(this.state.matrix);
        this.state.container.addChild(g);
        return g;
    }

    private get_sprite(texture: Texture): Sprite {
        let sprite = this.sprite_pool[this.sprite_pool_index];
        if (!sprite) {
            sprite = new Sprite(texture);
            this.sprite_pool.push(sprite);
        } else {
            sprite.texture = texture;
            sprite.tint = 0xffffff;
            sprite.alpha = 1;
        }
        sprite.anchor.set(0, 0);

        this.sprite_pool_index += 1;
        return sprite;
    }

    private get_graphics(): Graphics {
        let graphics = this.graphics_pool[this.graphics_pool_index];
        if (!graphics) {
            graphics = new Graphics();
            this.graphics_pool.push(graphics);
        } else {
            graphics.clear();
            graphics.alpha = 1;
            graphics.tint = 0xffffff;
        }

        this.graphics_pool_index += 1;
        return graphics;
    }

    private get_container(): Container {
        let container = this.container_pool[this.container_pool_index];
        if (!container) {
            container = new Container();
            this.container_pool.push(container);
        } else {
            container.removeChildren();
            container.mask = null;
            container.alpha = 1;
        }

        this.container_pool_index += 1;
        return container;
    }

    private apply_path(g: Graphics, path: PathCommand[]): void {
        for (let i = 0; i < path.length; i++) {
            const command = path[i];
            switch (command.type) {
                case "move":
                    g.moveTo(command.x, command.y);
                    break;
                case "line":
                    g.lineTo(command.x, command.y);
                    break;
                case "arc":
                    g.arc(command.x, command.y, command.radius, command.start, command.end, command.ccw);
                    break;
                case "rect":
                    g.rect(command.x, command.y, command.width, command.height);
                    break;
                case "close":
                    g.closePath();
                    break;
            }
        }
    }

    private compose_matrix(x: number, y: number, scale_x: number = 1, scale_y: number = 1): Matrix {
        const m = this.state.matrix.clone();
        const t = new Matrix();
        t.translate(x, y);
        m.append(t);

        if (scale_x !== 1 || scale_y !== 1) {
            const s = new Matrix();
            s.scale(scale_x, scale_y);
            m.append(s);
        }

        return m;
    }

    private get_last_path_point(): { x: number; y: number } | null {
        for (let i = this.state.path.length - 1; i >= 0; i--) {
            const command = this.state.path[i];
            if (command.type === "move" || command.type === "line") {
                return { x: command.x, y: command.y };
            }
        }

        return null;
    }

    private get_texture(source: any): Texture | null {
        if (!source) {
            return null;
        }

        if (source instanceof Texture) {
            return source;
        }

        const cached = this.texture_cache.get(source);
        if (cached) {
            return cached;
        }

        const texture = Texture.from(source);
        this.texture_cache.set(source, texture);
        return texture;
    }

    private get_or_create_gradient_texture(x: number, y: number, width: number, height: number, gradient: LinearGradient): Texture {
        const key = make_gradient_cache_key(x, y, width, height, gradient);
        const cached = this.gradient_texture_cache.get(key);
        if (cached) {
            return cached;
        }

        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.ceil(width));
        canvas.height = Math.max(1, Math.ceil(height));
        const ctx = canvas.getContext("2d");

        if (!ctx) {
            const texture = Texture.WHITE;
            return texture;
        }

        const g = ctx.createLinearGradient(gradient.x0 - x, gradient.y0 - y, gradient.x1 - x, gradient.y1 - y);
        for (let i = 0; i < gradient.stops.length; i++) {
            g.addColorStop(gradient.stops[i].offset, gradient.stops[i].color);
        }
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const texture = Texture.from(canvas);
        this.gradient_texture_cache.set(key, texture);
        return texture;
    }

    private get_or_create_text_texture(text: string, font: string, fill: ParsedColor): CachedTextTexture {
        const key = `${text}|${font}|${fill.color}`;
        const cached = this.text_texture_cache.get(key);
        if (cached) {
            return cached;
        }

        const font_info = parse_font(font);
        const resolution = Math.min(6, Math.max(2, this._dpr * 3));
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            return {
                texture: Texture.WHITE,
                width: 1,
                height: 1,
                ascent: 1,
                descent: 0,
                resolution: 1
            };
        }

        ctx.font = font_info.css;
        const metrics = ctx.measureText(text);
        const text_width = Math.max(1, Math.ceil(metrics.width || font_info.size));
        const ascent = Math.max(1, Math.ceil(metrics.actualBoundingBoxAscent || font_info.size * 0.8));
        const descent = Math.max(0, Math.ceil(metrics.actualBoundingBoxDescent || font_info.size * 0.2));
        const text_height = Math.max(1, ascent + descent);
        const padding = Math.max(2, Math.ceil(font_info.size * 0.25));
        const logical_width = text_width + padding * 2;
        const logical_height = text_height + padding * 2;

        canvas.width = Math.ceil(logical_width * resolution);
        canvas.height = Math.ceil(logical_height * resolution);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.scale(resolution, resolution);
        ctx.font = font_info.css;
        ctx.fillStyle = to_canvas_rgba(fill);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, logical_width / 2, logical_height / 2);

        const texture = Texture.from(canvas);
        const result: CachedTextTexture = {
            texture,
            width: logical_width,
            height: logical_height,
            ascent: logical_height / 2,
            descent: logical_height / 2,
            resolution
        };
        this.text_texture_cache.set(key, result);
        return result;
    }

    private clear_texture_caches(): void {
        for (const texture of this.texture_cache.values()) {
            if (texture === Texture.WHITE) {
                continue;
            }
            texture.destroy(true);
        }
        this.texture_cache.clear();

        this.gradient_texture_cache.clear();
        this.text_texture_cache.clear();
    }

    private ensure_sprite_texture_limit(): void {}
}

const parse_font = (font: string): { css: string; size: number } => {
    const parts = font.trim().split(/\s+/);
    let size = 14;
    let weight = "normal";
    let size_index = -1;

    for (let i = 0; i < parts.length; i++) {
        if (parts[i].endsWith("px")) {
            size = Number.parseFloat(parts[i].replace("px", ""));
            size_index = i;
            break;
        }
    }

    if (size_index > 0) {
        weight = parts[size_index - 1];
    }

    const family = size_index >= 0 ? parts.slice(size_index + 1).join(" ") : '"Trebuchet MS", Verdana, Arial, sans-serif';
    const css = `${weight} ${Number.isFinite(size) ? size : 14}px ${family || '"Trebuchet MS", Verdana, Arial, sans-serif'}`;
    return { css, size: Number.isFinite(size) ? size : 14 };
};

const parse_color = (input?: string): ParsedColor => {
    if (!input || input === "transparent") {
        return { color: 0xffffff, alpha: 0 };
    }

    const color = input.trim().toLowerCase();
    if (color.startsWith("#")) {
        const raw = color.slice(1);
        if (raw.length === 3) {
            const r = Number.parseInt(raw[0] + raw[0], 16);
            const g = Number.parseInt(raw[1] + raw[1], 16);
            const b = Number.parseInt(raw[2] + raw[2], 16);
            return { color: (r << 16) | (g << 8) | b, alpha: 1 };
        }
        if (raw.length === 6 || raw.length === 8) {
            const value = Number.parseInt(raw.slice(0, 6), 16);
            if (raw.length === 8) {
                const alpha = Number.parseInt(raw.slice(6, 8), 16) / 255;
                return { color: value, alpha };
            }
            return { color: value, alpha: 1 };
        }
    }

    const rgba = color.match(/^rgba?\(([^)]+)\)$/);
    if (rgba) {
        const parts = rgba[1].split(",").map((p) => p.trim());
        if (parts.length >= 3) {
            const r = clamp_byte(Number.parseFloat(parts[0]));
            const g = clamp_byte(Number.parseFloat(parts[1]));
            const b = clamp_byte(Number.parseFloat(parts[2]));
            const alpha = parts.length >= 4 ? clamp_unit(Number.parseFloat(parts[3])) : 1;
            return { color: (r << 16) | (g << 8) | b, alpha };
        }
    }

    if (color === "white") return { color: 0xffffff, alpha: 1 };
    if (color === "black") return { color: 0x000000, alpha: 1 };
    return DEFAULT_COLOR;
};

const to_canvas_rgba = (color: ParsedColor): string => {
    const r = (color.color >> 16) & 0xff;
    const g = (color.color >> 8) & 0xff;
    const b = color.color & 0xff;
    return `rgba(${r},${g},${b},${color.alpha})`;
};

const sanitize_slider_path = (path: [number, number][]): [number, number][] => {
    if (path.length <= 2) {
        return path;
    }

    const out: [number, number][] = [path[0]];
    const min_distance_sq = 0.000001 * 0.000001;

    for (let i = 1; i < path.length; i++) {
        const prev = out[out.length - 1];
        const curr = path[i];
        const dx = curr[0] - prev[0];
        const dy = curr[1] - prev[1];
        if (dx * dx + dy * dy <= min_distance_sq) {
            continue;
        }
        out.push(curr);
    }

    if (out.length < 2) {
        return [path[0], path[path.length - 1]];
    }

    return out;
};

const simplify_slider_path_for_raster = (path: [number, number][], min_distance: number): [number, number][] => {
    if (path.length <= 2) {
        return path;
    }

    const out: [number, number][] = [path[0]];
    const min_distance_sq = min_distance * min_distance;

    for (let i = 1; i < path.length - 1; i++) {
        const prev = out[out.length - 1];
        const curr = path[i];
        const next = path[i + 1];

        const dx = curr[0] - prev[0];
        const dy = curr[1] - prev[1];
        const dist_sq = dx * dx + dy * dy;
        if (dist_sq < min_distance_sq) {
            continue;
        }

        const v1x = curr[0] - prev[0];
        const v1y = curr[1] - prev[1];
        const v2x = next[0] - curr[0];
        const v2y = next[1] - curr[1];
        const l1 = Math.hypot(v1x, v1y);
        const l2 = Math.hypot(v2x, v2y);

        if (l1 > 0 && l2 > 0) {
            const dot = (v1x * v2x + v1y * v2y) / (l1 * l2);
            if (dot > 0.9985 && dist_sq < min_distance_sq * 4) {
                continue;
            }
        }

        out.push(curr);
    }

    const last = path[path.length - 1];
    const tail = out[out.length - 1];
    if (tail[0] !== last[0] || tail[1] !== last[1]) {
        out.push(last);
    }

    return out.length >= 2 ? out : [path[0], last];
};

const create_path2d = (path: [number, number][]): Path2D | null => {
    if (typeof Path2D === "undefined" || path.length < 2) {
        return null;
    }

    const p = new Path2D();
    p.moveTo(path[0][0], path[0][1]);
    for (let i = 1; i < path.length; i++) {
        p.lineTo(path[i][0], path[i][1]);
    }
    return p;
};

const tint_color = (base: ParsedColor, mix_color: number, amount: number): ParsedColor => {
    const t = Math.max(0, Math.min(1, amount));
    const br = (base.color >> 16) & 0xff;
    const bg = (base.color >> 8) & 0xff;
    const bb = base.color & 0xff;

    const mr = (mix_color >> 16) & 0xff;
    const mg = (mix_color >> 8) & 0xff;
    const mb = mix_color & 0xff;

    const r = Math.round(br + (mr - br) * t);
    const g = Math.round(bg + (mg - bg) * t);
    const b = Math.round(bb + (mb - bb) * t);

    return {
        color: (r << 16) | (g << 8) | b,
        alpha: base.alpha
    };
};

const mix_color = (a: ParsedColor, b: ParsedColor, t: number): ParsedColor => {
    const mu = Math.max(0, Math.min(1, t));
    const ar = (a.color >> 16) & 0xff;
    const ag = (a.color >> 8) & 0xff;
    const ab = a.color & 0xff;
    const br = (b.color >> 16) & 0xff;
    const bg = (b.color >> 8) & 0xff;
    const bb = b.color & 0xff;

    const r = Math.round(ar + (br - ar) * mu);
    const g = Math.round(ag + (bg - ag) * mu);
    const bch = Math.round(ab + (bb - ab) * mu);
    return {
        color: (r << 16) | (g << 8) | bch,
        alpha: a.alpha + (b.alpha - a.alpha) * mu
    };
};

const darken_legacy = (base: ParsedColor, amount: number): ParsedColor => tint_color(base, 0x000000, amount);

const lighten_legacy = (base: ParsedColor, amount: number): ParsedColor => {
    const t = Math.max(0, amount * 0.5);
    const r = (base.color >> 16) & 0xff;
    const g = (base.color >> 8) & 0xff;
    const b = base.color & 0xff;

    const nr = Math.min(255, Math.round(r * (1 + 0.5 * t) + 255 * t));
    const ng = Math.min(255, Math.round(g * (1 + 0.5 * t) + 255 * t));
    const nb = Math.min(255, Math.round(b * (1 + 0.5 * t) + 255 * t));
    return {
        color: (nr << 16) | (ng << 8) | nb,
        alpha: base.alpha
    };
};

const clamp_unit = (value: number): number => {
    if (!Number.isFinite(value)) return 1;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
};

const clamp_byte = (value: number): number => {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 255) return 255;
    return Math.round(value);
};

const composite_to_blend = (mode: CompositeOperation): BLEND_MODES => {
    switch (mode) {
        case "lighter":
            return "add";
        case "multiply":
            return "multiply";
        case "screen":
            return "screen";
        default:
            return "normal";
    }
};

const fnv32_mix_u32 = (hash: number, value: number): number => {
    hash ^= value >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
    return hash >>> 0;
};

const quantize_1e3 = (value: number): number => {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.round(value * 1000) | 0;
};

const hash_string_u32 = (value: string): number => {
    let hash = 2166136261 >>> 0;
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
};

const make_gradient_cache_key = (x: number, y: number, width: number, height: number, gradient: LinearGradient): number => {
    let hash = 2166136261 >>> 0;
    hash = fnv32_mix_u32(hash, quantize_1e3(width));
    hash = fnv32_mix_u32(hash, quantize_1e3(height));
    hash = fnv32_mix_u32(hash, quantize_1e3(gradient.x0 - x));
    hash = fnv32_mix_u32(hash, quantize_1e3(gradient.y0 - y));
    hash = fnv32_mix_u32(hash, quantize_1e3(gradient.x1 - x));
    hash = fnv32_mix_u32(hash, quantize_1e3(gradient.y1 - y));
    hash = fnv32_mix_u32(hash, gradient.stops.length);

    for (let i = 0; i < gradient.stops.length; i++) {
        const stop = gradient.stops[i];
        hash = fnv32_mix_u32(hash, quantize_1e6(stop.offset));
        hash = fnv32_mix_u32(hash, hash_string_u32(stop.color));
    }

    return hash >>> 0;
};

const quantize_1e6 = (value: number): number => {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.round(value * 1000000) | 0;
};
