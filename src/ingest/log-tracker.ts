import { RingBuffer } from "../ringbuffer";
import { clearOffsetCache, parseTs, parseUptimeMillis } from "./ts-parser";
import { EventDispatcher } from "./event-dispatcher";
import { getZoneInfo } from "../data/areas";
import { BOSSES } from "../data/boss";
import { Feature, isFeatureSupportedAt } from "../data/log-versions";
import { TSRange } from "../aggregate/segmentation";
import {
    LogEvent,
    LogFileOpenEvent,
    AreaPostLoadEvent,
    MsgFromEvent,
    MsgToEvent,
    MsgPartyEvent,
    MsgGuildEvent,
    MsgLocalEvent,
    BossKillEvent,
    DeathEvent,
    JoinedAreaEvent,
    LeftAreaEvent,
    LevelUpEvent,
    PassiveGainedEvent,
    TradeAcceptedEvent,
    ItemsIdentifiedEvent,
    HideoutEnteredEvent,
    HideoutExitedEvent,
    MapReenteredEvent,
    MapEnteredEvent,
    MapCompletedEvent,
    PassiveUnallocatedEvent,
    PassiveAllocatedEvent,
    BonusGainedEvent,
    AFKModeOnEvent,
    AFKModeOffEvent,
    ReflectingMistEvent,
    NamelessSeerEvent,
    MemoryTearEvent,
} from "./events";
import { createApproximateFileSlice } from "./file-ts-scan";

export class AreaInfo {
    ts: number;
    uptimeMillis: number;
    level: number;
    name: string;
    seed: number;

    constructor(
        ts: number,
        uptimeMillis: number,
        areaLevel: number,
        name: string,
        seed: number
    ) {
        this.ts = ts;
        this.uptimeMillis = uptimeMillis;
        this.level = areaLevel;
        this.name = name;
        this.seed = seed;
    }

    get isHideoutOrTown(): boolean {
        return this.seed === 1 || this.name === "KalguuranSettlersLeague" || this.name === "HeistHub";
    }

}

export class XPSnapshot {
    id: string;
    ts: number;
    xp: number;
    delta: number;
    areaLevel: number | null;
    source: string | null;
    encounterType: string | null;

    constructor(
        id: string,
        ts: number,
        xp: number,
        delta: number,
        areaLevel: number | null = null,
        source: string | null = null,
        encounterType: string | null = null
    ) {
        if (xp < 0) {
            throw new Error("xp must be a positive integer");
        }
        this.id = id;
        this.ts = ts;
        this.xp = xp;
        this.delta = delta;
        this.areaLevel = areaLevel;
        this.source = source;
        this.encounterType = encounterType;
    }
}

export enum MapMarkerType {
    map,
    load,
    hideout,
    afk,
    pause,
    complete,
}

class MapMarker {
    /**
     * @param type - the type of marker
     * @param ts - when this marker was started. if ts is imprecise (seconds precision as in the log file), uptimeMillis and uptimeId may be provided to increase precision
     * @param uptimeMillis - current uptime of user OS as indicated in the log file, possibly supplied via GetTickCount (sysinfoapi.h). 
     * may only be used as deltas between markers with the same uptimeId
     * @param uptimeId - any "LOG FILE OPENING" log will increment the uptimeId, this technically doesn't align perfectly with uptimeMillis (more than one client launch per OS boot)
     */
    constructor(
        readonly type: MapMarkerType, 
        readonly ts: number, 
        readonly uptimeMillis?: number, 
        readonly uptimeId?: number,
    ) {}
}

export enum AreaType {
    Map,
    Hideout,
    Campaign,
    Town,
    Sanctum,
    Labyrinth,
    TrialSekhema,
    TrialChaos,
    Logbook,
    Heist,
    Tower,
    Delve,
    Other
}

export const areaTypeMeta: Record<AreaType, { name: string, icon: string, color: string }> = {
    [AreaType.Map]: {
        name: "Map",
        icon: "bi-globe",
        color: "text-dark"
    },
    [AreaType.Hideout]: {
        name: "Hideout",
        icon: "bi-house",
        color: "text-secondary"
    },
    [AreaType.Campaign]: {
        name: "Campaign",
        icon: "bi-map",
        color: "text-dark"
    },
    [AreaType.Town]: {
        name: "Town",
        icon: "bi-shop",
        color: "text-secondary"
    },
    [AreaType.Sanctum]: {
        name: "Sanctum",
        icon: "bi-hexagon",
        color: "text-dark"
    },
    [AreaType.Labyrinth]: {
        name: "Labyrinth",
        icon: "bi-compass",
        color: "text-dark"
    },
    [AreaType.TrialSekhema]: {
        name: "Trial of Sekhema",
        icon: "bi-compass",
        color: "text-dark"
    },
    [AreaType.TrialChaos]: {
        name: "Trial of Chaos",
        icon: "bi-compass",
        color: "text-dark"
    },
    [AreaType.Logbook]: {
        name: "Logbook",
        icon: "bi-book",
        color: "text-dark"  
    },
    [AreaType.Heist]: {
        name: "Heist",
        icon: "bi-building-fill",
        color: "text-dark"
    },
    [AreaType.Tower]: {
        name: "Tower",
        icon: "bi-building-fill",
        color: "text-dark"
    },
    [AreaType.Delve]: {
        name: "Delve",
        icon: "bi-diamond-half",
        color: " text-primary"
    },
    [AreaType.Other]: {   
        name: "Other",
        icon: "bi-question-circle",
        color: "text-dark"
    }
}

