import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const fileName = fileURLToPath(import.meta.url);
const dirName = path.dirname(fileName);
const rootDir = path.join(dirName, "..");
const workDir = path.join(rootDir, "tools", "dat-export");
let patchJson; 
try {
    const res = await fetch('https://poe-versions.obsoleet.org');
    patchJson = await res.json();
} catch (error) {
    console.error("Failed to fetch patch versions from poe-versions.obsoleet.org");
    patchJson = {
        poe: "3.27.0.7",
        poe2: "4.4.0.3.16",
    };
}
const V_1_LATEST = patchJson.poe;
const V_2_LATEST = patchJson.poe2;
const DEFAULT_SPECS = [{
    major: "1",
    patches: [V_1_LATEST],
}, {
    major: "2",
    patches: [V_2_LATEST],
}];

async function runTableExport(patchVersion, tableName, columns) {
    const config = {
        patch: patchVersion,
        steam: undefined,
        tables: [
            {
                name: tableName,
                columns
            }
        ]
    };
    await fs.mkdir(workDir, { recursive: true });
    const configPath = path.join(workDir, "config.json");
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    const cliPath = path.join(rootDir, "node_modules", "pathofexile-dat", "dist", "cli", "run.js");
    await fs.access(cliPath);
    const child = spawn(process.execPath, [cliPath], {
        cwd: workDir,
        stdio: "inherit"
    });
    await new Promise((resolve, reject) => {
        child.on("exit", code => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error("pathofexile-dat cli exited with code " + code));
            }
        });
        child.on("error", reject);
    });
    const srcPath = path.join(workDir, "tables", "English", tableName + ".json");
    const contents = await fs.readFile(srcPath, { encoding: "utf-8" });
    return JSON.parse(contents);
}

async function runTableExportMerge(patchVersions, tableName, columns) {
    let mergedRows = [];
    for (const patchVersion of patchVersions) {
        const rows = await runTableExport(patchVersion, tableName, columns);
        if (mergedRows.length === 0) {
            mergedRows = rows;
        } else {
            mergedRows = mergeById(mergedRows, rows);
        }
    }
    return mergedRows;
}

function mergeById(earlyRows, lateRows) {
    const byId = new Map();
    for (const row of earlyRows) {
        const id = String(row.Id);
        byId.set(id, row);
    }
    for (const row of lateRows) {
        const id = String(row.Id);
        byId.set(id, row);
    }
    return Array.from(byId.values());
}

async function writeJson(relativePath, rows) {
    const destPath = path.join(rootDir, relativePath);
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.writeFile(destPath, JSON.stringify(rows, null, 2));
}

function normText(text) {
    return text.replace(/<\/?(?:i|italic)>/gi, "").replace(/\{([^}]+)\}/g, "$1");
}

async function exportWorldAreas() {
    for (const spec of DEFAULT_SPECS) {
        const mergedRows = await runTableExportMerge(spec.patches, "WorldAreas", [
            "Id",
            "Name",
            "Act",
            "IsTown",
            "HasWaypoint",
            "AreaLevel",
            "HASH16",
            "LoadingScreens",
            "IsMapArea",
            "IsHideout",
            "Tags",
            "IsUniqueMapArea",
        ]);
        await writeJson(path.join("src", "data", "gen", spec.major, "areas.json"), mergedRows);
    }
}

async function exportBossTable() {
    const nonCombatNames = new Set(["The Hooded One", "Balbala, the Advisor"]);
    const aliases = {
        "Mortimer": "The Bloated Miller",
    };
    for (const spec of DEFAULT_SPECS) {
        const npcRows = await runTableExportMerge(spec.patches, "NPCs", [
            "Id",
            "Name",
            "Metadata",
            "ShortName"
        ]);
        const npcMap = new Map();
        for (const row of npcRows) {
            npcMap.set(row._index, row.Name);
        }
        const npcAudioRows = await runTableExportMerge(spec.patches, "NPCTextAudio", [
            "Id",
            "Characters",
            "Text",
            "NPCs"
        ]);
        const bosses = {};
        const deathCryRegex = /(?<!Player)death/i;
        for (const row of npcAudioRows) {
            const text = row.Text;
            if (!text) continue;
            
            const id = row.Id;
            if (!deathCryRegex.test(id)) continue;
            
            const npcNames = row.NPCs.map(npc => npcMap.get(npc)) || [];
            for (const name of npcNames) {
                if (nonCombatNames.has(name)) continue;

                let boss = bosses[name];
                if (!boss) {
                    boss = { deathCries: new Set() };
                    bosses[name] = boss;
                }
                const alias = aliases[name];
                if (alias) {
                    boss.alias = alias;
                }
                boss.deathCries.add(text);
            }
        }
        for (const bossName of Object.keys(bosses)) {
            const boss = bosses[bossName];
            if (boss.deathCries.size === 0) {
                delete bosses[bossName];
            } else {
                boss.deathCries = Array.from(boss.deathCries);
            }
        }
        await writeJson(path.join("src", "data", "gen", spec.major, "bosses.json"), bosses);
    }
}

async function main() {
    await exportWorldAreas();
    await exportBossTable();
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});

