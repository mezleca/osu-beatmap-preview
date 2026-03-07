export const STANDARD_RUNTIME_DEFAULTS = {
    precompute: {
        lookback_ms: 1500,
        lookahead_ms: 8000,
        frame_budget_ms: 0.35,
        bootstrap_budget_ms: 12,
        bootstrap_total_ms: 120
    },
    slider_cache: {
        max_entries: 40,
        max_bytes: 48 * 1024 * 1024,
        retention_ms: 8000,
        trim_interval_ms: 250
    },
    stack: {
        default_leniency: 0.7,
        distance: 3,
        offset_multiplier: 6.4
    }
} as const;