export const areaTypes = Object.values(AreaType).filter(v => typeof v === 'number') as AreaType[];

export class MapInstance {
    id: number;
    name: string;
    areaLevel: number;
    seed: number;
    areaType: AreaType;
    hasBoss: boolean = false;
    isUnique: boolean;
    markers: MapMarker[] = [];

    constructor(
        id: number,
        name: string,
        areaLevel: number,
        seed: number,
    ) {
        if (!name?.trim()) throw new Error("name must be a non-empty string");

        if (areaLevel < 0) throw new Error("areaLevel must be a positive integer");

        this.id = id;
        this.name = name;
        this.areaLevel = areaLevel;
        this.seed = seed;
        const towerMaps = [
            "maplosttowers",
            "mapmesa",
            "mapalpineridge",
            "mapbluff",
            "mapswamptower"
        ];
        const zoneInfo = getZoneInfo(name, areaLevel);
        if (zoneInfo) {
            this.isUnique = zoneInfo.isUnique;
            if (zoneInfo.isHideout) {
                this.areaType = AreaType.Hideout;
                return;
            } else if (zoneInfo.isTown) {
                this.areaType = AreaType.Town;
                return;
            } else if (zoneInfo.isMapArea) {
                this.areaType = AreaType.Map;
                return;
            } else if ("Trial of the Sekhemas" == zoneInfo.label) {
                this.areaType = AreaType.TrialSekhema;
                return;
            } else if ("Trial of Chaos" == zoneInfo.label) {
                this.areaType = AreaType.TrialChaos;
                return;
            }
        } else {
            this.isUnique = false;
        }
        const lowerName = name.toLowerCase();
        if (seed > 1) {
            if (towerMaps.includes(lowerName)) {
                this.areaType = AreaType.Tower;
            } else if (lowerName.startsWith("mapworlds")) {
                this.areaType = AreaType.Map;
                // although every map has a boss in poe1, we don't want to specifically highlight this
            } else if (lowerName.startsWith("map")) {
                this.areaType = AreaType.Map;
                this.hasBoss = !lowerName.endsWith("noboss") && !lowerName.endsWith("_claimable");
            } else if (lowerName.startsWith("sanctum")) {
                this.areaType = AreaType.Sanctum;
            } else if (lowerName.startsWith("expeditionlogbook")) {
                this.areaType = AreaType.Logbook;
            } else if (lowerName.startsWith("heist")) {
                this.areaType = AreaType.Heist;
            } else if (MAP_NAME_LABYRINTH.test(lowerName)) {
                this.areaType = AreaType.Labyrinth;
            } else if (MAP_NAME_CAMPAIGN.test(lowerName)) {
                this.areaType = AreaType.Campaign;
            } else if (lowerName.startsWith("delve")) {
                this.areaType = AreaType.Delve;
            } else {
                this.areaType = AreaType.Other;
            }
        } else {
            if (MAP_NAME_TOWN.test(name)) {
                this.areaType = AreaType.Town;
            } else {
                this.areaType = AreaType.Hideout;
            }
        }
    }

    get start(): number {
        return this.markers[0].ts;
    }

    get end(): number {
        return this.lastMarker.ts;
    }

    get lastMarker(): MapMarker {
        return this.markers[this.markers.length - 1];
    }

    appendMarker(marker: MapMarker): void {
        if (this.lastMarker?.type === MapMarkerType.complete) throw new Error(`map is already complete: ${JSON.stringify(this.markers)}`);

        this.markers.push(marker);
    }

    resumePriorMarker(start: number, uptimeMillis?: number, uptimeId?: number): void {
        if (this.markers.length < 2) throw new Error(`cannot resume prior marker because there are less than 2 markers: ${JSON.stringify(this.markers)}`);

        const priorMarker = this.markers[this.markers.length - 2];
        this.markers.push(new MapMarker(priorMarker.type, start, uptimeMillis, uptimeId));
    }

    getTime(types?: Set<MapMarkerType>, precision: MapTimePrecision = MapTimePrecision.milliseconds, end?: number): number {
        return MapInstance.getTime(this, types, precision, end);
    }

    getTimeMap(precision: MapTimePrecision = MapTimePrecision.milliseconds): Map<MapMarkerType, number> {
        return MapInstance.getTimeMap(this, precision);
    }
    
    static label(map: MapInstance): string {
        const zoneInfo = getZoneInfo(map.name, map.areaLevel);
        if (zoneInfo) return zoneInfo.label;

        switch (map.areaType) {
            case AreaType.Campaign:
                return "Campaign " + map.name;
            case AreaType.Town:
                return "Town " + map.name;
            case AreaType.Labyrinth:
                let difficulty;
                switch (map.name.substring(0, 1)) {
                    case "1":
                        difficulty = "Normal";
                        break;
                    case "2":
                        difficulty = "Cruel";
                        break;
                    case "3":
                        difficulty = "Merciless";
                        break;
                    case "E":
                        difficulty = "Uber";
                        break;
                    default:
                        difficulty = "Unknown";
                }
                return "Labyrinth " + difficulty;
        }
        const name = map.name.replace(/(^MapUnique)|(^MapWorlds)|(^Map)|(_NoBoss$)/gi, '');
        const words = name.match(/[A-Z][a-z]*|[a-z]+/g) || [];
        if (words.length === 0) {
            return name;
        }
        return words.join(' ');
    }

