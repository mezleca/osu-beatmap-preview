import { BeatmapPlayer, Mods, mods_from_string, toggle_mod, has_mod, type IBeatmap, type IBeatmapResources } from "../src";

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

const setup_player_events = (p: BeatmapPlayer) => {
    p.on("loaded", (beatmap: IBeatmap, resources: IBeatmapResources) => {
        title_el.textContent = `${beatmap.artist} - ${beatmap.title}`;
        subtitle_el.textContent = `[${beatmap.version}] AR${beatmap.ar.toFixed(1)} CS${beatmap.cs.toFixed(1)}`;
        play_btn.disabled = false;
        stop_btn.disabled = false;
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
        key_bindings: {}
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

const update_mod_ui = () => {
    document.querySelectorAll(".mod").forEach((btn) => {
        const mod_name = (btn as HTMLElement).dataset.mod!;
        const mod_value = mods_from_string(mod_name);
        btn.classList.toggle("active", has_mod(active_mods, mod_value));
    });
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

// mod toggles
document.querySelectorAll(".mod").forEach((btn) => {
    btn.addEventListener("click", () => {
        const mod_name = (btn as HTMLElement).dataset.mod!;
        const mod_value = mods_from_string(mod_name);

        active_mods = toggle_mod(active_mods, mod_value);
        update_mod_ui();

        if (player?.is_loaded) {
            player.set_mods(active_mods);
        }
    });
});
