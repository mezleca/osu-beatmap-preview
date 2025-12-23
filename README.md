## osu-beatmap-preview

vibecoded osu! beatmap preview using lazer and [this](https://github.com/Lekuruu/osu-preview) as reference.<br>
created to be used on [osu-stuff](https://github.com/mezleca/osu-stuff)

## features

- preview for standard and mania modes
- basic configurable skin (colors, animations, toggles)
- canvas backend (not the most performant due to the nature of canvas)
- beatmap parser (.osu, .osz files)

## supported mods

- hidden
- hard rock
- double time
- half time
- nightcore
- easy
- fade in

## usage

```typescript
import { BeatmapPlayer, get_available_mods } from "osu-beatmap-preview";

const player = new BeatmapPlayer({ canvas });
await player.load(oszFile);
player.play();

// get mods for current gamemode
const mods = get_available_mods("standard");
```

## skin config

```typescript
player.set_skin({
    combo_colors: ["255,0,0", "0,255,0"],
    enable_slider_ball: false,
    enable_hit_animations: true,
    follow_circle_color: "#ff8800",
    ...
});
```

## events

```typescript
player.on("play", () => console.log("playing"));
player.on("pause", () => console.log("paused"));
player.on("seek", (time) => console.log("seeked to", time));
player.on("timeupdate", (time, duration) => {});
```
