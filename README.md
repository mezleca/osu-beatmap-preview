## osu-beatmap-preview

vibecoded osu! beatmap preview using lazer and [this](https://github.com/Lekuruu/osu-preview) as reference.<br>
created to be used on [osu-stuff](https://github.com/mezleca/osu-stuff)

## features

- preview for standard and mania modes
- basic configurable skin (colors, animations, toggles)
- pixi/webgl renderer backend
- beatmap parser (.osu, .osz files)
- hitsounds resolved from mapset/skin files (no bundled default hitsound pack)

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
await player.load_osz(oszFile);
player.play();

// get mods for current gamemode
const mods = get_available_mods("standard");
```

## skin loading

```typescript
// load external skin archive (.osk)
await player.load_skin_osk(osk_arr_buffer);

// or load extracted files
await player.load_skin_files(
    new Map<string, ArrayBuffer | string>([
        ["skin.ini", text],
        ["hitcircle.png", hitcirclebytes]
    ])
);

// reset to bundled default-skin
player.clear_loaded_skin();
```

## events

```typescript
player.on("play", () => console.log("playing"));
player.on("pause", () => console.log("paused"));
player.on("seek", (time) => console.log("seeked to", time));
player.on("timeupdate", (time, duration) => {});
```

## assets

- default skin assets are a mixture of elements from [owc remake](https://skins.osuck.net/skins/3301) and the default skin from osu! stable (mostly hitsounds)
