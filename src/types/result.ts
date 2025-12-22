export enum ErrorCode {
    NoOsuFiles = "NO_OSU_FILES",
    DifficultyNotFound = "DIFFICULTY_NOT_FOUND",
    InvalidBeatmap = "INVALID_BEATMAP",
    UnsupportedMode = "UNSUPPORTED_MODE",

    // audio errors
    AudioNotLoaded = "AUDIO_NOT_LOADED",
    AudioDecodeError = "AUDIO_DECODE_ERROR",

    // general
    NotLoaded = "NOT_LOADED",
    Unknown = "UNKNOWN"
}

export type Result<T> = { success: true; data: T } | { success: false; code: ErrorCode; reason: string };

export const ok = <T>(data: T): Result<T> => ({ success: true, data });

export const err = <T>(code: ErrorCode, reason: string): Result<T> => ({
    success: false,
    code,
    reason
});

export const unwrap = <T>(result: Result<T>): T => {
    if (result.success) return result.data;
    throw new Error(`[${result.code}] ${result.reason}`);
};

export const is_ok = <T>(result: Result<T>): result is { success: true; data: T } => {
    return result.success;
};

export const is_err = <T>(result: Result<T>): result is { success: false; code: ErrorCode; reason: string } => {
    return !result.success;
};
