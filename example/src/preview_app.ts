import {
    BeatmapPlayer,
    GameMode,
    load_font,
    toggle_mod,
    has_mod,
    get_available_mods,
    type IBeatmap,
    type IBeatmapResources
} from "../../src";

let is_initialized = false;

export const init_preview_app = async (): Promise<void> => {
    if (is_initialized) {
        return;
    }
    is_initialized = true;

    const $ = (id: string) => document.getElementById(id)!;

    const canvas = $("preview") as HTMLCanvasElement;
    const file_input = $("file-input") as HTMLInputElement;
    const play_btn = $("play-btn") as HTMLButtonElement;
    const stop_btn = $("stop-btn") as HTMLButtonElement;
    const progress_bar = $("progress") as HTMLDivElement;
    const progress_fill = $("progress-fill") as HTMLDivElement;
    const title_el = $("title") as HTMLSpanElement;
    const subtitle_el = $("subtitle") as HTMLSpanElement;
    const time_el = $("time") as HTMLSpanElement;
    const drop_zone = $("drop-zone") as HTMLDivElement;
    const diff_select = $("diff-select") as HTMLSelectElement;

    let player: BeatmapPlayer | null = null;
    let active_mods = 0;

    const default_hitsounds = [
        "drum-hitclap.wav",
        "drum-hitclap3.wav",
        "drum-hitnormal.wav",
        "drum-hitnormalh.wav",
        "drum-hitwhistle.wav",
        "drum-slidertick.wav",
        "normal-hitclap.wav",
        "normal-hitclap2.wav",
        "normal-hitfinish.wav",
        "normal-hitfinish2.wav",
        "normal-hitnormal.wav",
        "normal-hitnormalh.wav",
        "normal-hitwhistle.wav",
        "normal-slidertick.wav",
        "soft-hitclap.wav",
        "soft-hitclap2.wav",
        "soft-hitfinish.wav",
        "soft-hitfinish2.wav",
        "soft-hitnormal.wav",
        "soft-hitnormal1.wav",
        "soft-hitnormal2.wav",
        "soft-hitsoft.wav",
        "soft-hitwhistle.wav",
        "soft-slidertick.wav"
    ];

    const load_default_hitsounds = async (target: BeatmapPlayer) => {
        const urls = default_hitsounds.map((name) => `/assets/hitsounds/${name}`);
        await target.load_default_hitsounds(urls);
    };

    const load_default_fonts = async () => {
        await load_font({
            family: "Kozuka Gothic Pro B",
            weight: "600",
            url: "url(/assets/fonts/KozGoProBold.otf)"
        });
    };

    await load_default_fonts();

    const format_time = (ms: number): string => {
        const s = Math.floor(ms / 1000);
        return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
    };

    const update_progress = (time: number, duration: number) => {
        const safe_duration = Math.max(1, duration);
        const pct = (time / safe_duration) * 100;
        progress_fill.style.width = `${pct}%`;
        time_el.textContent = `${format_time(time)} / ${format_time(duration)}`;
    };

    const resolve_mode = (beatmap: IBeatmap | null): "standard" | "taiko" | "catch" | "mania" => {
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

    const normalize_mods_for_mode = (mods: number, mode: "standard" | "taiko" | "catch" | "mania"): number => {
        const available = get_available_mods(mode).map((mod) => mod.value);
        let filtered = 0;
        for (const value of available) {
            if (has_mod(mods, value)) {
                filtered |= value;
            }
        }
        return filtered;
    };

    const resize_canvas = () => {
        const rect = drop_zone.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
        player?.resize(rect.width, rect.height);
    };

    const resize_observer = new ResizeObserver(() => resize_canvas());
    resize_observer.observe(drop_zone);

    let setup_player_events = (p: BeatmapPlayer) => {
        p.on("loaded", (beatmap: IBeatmap, resources: IBeatmapResources) => {
            const ar = beatmap.Difficulty.ApproachRate >= 0 ? beatmap.Difficulty.ApproachRate : beatmap.Difficulty.OverallDifficulty;
            title_el.textContent = `${beatmap.Metadata.Artist} - ${beatmap.Metadata.Title}`;
            subtitle_el.textContent = `[${beatmap.Metadata.Version}] AR${ar.toFixed(1)} CS${beatmap.Difficulty.CircleSize.toFixed(1)}`;
            play_btn.disabled = false;
            stop_btn.disabled = false;

            const mode = resolve_mode(beatmap);
            active_mods = normalize_mods_for_mode(active_mods, mode);
            if (player?.is_loaded) {
                player.set_mods(active_mods);
            }
            update_progress(player?.current_time ?? 0, player?.duration ?? 0);

            if (resources.available_difficulties.length > 1) {
                diff_select.style.display = "block";
                diff_select.innerHTML = "";
                for (const diff of resources.available_difficulties) {
                    const opt = document.createElement("option");
                    opt.value = diff.beatmap.Metadata.Version;
                    opt.textContent = diff.beatmap.Metadata.Version;
                    opt.selected = diff.beatmap.Metadata.Version == beatmap.Metadata.Version;
                    diff_select.appendChild(opt);
                }
            } else {
                diff_select.style.display = "none";
            }
        });

        p.on("timeupdate", (time, duration) => {
            update_progress(time, duration);
        });

        p.on("statechange", (playing) => {
            play_btn.textContent = playing ? "⏸" : "▶";
        });

        p.on("ended", () => {
            play_btn.textContent = "▶";
        });

        p.on("error", (_code, reason) => {
            title_el.textContent = `Error: ${reason}`;
            subtitle_el.textContent = "";
        });

        p.on("seek", (time) => {
            update_progress(time, player?.duration ?? 0);
        });
    };

    const load_beatmap = async (data: ArrayBuffer, filename: string) => {
        player?.dispose();

        player = new BeatmapPlayer({
            canvas,
            mods: active_mods,
            start_mode: "preview",
            volume: 0.5,
            skin: {
                default_font: '"Kozuka Gothic Pro B", sans-serif'
            },
            playfield_scale: 0.9,
            auto_resize: true,
            enable_fps_counter: true
        });

        await load_default_hitsounds(player);
        setup_player_events(player);

        title_el.textContent = "Loading...";
        subtitle_el.textContent = "";

        if (filename.endsWith(".osz")) {
            await player.load_osz(data);
        } else {
            const files = new Map<string, ArrayBuffer>();
            files.set(filename, data);
            await player.load_files(files);
        }
    };

    file_input.addEventListener("change", async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
            await load_beatmap(await file.arrayBuffer(), file.name);
        }
    });

    drop_zone.addEventListener("dragover", (e) => {
        e.preventDefault();
        drop_zone.classList.add("drag-over");
    });

    drop_zone.addEventListener("dragleave", () => {
        drop_zone.classList.remove("drag-over");
    });

    drop_zone.addEventListener("drop", async (e) => {
        e.preventDefault();
        drop_zone.classList.remove("drag-over");
        const file = e.dataTransfer?.files[0];
        if (file && (file.name.endsWith(".osz") || file.name.endsWith(".osu"))) {
            await load_beatmap(await file.arrayBuffer(), file.name);
        }
    });

    play_btn.addEventListener("click", () => {
        player?.toggle_pause();
    });

    stop_btn.addEventListener("click", () => {
        player?.stop();
        if (player) {
            update_progress(player.current_time, player.duration);
        }
    });

    progress_bar.addEventListener("click", (e) => {
        if (!player?.is_loaded) return;
        const rect = progress_bar.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        player.seek(pct * player.duration);
    });

    diff_select.addEventListener("change", async () => {
        if (player && diff_select.value) {
            title_el.textContent = "Loading Difficulty...";
            await player.set_difficulty(diff_select.value);
        }
    });

    const mods_container = $("mods-container") as HTMLDivElement;

    const render_mod_buttons = () => {
        const mode = resolve_mode(player?.beatmap ?? null);
        active_mods = normalize_mods_for_mode(active_mods, mode);
        const available = get_available_mods(mode as any);

        mods_container.innerHTML = "";
        for (const mod of available) {
            const btn = document.createElement("button");
            btn.className = `mod ${has_mod(active_mods, mod.value) ? "active" : ""}`;
            btn.textContent = mod.acronym;
            btn.title = mod.name;
            btn.onclick = () => {
                active_mods = toggle_mod(active_mods, mod.value);
                if (player?.is_loaded) {
                    player.set_mods(active_mods);
                }
                render_mod_buttons();
            };
            mods_container.appendChild(btn);
        }
    };

    render_mod_buttons();

    const original_setup = setup_player_events;

    setup_player_events = (p: BeatmapPlayer) => {
        original_setup(p);
        p.on("loaded", () => {
            setTimeout(render_mod_buttons, 0);
        });
    };

    document.addEventListener("keydown", (e) => {
        if (!player) return;

        switch (e.code) {
            case "Space":
                e.preventDefault();
                player.toggle_pause();
                break;
            case "ArrowLeft":
                player.seek(player.current_time - 5000);
                break;
            case "ArrowRight":
                player.seek(player.current_time + 5000);
                break;
        }
    });

    const apply_scroll_seek = (delta_y: number, is_precise: boolean) => {
        if (!player?.is_loaded) return;
        const direction = delta_y > 0 ? 1 : -1;
        const step = is_precise ? 1000 : 5000;
        player.seek(player.current_time + direction * step);
    };

    canvas.addEventListener(
        "wheel",
        (e) => {
            if (!player?.is_loaded) return;
            e.preventDefault();
            apply_scroll_seek(e.deltaY, e.shiftKey);
        },
        { passive: false }
    );

    progress_bar.addEventListener(
        "wheel",
        (e) => {
            if (!player?.is_loaded) return;
            e.preventDefault();
            apply_scroll_seek(e.deltaY, e.shiftKey);
        },
        { passive: false }
    );
};