    static labelForName(name: string): string {
        const zoneInfo = getZoneInfo(name);
        if (zoneInfo) return zoneInfo.label;

        const normName = name.replace(/(^MapUnique)|(^MapWorlds)|(^Map)|(_NoBoss$)/gi, '');
        const words = normName.match(/[A-Z][a-z]*|[a-z]+/g) || [];
        if (words.length === 0) return normName;
        
        return words.join(' ');
    }

    static areaType(map: MapInstance): AreaType {
        const towerMaps = [
            "maplosttowers",
            "mapmesa",
            "mapalpineridge",
            "mapbluff",
            "mapswamptower"
        ];
        const name = map.name.toLowerCase();
        if (map.seed > 1) {
            if (towerMaps.includes(name)) {
                return AreaType.Tower;
            } else if (name.startsWith("map")) {
                return AreaType.Map;
            } else if (name.startsWith("sanctum")) {
                return AreaType.Sanctum;
            } else if (name.startsWith("expeditionlogbook")) {
                return AreaType.Logbook;
            } else if (MAP_NAME_CAMPAIGN.test(name)) {
                return AreaType.Campaign;
            }
        } else {
            if (MAP_NAME_TOWN.test(name)) {
                return AreaType.Town;
            } else {
                return AreaType.Hideout;
            }
        }
        return AreaType.Other;
    }

}

export enum MapTimePrecision {
    seconds,
    milliseconds,
}

export namespace MapInstance {
    /**
     * note that the marker MapMarkerType.complete cannot be excluded
     */
    export function getTime(mapOrMarkers: MapInstance | MapMarker[], types?: Set<MapMarkerType>, precision: MapTimePrecision = MapTimePrecision.milliseconds, end?: number): number {
        const markers = Array.isArray(mapOrMarkers) ? mapOrMarkers : mapOrMarkers.markers;
        let tailDelta = 0;
        if (end) {
            const tailMarker = markers[markers.length - 1];
            if (tailMarker.type === MapMarkerType.complete) throw new Error(`markers already completed: ${JSON.stringify(markers)}`);

            if (!types || types.has(tailMarker.type)) {
                tailDelta = end - tailMarker.ts;
                if (tailDelta < 0) throw new Error(`end timestamp precedes prior marker: ${end} < ${tailMarker.ts}`);
            }
        }
        if (!types) {
            return getDelta(markers[0], markers[markers.length - 1], precision) + tailDelta;
        }
        let time = 0;
        for (let i = 0; i < markers.length - 1; i++) {
            const marker = markers[i], nextMarker = markers[i + 1];
            // marker.ts until nextMarker.ts is the span solely of the marker, therefore we don't care about the next marker's type
            if (types.has(marker.type)) {
                time += getDelta(marker, nextMarker, precision);
            }
        }
        return time + tailDelta;
    }

    export function getDelta(marker: MapMarker, nextMarker: MapMarker, precision: MapTimePrecision): number {
        const tsDelta = nextMarker.ts - marker.ts;
        if (precision === MapTimePrecision.seconds || nextMarker.uptimeId !== marker.uptimeId || !marker.uptimeMillis || !nextMarker.uptimeMillis) {
            return tsDelta;
        } else {
            const uptimeDelta = nextMarker.uptimeMillis - marker.uptimeMillis;
            const diff = Math.abs(uptimeDelta - tsDelta);
            if (diff <= 2000) {
                return uptimeDelta;
            } else {
                // logger.warn(`tsDelta and uptimeDelta are too different[${marker.type}]: ${diff}ms (${tsDelta}ms, ${uptimeDelta}ms) - using tsDelta instead`);
                return tsDelta;
            }
        }
    };

    export function getTimeMap(mapOrMarkers: MapInstance | MapMarker[], precision: MapTimePrecision = MapTimePrecision.milliseconds): Map<MapMarkerType, number> {
        const markers = Array.isArray(mapOrMarkers) ? mapOrMarkers : mapOrMarkers.markers;
        const res = new Map<MapMarkerType, number>();
        for (let i = 0; i < markers.length - 1; i++) {
            const marker = markers[i], nextMarker = markers[i + 1];
            res.set(marker.type, (res.get(marker.type) ?? 0) + getDelta(marker, nextMarker, precision));
        }
        return res;
    }
}

// example 2024/12/06 18:02:40 ***** LOG FILE OPENING *****
const LOG_FILE_OPEN_REGEX = /\*\*\*\*\* LOG FILE OPENING \*\*\*\*\*\s+$/;
// example 2024/12/06 21:38:54 35930140 403248f7 [INFO Client 1444] [SHADER] Delay: ON
const POST_LOAD_REGEX = /^\[SHADER\] Delay/;

enum EventCG {
    MsgFrom, 
    MsgTo, 
    MsgParty,
    Generating,
    TradeAccepted,
    ItemsIdentified,
    Slain,           
    Joined,          
    Left,            
    LevelUp,
    PassiveGained,
    PassiveAllocated,
    PassiveUnallocated,
    BonusGained,
    MsgBoss,
    MsgLocal,
    AFKModeOn,
    AFKModeOff,
    ReflectingMist,
    NamelessSeer,
    MemoryTear,
}

