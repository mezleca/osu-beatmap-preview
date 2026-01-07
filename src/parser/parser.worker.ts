// types for worker messages (kept for potential future use)
import type { IBeatmap, IBeatmapInfo } from "../types/beatmap";

export type WorkerMessage =
    | { type: "parse"; id: number; content: string }
    | { type: "parse_info"; id: number; content: string; filename: string }
    | { type: "extract"; id: number; content: string; extract_type: "audio" | "background" | "video" | "preview" };

export type WorkerMessageWithoutId =
    | { type: "parse"; content: string }
    | { type: "parse_info"; content: string; filename: string }
    | { type: "extract"; content: string; extract_type: "audio" | "background" | "video" | "preview" };

export type WorkerResponse =
    | { type: "parse"; id: number; beatmap: IBeatmap }
    | { type: "parse_info"; id: number; info: IBeatmapInfo }
    | { type: "extract"; id: number; result: string | number | { filename: string; offset: number } | null }
    | { type: "error"; id: number; error: string };
