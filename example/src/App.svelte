<script lang="ts">
    import { onMount } from "svelte";
    import {
        BeatmapPlayer,
        GameMode,
        Mods,
        toggle_mod,
        has_mod,
        get_speed_multiplier,
        get_available_mods,
        type GameModeType,
        type IModInfo,
        type IBeatmap,
        type IBeatmapResources
    } from "../../src";

    let canvas: HTMLCanvasElement;
    let drop_zone: HTMLDivElement;
    let progress_el: HTMLDivElement;
    let file_input: HTMLInputElement;

    let player: BeatmapPlayer | null = null;
    let resize_observer: ResizeObserver | null = null;

    let title = "Drop a .osz or .osu file to preview";
    let subtitle = "";
    let current_time_text = "0:00 / 0:00";
    let progress_pct = 0;
    let drag_over = false;
    let is_loaded = false;
    let is_playing = false;
    let active_mods = 0;
    let custom_rate = 1;
    let custom_rate_enabled = false;
    let effective_rate = 1;
    let volume = 0.5;

    let current_mode: GameModeType = "standard";
    let available_mods: IModInfo[] = get_available_mods("standard");
    let difficulties: { filename: string; beatmap: IBeatmap }[] = [];
    let selected_diff = "";
    const speed_mod_mask = Mods.DoubleTime | Mods.HalfTime | Mods.Nightcore;

    const format_time = (ms: number): string => {
        const s = Math.floor(ms / 1000);
        return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
    };

    const update_progress = (time: number, duration: number): void => {
        const safe_duration = Math.max(1, duration);
        progress_pct = (time / safe_duration) * 100;
        current_time_text = `${format_time(time)} / ${format_time(duration)}`;
    };

    const resolve_mode = (beatmap: IBeatmap | null): GameModeType => {
        if (!beatmap) return "standard";
        switch (beatmap.General.Mode) {
            case GameMode.Taiko:
                return "taiko";
            case GameMode.Catch:
                return "catch";
            case GameMode.Mania:
                return "mania";
            default:
                return "standard";
        }
    };

    const normalize_mods_for_mode = (mods: number, mode: GameModeType): number => {
        const available = get_available_mods(mode).map((mod) => mod.value);
        let filtered = 0;

        for (let i = 0; i < available.length; i++) {
            const value = available[i];
            if (has_mod(mods, value)) {
                filtered |= value;
            }
        }

        return filtered;
    };

    const refresh_mods = (): void => {
        active_mods = normalize_mods_for_mode(active_mods, current_mode);
        available_mods = get_available_mods(current_mode);
    };

    const clamp_rate = (value: number): number => Math.max(0.5, Math.min(2.0, value));

    const is_close_rate = (a: number, b: number): boolean => Math.abs(a - b) < 0.001;

    const get_mod_rate = (mods: number): number => get_speed_multiplier(mods);

    const clear_speed_mods = (): void => {
        active_mods &= ~speed_mod_mask;
    };

    const update_effective_rate = (): void => {
        effective_rate = custom_rate_enabled ? custom_rate : get_mod_rate(active_mods);
    };

    const apply_rate_and_mods = (): void => {
        update_effective_rate();
        if (!player?.is_loaded) {
            return;
        }
        player.set_mods(active_mods);
        player.set_rate(custom_rate_enabled ? custom_rate : null);
    };

    const sync_rate_from_mods = (): void => {
        custom_rate = get_mod_rate(active_mods);
        custom_rate_enabled = false;
        apply_rate_and_mods();
    };

    const resize_canvas = (): void => {
        if (!canvas || !drop_zone) {
            return;
        }

        const rect = drop_zone.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
        player?.resize(rect.width, rect.height);
    };

    const setup_player_events = (target: BeatmapPlayer): void => {
        target.on("loaded", (beatmap: IBeatmap, resources: IBeatmapResources) => {
            const ar = beatmap.Difficulty.ApproachRate >= 0 ? beatmap.Difficulty.ApproachRate : beatmap.Difficulty.OverallDifficulty;
            title = `${beatmap.Metadata.Artist} - ${beatmap.Metadata.Title}`;
            subtitle = `[${beatmap.Metadata.Version}] AR${ar.toFixed(1)} CS${beatmap.Difficulty.CircleSize.toFixed(1)}`;

            is_loaded = true;
            current_mode = resolve_mode(beatmap);
            refresh_mods();
            sync_rate_from_mods();

            if (target.is_loaded) {
                target.set_mods(active_mods);
                target.set_rate(custom_rate_enabled ? custom_rate : null);
            }

            update_progress(target.current_time, target.duration);
            difficulties = resources.available_difficulties;
            selected_diff = beatmap.Metadata.Version;
        });

        target.on("timeupdate", (time, duration) => {
            update_progress(time, duration);
        });

        target.on("statechange", (playing) => {
            is_playing = playing;
        });

        target.on("ended", () => {
            is_playing = false;
        });

        target.on("error", (_code, reason) => {
            title = `Error: ${reason}`;
            subtitle = "";
        });

        target.on("seek", (time) => {
            update_progress(time, target.duration);
        });
    };

    const create_player = async (): Promise<BeatmapPlayer> => {
        if (player) {
            return player;
        }

        const next_player = new BeatmapPlayer({
            canvas,
            mods: active_mods,
            start_mode: "preview",
            volume: volume,
            hitsound_volume: volume * 0.4,
            playfield_scale: 0.9,
            auto_resize: true,
            enable_fps_counter: true
        });

        setup_player_events(next_player);
        return next_player;
    };

    const load_beatmap_file = async (file: File): Promise<void> => {
        if (!canvas) {
            return;
        }

        is_loaded = false;
        is_playing = false;
        difficulties = [];
        selected_diff = "";
        title = "Loading...";
        subtitle = "";
        update_progress(0, 0);

        const data = await file.arrayBuffer();
        player = await create_player();
        player.stop();

        if (file.name.toLowerCase().endsWith(".osz")) {
            await player.load_osz(data);
            return;
        }

        const files = new Map<string, ArrayBuffer>();
        files.set(file.name, data);
        await player.load_files(files);
    };

    const on_file_input_change = async (event: Event): Promise<void> => {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) {
            return;
        }

        await load_beatmap_file(file);
        input.value = "";
    };

    const on_drop = async (event: DragEvent): Promise<void> => {
        event.preventDefault();
        drag_over = false;

        const file = event.dataTransfer?.files?.[0];
        if (!file) {
            return;
        }

        const name = file.name.toLowerCase();
        if (!name.endsWith(".osz") && !name.endsWith(".osu")) {
            return;
        }

        await load_beatmap_file(file);
    };

    const toggle_pause = (): void => {
        player?.toggle_pause();
    };

    const stop = (): void => {
        player?.stop();
        if (player) {
            update_progress(player.current_time, player.duration);
        }
    };

    const seek_by_click = (event: MouseEvent): void => {
        if (!player?.is_loaded) {
            return;
        }

        const rect = progress_el.getBoundingClientRect();
        const pct = (event.clientX - rect.left) / rect.width;
        player.seek(pct * player.duration);
    };

    const apply_scroll_seek = (delta_y: number, is_precise: boolean): void => {
        if (!player?.is_loaded) {
            return;
        }

        const direction = delta_y > 0 ? 1 : -1;
        const step = is_precise ? 1000 : 5000;
        player.seek(player.current_time + direction * step);
    };

    const on_seek_wheel = (event: WheelEvent): void => {
        if (!player?.is_loaded) {
            return;
        }

        event.preventDefault();
        apply_scroll_seek(event.deltaY, event.shiftKey);
    };

    const toggle_mod_button = (mod_value: number): void => {
        const prev_speed_mods = active_mods & speed_mod_mask;
        active_mods = toggle_mod(active_mods, mod_value);
        const next_speed_mods = active_mods & speed_mod_mask;
        const speed_changed = prev_speed_mods !== next_speed_mods;
        refresh_mods();
        if (speed_changed) {
            sync_rate_from_mods();
            return;
        }

        apply_rate_and_mods();
    };

    const on_rate_input = (event: Event): void => {
        const input = event.currentTarget as HTMLInputElement;
        const next_rate = clamp_rate(Number.parseFloat(input.value) || 1);
        custom_rate = next_rate;

        const mod_rate = get_mod_rate(active_mods);
        if (is_close_rate(next_rate, mod_rate)) {
            custom_rate_enabled = false;
        } else {
            custom_rate_enabled = true;
            clear_speed_mods();
            refresh_mods();
        }

        apply_rate_and_mods();
    };

    const on_diff_change = async (event: Event): Promise<void> => {
        if (!player) {
            return;
        }

        const select = event.currentTarget as HTMLSelectElement;
        const value = select.value;
        if (!value) {
            return;
        }

        title = "Loading Difficulty...";
        await player.set_difficulty(value);
    };

    $: {
        player?.set_volume(volume);
        player?.set_hitsound_volume(1);
    }

    onMount(() => {
        resize_canvas();

        resize_observer = new ResizeObserver(() => resize_canvas());
        resize_observer.observe(drop_zone);

        const on_keydown = (event: KeyboardEvent): void => {
            if (!player) {
                return;
            }

            switch (event.code) {
                case "Space":
                    event.preventDefault();
                    player.toggle_pause();
                    break;
                case "ArrowLeft":
                    player.seek(player.current_time - 5000);
                    break;
                case "ArrowRight":
                    player.seek(player.current_time + 5000);
                    break;
            }
        };

        window.addEventListener("keydown", on_keydown);

        return () => {
            window.removeEventListener("keydown", on_keydown);
            resize_observer?.disconnect();
            resize_observer = null;
            player?.dispose();
            player = null;
        };
    });