/**
 * common prefix between all examples, note that the prefix "ends" with a space: 
 *                    2024/12/18 16:07:27 368045718 3ef2336f [INFO Client 18032] 
 * example logs:
 * MsgFrom            @From Player1: Hi, I would like to buy your Victory Grip, Pearl Ring listed for 5 divine in Standard (stash tab "Q1"; position: left 20, top 19)
 * MsgFrom            @From <gTag> Player1: meow
 * MsgTo              @To Player1: Hi, I would like to buy your Chalybeous Sapphire Ring of Triumph listed for 1 exalted in Standard (stash tab "~price 1 exalted"; position: left 1, top 19)
 * MsgParty           Generating level 1 area "G1_1" with seed 2665241567
 * TradeAccepted      : Trade accepted.
 * ItemsIdentified    : 5 Items identified
 * Slain              : Player1 has been slain.
 * Joined             : Player1 has joined the area.
 * Left               : Player1 has left the area.
 * LevelUp            : Player1 (Sorceress) is now level 2
 * LevelUp            : Player1 (Stormweaver) is now level 100
 * PassiveGained      : You have received 2 Weapon Set Passive Skill Points.
 * PassiveGained      : You have received 2 Passive Skill Points.
 * PassiveGained      : You have received a Passive Skill Point.
 * BonusGained        : You have received +10% to [Resistances|Cold Resistance].
 * BonusGained        : You have received +30 to [Spirit|Spirit].
 * BonusGained        : Player1 have received +30 to [Spirit|Spirit].
 * BonusGained        : You have received +20 to maximum Life.
 * BonusGained        : You have received +10% to [Resistances|Lightning Resistance].
 * BonusGained        : You have received +10% to [Resistances|Fire Resistance].
 * BonusGained        : You have received 8% increased maximum Life.
 * BossKill           Xesht, We That Are One: Ugh...! We That Failed...
 * BossKill           The Arbiter of Ash: The Mothersoul... Must prevail...
 * BossKill           Strange Voice: So be it. Keep your precious sanity, my agent of chaos. You shall serve me, whether you like it or not. I'm not going anywhere...
 * BossKill           Sirus, Awakener of Worlds: At least I felt something...
 * PassiveAllocated   Successfully allocated passive skill id: spells18, name: Spell Damage
 * PassiveUnallocated Successfully unallocated passive skill id: shock5, name: Branching Bolts
 * MsgLocal           Player1: hello
 * AFKModeOn          : AFK mode is now ON. Autoreply "?"
 * AFKModeOff         : AFK mode is now OFF.
 * ReflectingMist     : A Reflecting Mist has manifested nearby.
 * NamelessSeer       : The Nameless Seer has appeared nearby.
 */

// if spaces are eventually allowed in character names, "[^ ]+" portions of patterns need to be changed to ".+"
// very important to fail fast on those patterns, e.g. avoid starting off with wildcard matches
const EVENT_PATTERNS = [
    `@From  ?(?:<([^>]+)> )?(?<g${EventCG.MsgFrom}>[^ ]+): (.*)`,
    `@To  ?(?<g${EventCG.MsgTo}>[^ ]+): (.*)`,
    `%(?<g${EventCG.MsgParty}>[^ ]+): (.*)`,
    `Generating level (?<g${EventCG.Generating}>\\d+) area \"(.+?)\"(?:.*seed (\\d+))?`,
    `: (?<g${EventCG.TradeAccepted}>Trade accepted\\.)`,
    `: (?<g${EventCG.ItemsIdentified}>\\d+) Items identified`,
    `: (?<g${EventCG.Slain}>[^ ]+) has been slain`,
    `: (?<g${EventCG.Joined}>[^ ]+) has joined the area`,
    `: (?<g${EventCG.Left}>[^ ]+) has left the area`,
    `: (?<g${EventCG.LevelUp}>[^ ]+) \\(([^)]+)\\) is now level (\\d+)`,
    `: You have received (?<g${EventCG.PassiveGained}>[0-9a-zA-Z]+) ?(Weapon Set )?Passive Skill Point`, 
    `: ((?:You)|(?:[^ ]+?)) have received (?<g${EventCG.BonusGained}>.+)`, // 2024 legacy format and new format
    `(?<g${EventCG.MsgBoss}>${Object.keys(BOSSES).join("|")}):(.*)`, // match boss names explicitly for significant speedup; would have to match spaces in MsgLocal's character name otherwise
    `(?!Error|Duration|#)(?<g${EventCG.MsgLocal}>[^\\]\\[ ]+):(.*)`,
    `Successfully allocated passive skill id: (?<g${EventCG.PassiveAllocated}>[^ ]+), name: (.+)`,
    `Successfully unallocated passive skill id: (?<g${EventCG.PassiveUnallocated}>[^ ]+), name: (.+)`,
    `: (?<g${EventCG.AFKModeOn}>)AFK mode is now ON\\.`,
    `: (?<g${EventCG.AFKModeOff}>)AFK mode is now OFF\\.`,
    `: (?<g${EventCG.ReflectingMist}>)A Reflecting Mist has manifested nearby\\.`,
    `: (?<g${EventCG.NamelessSeer}>)The Nameless Seer has appeared nearby\\.`,
    `(?<g${EventCG.MemoryTear}>)Eagon Caeserius: (?:Go on, Exile - approach the tear\\.|Look, Exile - a fresh tear!|Here, Exile! Another tear!)`,
];

