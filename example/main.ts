import { BeatmapPlayer, Mods, mods_from_string, toggle_mod, has_mod, get_available_mods, type IBeatmap, type IBeatmapResources } from "../src";

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

// player instance
let player: BeatmapPlayer | null = null;
let active_mods: number = 0;

const format_time = (ms: number): string => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
};

const resize_canvas = () => {
    const rect = drop_zone.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    player?.resize(rect.width, rect.height);
};

// native resize observer for perfect container fitting
const resize_observer = new ResizeObserver(() => resize_canvas());
resize_observer.observe(drop_zone);

let setup_player_events = (p: BeatmapPlayer) => {
    p.on("loaded", (beatmap: IBeatmap, resources: IBeatmapResources) => {
        title_el.textContent = `${beatmap.artist} - ${beatmap.title}`;
        subtitle_el.textContent = `[${beatmap.version}] AR${beatmap.ar.toFixed(1)} CS${beatmap.cs.toFixed(1)}`;
        play_btn.disabled = false;
        stop_btn.disabled = false;

        // populate difficulty selector
        if (resources.available_difficulties.length > 1) {
            diff_select.style.display = "block";
            diff_select.innerHTML = "";
            for (const diff of resources.available_difficulties) {
                const opt = document.createElement("option");
                opt.value = diff.version;
                opt.textContent = diff.version;
                opt.selected = diff.version === beatmap.version;
                diff_select.appendChild(opt);
            }
        } else {
            diff_select.style.display = "none";
        }
    });

    p.on("timeupdate", (time, duration) => {
        const pct = duration > 0 ? (time / duration) * 100 : 0;
        progress_fill.style.width = `${pct}%`;
        time_el.textContent = `${format_time(time)} / ${format_time(duration)}`;
    });

    p.on("statechange", (playing) => {
        play_btn.textContent = playing ? "⏸" : "▶";
    });

    p.on("ended", () => {
        play_btn.textContent = "▶";
    });

    p.on("error", (code, reason) => {
        title_el.textContent = `Error: ${reason}`;
        subtitle_el.textContent = "";
    });
};

const load_beatmap = async (data: ArrayBuffer, filename: string) => {
    player?.dispose();

    player = new BeatmapPlayer({
        canvas,
        mods: active_mods,
        volume: 0.5,
        playfield_scale: 0.9,
        auto_resize: true,
        enable_fps_counter: true
    });

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

// file input
file_input.addEventListener("change", async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
        await load_beatmap(await file.arrayBuffer(), file.name);
    }
});

// drag and drop
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

// controls
play_btn.addEventListener("click", () => {
    player?.toggle_pause();
});

stop_btn.addEventListener("click", () => {
    player?.stop();
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

// mod toggles
const mods_container = $("mods-container") as HTMLDivElement;

const render_mod_buttons = () => {
    // default to standard if no player or beatmap loaded yet
    const mode = player?.mode || "standard";
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

// update buttons when player state changes (like mode change)
const original_setup = setup_player_events;

setup_player_events = (p: BeatmapPlayer) => {
    original_setup(p);
    p.on("loaded", () => {
        // give it a tick to ensure internal renderer is swapped if mode changed
        setTimeout(render_mod_buttons, 0);
    });
};

// keyboard controls
document.addEventListener("keydown", (e) => {
    if (!player) return;

    switch (e.code) {
        case "Space":
            e.preventDefault();
            player.toggle_pause();
            break;
        case "ArrowLeft":
            e.preventDefault();
            player.seek(Math.max(0, player.current_time - 5000));
            break;
        case "ArrowRight":
            e.preventDefault();
            player.seek(Math.min(player.duration, player.current_time + 5000));
            break;
        case "KeyG":
            player.toggle_grid();
            break;
        case "ArrowUp":
            e.preventDefault();
            player.seek(Math.max(0, player.current_time - 1000));
            break;
        case "ArrowDown":
            e.preventDefault();
            player.seek(Math.min(player.duration, player.current_time + 1000));
            break;
    }
});
