import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const skin_dir = path.resolve(process.cwd(), "src/assets/default-skin");
const manifest_path = path.join(skin_dir, "manifest.json");

const collect_files = async (dir: string, base_dir: string): Promise<string[]> => {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await collect_files(absolute, base_dir)));
            continue;
        }

        const relative = path.relative(base_dir, absolute).split(path.sep).join("/");
        if (relative === "manifest.json") {
            continue;
        }
        files.push(relative);
    }

    return files;
};

const main = async (): Promise<void> => {
    const files = await collect_files(skin_dir, skin_dir);
    files.sort((a, b) => a.localeCompare(b));
    await writeFile(manifest_path, `${JSON.stringify(files, null, 2)}\n`, "utf8");
    console.log(`[generate:skin] wrote ${files.length} entries to ${manifest_path}`);
};

await main();