</script>

<div class="app">
    <div class="header">
        <div class="title-section">
            <div class="title">{title}</div>
            <div class="subtitle">{subtitle}</div>
        </div>
        <div class="controls">
            <label class="btn primary">
                Open
                <input bind:this={file_input} type="file" accept=".osz,.osu" on:change={on_file_input_change} />
            </label>
            {#if difficulties.length > 1}
                <select class="btn" value={selected_diff} on:change={on_diff_change}>
                    {#each difficulties as diff}
                        <option value={diff.beatmap.Metadata.Version}>
                            {diff.beatmap.Metadata.Version}
                        </option>
                    {/each}
                </select>
            {/if}
            <button class="btn" disabled={!is_loaded} on:click={toggle_pause}>
                {is_playing ? "⏸" : "▶"}
            </button>
            <button class="btn" disabled={!is_loaded} on:click={stop}>⏹</button>
        </div>
    </div>

    <div
        bind:this={drop_zone}
        class="preview-area"
        class:drag-over={drag_over}
        role="region"
        aria-label="Beatmap drop zone"
        on:dragover={(e) => {
            e.preventDefault();
            drag_over = true;
        }}
        on:dragleave={() => {
            drag_over = false;
        }}
        on:drop={on_drop}
    >
        <canvas bind:this={canvas} width="854" height="480" on:wheel={on_seek_wheel}></canvas>
    </div>

    <div class="footer">
        <span class="time">{current_time_text}</span>
        <button bind:this={progress_el} class="progress" aria-label="Seek progress" on:click={seek_by_click} on:wheel={on_seek_wheel}>
            <div class="progress-fill" style:width={`${progress_pct}%`}></div>
        </button>
        <div class="mods">
            {#each available_mods as mod}
                <button class="mod" class:active={has_mod(active_mods, mod.value)} title={mod.name} on:click={() => toggle_mod_button(mod.value)}>
                    {mod.acronym}
                </button>
            {/each}
        </div>
        <div class="control">
            <span class="label">Rate {effective_rate.toFixed(2)}x</span>
            <input
                class="slider"
                type="range"
                min="0.5"
                max="2"
                step="0.01"
                value={custom_rate}
                on:input={on_rate_input}
                disabled={!is_loaded}
                aria-label="Playback rate"
            />
        </div>

        <div class="control">
            <span class="label">Volume {volume * 100}%</span>
            <input class="slider" type="range" min="0" max="1" step="0.01" bind:value={volume} aria-label="Volume" />
        </div>
    </div>
</div>

<style>
    :global(*) {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
    }

    :global(html),
    :global(body),
    :global(#app) {
        height: 100%;
        font-family:
            system-ui,
            -apple-system,
            sans-serif;
        background: #0d0d12;
        color: #fff;
        overflow: hidden;
    }

    .app {
        display: flex;
        flex-direction: column;
        height: 100vh;
    }

    .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 16px;
        background: #16161d;
        border-bottom: 1px solid #2a2a35;
        flex-shrink: 0;
    }

    .title-section {
        min-width: 0;
        flex: 1;
    }

    .title {
        font-size: 13px;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .subtitle {
        font-size: 11px;
        color: #888;
    }

    .controls {
        display: flex;
        gap: 6px;
        align-items: center;
        flex-shrink: 0;
    }

    input[type="file"] {
        display: none;
    }

    .btn {
        background: #252530;
        border: 1px solid #3a3a45;
        color: #fff;
        padding: 6px 12px;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
    }

    .btn:hover:not(:disabled) {
        background: #303040;
    }

    .btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .btn.primary {
        background: #5865f2;
        border-color: #5865f2;
    }

    .btn.primary:hover {
        background: #4752c4;
    }

    .preview-area {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #000;
        position: relative;
        overflow: hidden;
    }

    :global(.preview-area.drag-over) {
        background: #1a1a25;
    }

    :global(.preview-area.drag-over::after) {
        content: "Drop beatmap here";
        position: absolute;
        color: #5865f2;
        font-size: 18px;
        font-weight: 500;
    }

    canvas {
        position: relative;
        max-width: 100%;
        max-height: 100%;
    }

    .footer {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 16px;
        background: #16161d;
        border-top: 1px solid #2a2a35;
        flex-shrink: 0;
    }

    .time {
        font-size: 11px;
        color: #888;
        font-variant-numeric: tabular-nums;
        min-width: 90px;
    }

    .progress {
        flex: 1;
        height: 4px;
        background: #252530;
        border-radius: 2px;
        cursor: pointer;
        overflow: hidden;
        border: none;
        padding: 0;
        appearance: none;
    }

    .progress-fill {
        height: 100%;
        background: #5865f2;
        width: 0%;
    }

    .mods {
        display: flex;
        gap: 4px;
    }

    .mods .mod {
        background: #252530;
        border: 1px solid #3a3a45;
        color: #888;
        padding: 3px 6px;
        border-radius: 3px;
        font-size: 10px;
        font-weight: 600;
        cursor: pointer;
    }

    .mods .mod:hover {
        color: #fff;
    }

    .mods .mod.active {
        background: #5865f2;
        border-color: #5865f2;
        color: #fff;
    }

    .control {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 170px;
    }

    .label {
        font-size: 11px;
        color: #b9bfcc;
        min-width: 70px;
        text-align: right;
        font-variant-numeric: tabular-nums;
    }

    .slider {
        width: 100px;
        accent-color: #5865f2;
    }
</style>