const COMPOSITE_EV_REGEX = new RegExp(`^(?:` + EVENT_PATTERNS.map(p => `(${p})`).join("|") + `)`);
const COMPOSITE_PATTERN_OFFSETS: number[] = [];
{
    let currentOffset = 2; // own group + enclosing group
    for (const pattern of EVENT_PATTERNS) {
        const m = /\(\?<g(\d+)>/.exec(pattern);
        if (!m) {
            throw new Error(`pattern /${pattern}/ of composite event regex is missing named capture group like (g<NUMBER>)`);
        }
        const eventCG = parseInt(m[1], 10) as EventCG;
        COMPOSITE_PATTERN_OFFSETS[eventCG] = currentOffset;
        const captureGroupCount = new RegExp("^|" + pattern).exec("")!.length!;
        currentOffset += captureGroupCount;
    }
}

const MAP_NAME_CAMPAIGN = /^(?:g\d+_|c_g|g_|\d+_)/;
const MAP_NAME_LABYRINTH = /^\d+_labyrinth|endgame_labyrinth/;
const MAP_NAME_TOWN = /^(g([a-z0-9]+)_town)$/;
const STALE_MAP_THRESHOLD = 6 * 60 * 60 * 1000; // 6 hours in milliseconds

const logger = console;

export interface Progress {
    totalBytes: number;
    bytesRead: number;
}

export interface LogLine {
    ts?: number;
    context?: string;
    remainder?: string;
    rawLine: string;
}

export class LogTracker {
    
    private mapId: number = 0;
    public eventDispatcher = new EventDispatcher();
    private recentMaps: RingBuffer<MapInstance>;
    private recentEvents: RingBuffer<LogEvent>;
    private currentMap: MapInstance | null;
    private currentAreaInfo: AreaInfo | null;
    private currentUptimeId: number = -1;

    constructor() {
        this.recentMaps = new RingBuffer<MapInstance>(100);
        this.recentEvents = new RingBuffer<LogEvent>(100);
        this.currentMap = null;
        this.currentAreaInfo = null;
    }

    async ingestLogFile(file: File, onProgress?: (progress: Progress) => void, checkIntegrity: boolean = false, tsFilter?: TSRange): Promise<boolean> {
        const then = performance.now();
        const actualFile = tsFilter ? await createApproximateFileSlice(file, tsFilter) : file;
        const progress = {
            totalBytes: actualFile.size,
            bytesRead: 0
        };
        const reader = actualFile.stream().getReader();
        try {
            const decoder = new TextDecoder();
            let tail = '';
            let prevTs: number | undefined;
            let prevLine: string | undefined;
            const handleLine = (line: string) => {
                if (checkIntegrity) {
                    // a bit inefficient to parse ts twice, however this is mostly for debugging currently
                    const ts = parseTs(line);
                    if (ts) {
                        if (prevTs && prevTs > ts) {
                            logger.error(`Client.txt integrity violation: subsequent line precedes previous line ts by ${(prevTs - ts) / 1000}s`, [prevLine, line], prevTs, ts);
                        }
                        prevTs = ts;
                        prevLine = line;
                    }
                }
                return this.processLogLine(line);
            }
            for (;;) {
                const { done, value } = await reader.read();
                if (done) {
                    if (tail) {
                        handleLine(tail);
                    }
                    this.processEOF();
                    return true;
                }
                const chunk = decoder.decode(value, { stream: true });
                let start = 0;
                let ix: number;
                if (tail) {
                    ix = chunk.indexOf('\n');
                    if (ix !== -1) {
                        if (!handleLine(tail + chunk.slice(0, ix))) return false;

                        tail = '';
                        start = ix + 1;
                    } else {
                        tail += chunk;
                        continue;
                    }
                }
                while ((ix = chunk.indexOf('\n', start)) !== -1) {
                    const line = chunk.slice(start, ix);
                    start = ix + 1;
                    if (!handleLine(line)) return false;
                }
                if (start < chunk.length) {
                    tail = chunk.slice(start);
                }
                progress.bytesRead += value.byteLength;
                onProgress?.(progress);
            }
        } finally {
            reader.releaseLock();
            clearOffsetCache();
            const tookSeconds = ((performance.now() - then) / 1000).toFixed(2);
            const totalMiB = progress.totalBytes / 1024 / 1024;
            console.info(`Ingested ${(totalMiB).toFixed(1)} MiB of logs in ${tookSeconds} seconds`);
        }
    }

    async searchLogFile(pattern: RegExp, limit: number, file: File, onProgress?: (progress: { totalBytes: number, bytesRead: number }) => void, tsFilter?: TSRange): Promise<LogLine[]> {
        const then = performance.now();
        const actualFile = tsFilter ? await createApproximateFileSlice(file, tsFilter) : file;
        const progress = {
            totalBytes: actualFile.size,
            bytesRead: 0
        };
        const reader = actualFile.stream().getReader();
        let skipHead = !!tsFilter; // skip first line which may be malformed (sliced) - this line should be outside of the ts range anyways
        try {
            const lines: LogLine[] = [];
            const decoder = new TextDecoder();
            let tail = '';
            let hadTsMatch = false;
            for (;;) {
                const { done, value } = await reader.read();
                const handleLine = (line: string) => {
                    if (skipHead) {
                        skipHead = false;
                        return true;
                    }
                    let ts: number | null = null;
                    if (tsFilter) {
                        ts = parseTs(line);
                        if (ts) {
                            if (ts < tsFilter.lo) return true;

                            if (ts > tsFilter.hi) return false; // done, don't care about non-timestampd logs after this

                            hadTsMatch = true;
                        } else if (!hadTsMatch) {
                            // only include non-timestamped logs if they're within the ts range
                            return true;
                        }
                    }
                    if (pattern.test(line)) {
                        ts ??= parseTs(line);
                        const rIx = ts && line.indexOf("]", 40);
                        if (ts && rIx) {
                            const remainder = line.substring(rIx + 2);
                            const context = line.substring(19, rIx);
                            lines.push({ ts, context,  remainder, rawLine: line });
                        } else {
                            lines.push({ rawLine: line });
                        }
                        if (limit > 0 && lines.length >= limit) {
                            return false;
                        }
                    }
                    return true;
                };
                if (done) {
                    tail && handleLine(tail);
                    return lines;
                }
                const chunk = decoder.decode(value, { stream: true });
                let start = 0;
                let ix: number;
                if (tail) {
                    ix = chunk.indexOf('\n');
                    if (ix !== -1) {
                        const line = tail + chunk.slice(0, ix);
                        tail = '';
                        start = ix + 1;
                        if (!handleLine(line)) return lines;
                    } else {
                        tail += chunk;
                        continue;
                    }
                }
                while ((ix = chunk.indexOf('\n', start)) !== -1) {
                    const line = chunk.slice(start, ix);
                    start = ix + 1;
                    if (!handleLine(line)) return lines;
                }
                if (start < chunk.length) {
                    tail = chunk.slice(start);
                }
                progress.bytesRead += value.byteLength;
                onProgress?.(progress);
            }
        } finally {
            reader.releaseLock();
            clearOffsetCache();
            const tookSeconds = ((performance.now() - then) / 1000).toFixed(2);
            const totalMiB = progress.bytesRead / 1024 / 1024;
            console.info(`Search tested ${(totalMiB).toFixed(1)} MiB of logs in ${tookSeconds} seconds`);
        }
    }

    /**
     * Process a single log line.
     * @param line - The log line to process.
     * @returns false, if the filter would reject subsequent lines (toMillis filtering).
     */
    processLogLine(line: string): boolean {
        try {
            return this.processLogLineUnchecked(line);
        } catch (e) {
            logger.error(`error processing log line, discarding current map: ${line}`, e);
            this.currentMap = null;
            return true;
        }
    }

    private processLogLineUnchecked(line: string): boolean {
        let ts;
        // could perhaps be even greedier with the indexOf start, but this is safe
        // getting the remainder is a slight boost in performance to starting the composite regex with "] "
        const rIx = line.indexOf("]", 40);
        if (rIx === -1) {
            if (LOG_FILE_OPEN_REGEX.test(line)) {
                ts ??= parseTs(line);
                if (ts) {
                    const uptimeId = ++this.currentUptimeId;
                    this.dispatchEvent(LogFileOpenEvent.of(ts, uptimeId));
                }
            }
            return true;
        }

        const remainder = line.substring(rIx + 2);
        const postLoadMatch = (this.currentMap?.lastMarker?.type === MapMarkerType.load) && POST_LOAD_REGEX.exec(remainder);
        if (postLoadMatch) {
            ts ??= parseTs(line);
            if (!ts) {
                logger.warn(`no timestamp found in post load match: ${line}`);
                return true;
            }
            const uptimeMillis = parseUptimeMillis(line);
            const delta = this.applyLoadedAt(ts, uptimeMillis);
            this.dispatchEvent(AreaPostLoadEvent.of(ts, delta, uptimeMillis));
        } else {
            const m = COMPOSITE_EV_REGEX.exec(remainder);
            if (!m) return true;

            ts ??= parseTs(line);
            const g = m.groups!;
            const strGroup = Object.keys(g).find(k => g[k] !== undefined)!;
            const eventCG = parseInt(strGroup.substring(1), 10) as EventCG;
            if (!ts) {
                logger.warn(`no timestamp found in event match "${eventCG}": ${line}`);
                return true;
            }
            const offset = COMPOSITE_PATTERN_OFFSETS[eventCG];
            switch (eventCG) {
                case EventCG.MsgFrom:
                    this.dispatchEvent(MsgFromEvent.of(ts, m[offset + 1], m[offset + 2], m[offset]));
                    break;
                case EventCG.MsgTo:
                    this.dispatchEvent(MsgToEvent.of(ts, m[offset], m[offset + 1]));
                    break;
                case EventCG.MsgParty:
                    this.dispatchEvent(MsgPartyEvent.of(ts, m[offset], m[offset + 1]));
                    break;
                case EventCG.MsgLocal:
                    const localName = m[offset];
                    if (localName.startsWith("&")) {
                        // TODO properly support new tag format
                        this.dispatchEvent(MsgGuildEvent.of(ts, localName.substring(1), m[offset + 1]));
                    } else {
                        this.dispatchEvent(MsgLocalEvent.of(ts, localName, m[offset + 1]));
                    }
                    break;
                case EventCG.MsgBoss:
                    const boss = BOSSES[m[offset]];
                    if (boss) {
                        if (boss.deathCries.has(m[offset + 1])) {
                            if (this.currentMap) {
                                this.dispatchEvent(BossKillEvent.of(ts, boss.alias ?? m[offset], m[offset + 1], this.currentMap.areaLevel));
                            } else if (isFeatureSupportedAt(Feature.ZoneGeneration, ts)) {
                                logger.warn(`Boss kill log for ${m[offset]} but currentMap is null. Line: ${line}`);
                            }
                        }
                    }
                    break;
                case EventCG.Generating:
                    const uptimeMillisGen = parseUptimeMillis(line);
                    const areaLevel = parseInt(m[offset]);
                    const mapName = m[offset + 1];
                    const mapSeed = parseInt(m[offset + 2]);
                    // FIXME all map timing events should try to use millisecond precision
                    // otherwise, map times can drift by up to a second for every measured ts
                    // can result in overall drift of 1-3 minutes for entire campaign
                    const areaInfo = new AreaInfo(
                        ts,
                        uptimeMillisGen, 
                        areaLevel,
                        mapName,
                        mapSeed
                    );
                    this.enterArea(areaInfo);
                    this.currentAreaInfo = areaInfo;
                    break;
                case EventCG.Slain:
                    if (this.currentMap) {
                        this.dispatchEvent(DeathEvent.of(ts, m[offset], this.currentMap.areaLevel));
                    } else if (isFeatureSupportedAt(Feature.ZoneGeneration, ts)) {
                        logger.warn(`Slain log for ${m[offset]} but currentMap is null. Line: ${line}`);
                    }
                    break;
                case EventCG.Joined:
                    this.dispatchEvent(JoinedAreaEvent.of(ts, m[offset]));
                    break;
                case EventCG.Left:
                    this.dispatchEvent(LeftAreaEvent.of(ts, m[offset]));
                    break;
                case EventCG.LevelUp:
                    this.dispatchEvent(LevelUpEvent.of(ts, m[offset], m[offset + 1], parseInt(m[offset + 2])));
                    break;
                case EventCG.PassiveGained:
                    const strPassive = m[offset];
                    const passiveCount = strPassive == 'a' ? 1 : parseInt(strPassive);
                    const isWeaponSet = m[offset + 1] === 'Weapon Set';
                    if (!isWeaponSet) { // redundant (aligned) with normal passive gained events
                        this.dispatchEvent(PassiveGainedEvent.of(ts, passiveCount));
                    }
                    break;
                case EventCG.PassiveAllocated:
                    this.dispatchEvent(PassiveAllocatedEvent.of(ts, m[offset], m[offset + 1]));
                    break;
                case EventCG.PassiveUnallocated:
                    this.dispatchEvent(PassiveUnallocatedEvent.of(ts, m[offset], m[offset + 1]));
                    break;
                case EventCG.BonusGained:
                    this.dispatchEvent(BonusGainedEvent.of(ts, m[offset + 1], m[offset]));
                    break;
                case EventCG.TradeAccepted:
                    this.dispatchEvent(TradeAcceptedEvent.of(ts));
                    break;
                case EventCG.ItemsIdentified:
                    this.dispatchEvent(ItemsIdentifiedEvent.of(ts, parseInt(m[offset])));
                    break;
                case EventCG.AFKModeOn:
                    // don't attribute afk time to any map for now if the prior map was a stale map
                    this.currentMap && this.appendMarker(MapMarkerType.afk, ts, parseUptimeMillis(line));
                    this.dispatchEvent(AFKModeOnEvent.of(ts));
                    break;
                case EventCG.AFKModeOff:
                    // don't attribute afk time to any map for now if the prior map was a stale map
                    this.currentMap && this.currentMap.resumePriorMarker(ts, parseUptimeMillis(line), this.currentUptimeId);
                    this.dispatchEvent(AFKModeOffEvent.of(ts));
                    break;
                case EventCG.ReflectingMist:
                    this.dispatchEvent(ReflectingMistEvent.of(ts));
                    break;
                case EventCG.NamelessSeer:
                    this.dispatchEvent(NamelessSeerEvent.of(ts));
                    break;
                case EventCG.MemoryTear:
                    this.dispatchEvent(MemoryTearEvent.of(ts));
                    break;
            }
            return true;
        }
        return true;
    }

    processEOF(): void {
        try {
            this.currentMap && this.completeStaleMap();
        } catch (e) {
            logger.error(`error completing stale map`, e);
            this.currentMap = null;
        }
    }

    enterArea(areaInfo: AreaInfo): void {
        let currentMap = this.currentMap;
        {
            const prevMap = currentMap || this.recentMaps.last();
            if (prevMap && areaInfo.ts <= prevMap.start && prevMap.seed !== areaInfo.seed) {
                const delta = (areaInfo.ts - prevMap.start);
                // TODO sometimes kind of a false positive, this can happen within the same second (area failed to load + player spamming??)
                //  in which case it would be more correct to discard the prior map
                logger.warn(`new areas must be ingested chronologically, discarding current map (offset: ${delta / 1000}s).`, areaInfo, prevMap);
                this.currentMap = null;
                return;
            }
        }
        if (currentMap && currentMap.seed !== areaInfo.seed) {
            const delta = areaInfo.ts - currentMap.lastMarker!.ts;
            if (delta > STALE_MAP_THRESHOLD) {
                this.completeStaleMap();
                currentMap = null;
            }
        }

        if (areaInfo.isHideoutOrTown) {
            if (currentMap) {
                this.appendMarker(MapMarkerType.load, areaInfo.ts, areaInfo.uptimeMillis, areaInfo);
                this.dispatchEvent(HideoutEnteredEvent.of(areaInfo.ts, areaInfo.name));
            }
            return;
        }

        if (currentMap) {
            if (this.currentAreaInfo?.isHideoutOrTown) {
                this.appendMarker(MapMarkerType.load, areaInfo.ts, areaInfo.uptimeMillis, areaInfo);
                this.dispatchEvent(HideoutExitedEvent.of(areaInfo.ts));
            }
            if (areaInfo.seed === currentMap.seed) {
                this.appendMarker(MapMarkerType.load, areaInfo.ts, areaInfo.uptimeMillis, areaInfo);
                this.dispatchEvent(MapReenteredEvent.of(areaInfo.ts));
                return;
            }
            // player entered a map with a different seed, this can be inaccurate if player entered a map of another party member
            this.completeMap(currentMap, areaInfo.ts, areaInfo.uptimeMillis, this.currentUptimeId);
        }

        this.currentMap = new MapInstance(
            this.mapId++,
            areaInfo.name,
            areaInfo.level,
            areaInfo.seed
        );
        this.appendMarker(MapMarkerType.load, areaInfo.ts, areaInfo.uptimeMillis, areaInfo);
        this.dispatchEvent(MapEnteredEvent.of(areaInfo.ts));
    }

    private applyLoadedAt(ts: number, uptimeMillis: number): number {
        const map = this.currentMap;
        if (!map) throw new Error("no current map to apply loaded at");

        if (map.lastMarker?.type !== MapMarkerType.load) throw new Error(`expected map to be in LOAD state, but was in ${map.lastMarker?.type}`);

        const prevMarker = map.lastMarker;
        const newMarker = this.appendMarker(this.currentAreaInfo?.isHideoutOrTown ? MapMarkerType.hideout : MapMarkerType.map, ts, uptimeMillis);
        return MapInstance.getDelta(prevMarker, newMarker, MapTimePrecision.milliseconds);
    }

    private dispatchEvent(event: LogEvent) {
        this.recentEvents.push(event);
        this.eventDispatcher.emit(event);
    }

    private appendMarker(type: MapMarkerType, ts: number, uptimeMillis?: number, pendingAreaInfo?: AreaInfo): MapMarker {
        if (!this.currentMap) throw new Error("no current map to append marker to");

        if (type === MapMarkerType.load && !isFeatureSupportedAt(Feature.PostLoadIndicator, ts) && pendingAreaInfo) {
            type = pendingAreaInfo.isHideoutOrTown ? MapMarkerType.hideout : MapMarkerType.map;
        }
        const marker = new MapMarker(type, ts, uptimeMillis, this.currentUptimeId);
        this.currentMap.appendMarker(marker);
        return marker;
    }

    private completeMap(map: MapInstance, endTime: number, uptimeMillis?: number, uptimeId?: number): void {
        if (!map) throw new Error("no current map to complete");

        map.appendMarker(new MapMarker(MapMarkerType.complete, endTime, uptimeMillis, uptimeId));
        this.recentMaps.push(map);
        this.dispatchEvent(MapCompletedEvent.of(endTime, map));
    }

    private completeStaleMap(): void {
        const map = this.currentMap;
        if (!map) throw new Error("no current map to complete");

        const prevMarker = map.lastMarker!;
        let prevEvent: LogEvent | undefined;
        for (const event of this.recentEvents) {
            if (event.name === "logFileOpen" && event.ts > prevMarker.ts) {
                break;
            }
            prevEvent = event;
        }
        if (!prevEvent || prevMarker.ts > prevEvent.ts) {
            if (map.markers.findLast(m => m.type === MapMarkerType.map || m.type === MapMarkerType.hideout)?.type === MapMarkerType.map) {
                logger.warn(`stale map detected, client was exited while inside the map: ${JSON.stringify(map)}`);
            } else {
                // unaccounted time is the remaining hideout time after the hideout was entered
                // this may include hideout time of another, prior hideout, e.g.:
                // [MAP] => [DESERT HIDEOUT] => [MENAGERIE HIDEOUT] => [DESERT HIDEOUT] => [?]
                // (only this last block's hideout time would be unaccounted for)
                this.completeMap(map, prevMarker.ts, prevMarker.uptimeMillis, prevMarker.uptimeId);
            }
        } else {
            this.completeMap(map, prevEvent.ts);
        }
        this.currentMap = null;
    }

    // real time functions, no utility for analysis of logs

    getCurrentMap(): MapInstance | null {
        return this.currentMap;
    }

    pause(): void {
        const currentMap = this.currentMap;
        if (currentMap && currentMap.lastMarker.type !== MapMarkerType.pause) {
            this.appendMarker(MapMarkerType.pause, Date.now());
        }
    }

    unpause(): void {
        const currentMap = this.currentMap;
        if (currentMap && currentMap.markers.length >= 2) {
            const lastMarker = currentMap.markers[currentMap.markers.length - 1];
            if (lastMarker?.type === MapMarkerType.pause) {
                currentMap.resumePriorMarker(Date.now());
            }
        }
    }
}