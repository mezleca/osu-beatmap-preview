export type EasingFunction = (t: number) => number;

export const Easing = {
    None: (t: number) => t,
    Out: (t: number) => 1 - Math.pow(1 - t, 2),
    In: (t: number) => t * t,
    InOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    OutCubic: (t: number) => 1 - Math.pow(1 - t, 3),
    InCubic: (t: number) => t * t * t,
    OutQuad: (t: number) => 1 - Math.pow(1 - t, 2),
    InQuad: (t: number) => t * t,
    OutQuint: (t: number) => 1 - Math.pow(1 - t, 5),
    InQuint: (t: number) => t * t * t * t * t,
    OutElastic: (t: number) => {
        const c4 = (2 * Math.PI) / 3;
        return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    }
};

export interface Transform {
    property: "alpha" | "scale" | "x" | "y" | "rotation";
    start_value: number;
    end_value: number;
    start_time: number;
    end_time: number;
    easing: EasingFunction;
    loop?: boolean;
    loop_delay?: number;
}

export class TransformSequence {
    private transforms: Transform[] = [];

    add(
        property: Transform["property"],
        start_value: number,
        end_value: number,
        start_time: number,
        duration: number,
        easing: EasingFunction = Easing.None
    ): this {
        this.transforms.push({
            property,
            start_value,
            end_value,
            start_time,
            end_time: start_time + duration,
            easing
        });
        return this;
    }

    then(): this {
        return this;
    }

    get_value(property: Transform["property"], time: number, default_value: number): number {
        let value = default_value;

        for (const t of this.transforms) {
            if (t.property !== property) continue;
            if (time < t.start_time) continue;

            if (time >= t.end_time) {
                value = t.end_value;
            } else {
                const progress = (time - t.start_time) / (t.end_time - t.start_time);
                const eased = t.easing(progress);
                value = t.start_value + (t.end_value - t.start_value) * eased;
            }
        }

        return value;
    }

    clear(): void {
        this.transforms = [];
    }
}
