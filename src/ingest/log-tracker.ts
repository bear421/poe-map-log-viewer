import { RingBuffer } from "../ringbuffer";
import { clearOffsetCache, parseTs, parseUptimeMillis } from "./ts-parser";
import { EventDispatcher } from "./event-dispatcher";
import { getZoneInfo } from "../data/zone_table";
import { BOSS_TABLE } from "../data/boss_table";
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
        return this.seed === 1;
    }

}

class XPSnapshot {
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

export class MapSpan {
    start: number;
    end?: number;
    areaEnteredAt: number | null;
    lastInteraction: number | null;
    hideoutStartTime: number | null;
    hideoutExitTime: number | null;
    hideoutTime: number;
    loadTime: number; 
    pauseTime: number;
    pausedAt: number | null;
    preloadTs: number | null = null;
    preloadUptimeMillis: number | null = null;

    constructor(
        start: number,
        end?: number,
        areaEnteredAt: number | null = null,
        lastInteraction: number | null = null,
        hideoutStartTime: number | null = null,
        hideoutExitTime: number | null = null,
        hideoutTime: number = 0,
        loadTime: number = 0,
        pauseTime: number = 0
    ) {
        if (end && end < start) {
            throw new Error("end time cannot be before start time");
        }

        this.start = start;
        this.end = end;
        this.areaEnteredAt = areaEnteredAt;
        this.lastInteraction = lastInteraction;
        this.hideoutStartTime = hideoutStartTime;
        this.hideoutExitTime = hideoutExitTime;
        this.hideoutTime = hideoutTime;
        this.loadTime = loadTime;
        this.pauseTime = pauseTime;
        this.pausedAt = null;
    }

    mapTime(end?: number): number {
        return MapSpan.mapTime(this, end);
    }

    /**
     * @returns time spent in the map, including idle time. i.e. duration between generation of this and the next map
     */
    static mapTimePlusIdle(span: MapSpan, end?: number): number {
        return MapSpan.baseTime(span, end);
    }

    /**
     * @returns time spent in the map, excluding idle time
     */
    static mapTime(span: MapSpan, end?: number): number {
        const baseTime = MapSpan.baseTime(span, end);
        const compactTime = baseTime - MapSpan.idleTime(span);
        if (compactTime < 0) {
            throw new Error(`invariant: map time minus idle time is negative: ${compactTime} (${JSON.stringify(span)})`);
        }
        return compactTime;
    }

    private static baseTime(span: MapSpan, end?: number): number {
        if (!end) {
            end = span.end;
        }
        if (!end) {
            if (span.hideoutStartTime) {
                end = span.hideoutStartTime;
            } else if (span.pausedAt) {
                end = span.pausedAt;
            } else {
                end = Date.now();
            }
        }
        const baseTime = end - span.start;
        if (baseTime < 0) {
            throw new Error(`invariant: map time is negative: ${baseTime}`);
        }
        return baseTime;
    }

    idleTime(): number {
        return MapSpan.idleTime(this);
    }

    /**
     * @returns time spent in hideout + loading + pausing
     */
    static idleTime(span: MapSpan): number {
        return span.hideoutTime + span.loadTime + span.pauseTime;
    }

    addToLoadTime(loadTime: number): void {
        if (loadTime < 0) {
            throw new Error("loadTime must be positive");
        }
        this.loadTime += loadTime;
    }

    addToHideoutTime(hideoutTime: number): void {
        if (hideoutTime < 0) {
            throw new Error("hideoutTime must be positive");
        }
        this.hideoutTime += hideoutTime;
    }

    addToPauseTime(pauseTime: number): void {
        if (pauseTime < 0) {
            throw new Error("pauseTime must be positive");
        }
        this.pauseTime += pauseTime;
    }
}

export enum AreaType {
    Map,
    Hideout,
    Campaign,
    Town,
    Sanctum,
    Labyrinth,
    Logbook,
    Tower,
    Delve,
    Unknown
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
    [AreaType.Logbook]: {
        name: "Logbook",
        icon: "bi-book",
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
    [AreaType.Unknown]: {   
        name: "Unknown",
        icon: "bi-question-circle",
        color: "text-dark"
    }
}

export const areaTypes = Object.values(AreaType).filter(v => typeof v === 'number') as AreaType[];

enum MapState {
    LOADING,
    ENTERED,
    UNLOADING,
    EXITED,
    COMPLETED
}

export class MapInstance {
    id: number;
    span: MapSpan;
    name: string;
    areaLevel: number;
    seed: number;
    areaType: AreaType;
    hasBoss: boolean = false;
    isUnique: boolean;
    state: MapState;

    constructor(
        id: number,
        span: MapSpan,
        name: string,
        areaLevel: number,
        seed: number,
    ) {
        if (!name?.trim()) {
            throw new Error("name must be a non-empty string");
        }
        if (areaLevel < 0) {
            throw new Error("areaLevel must be a positive integer");
        }

        this.id = id;
        this.span = span;
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
            } else if (MAP_NAME_LABYRINTH.test(lowerName)) {
                this.areaType = AreaType.Labyrinth;
            } else if (MAP_NAME_CAMPAIGN.test(lowerName)) {
                this.areaType = AreaType.Campaign;
            } else if (lowerName.startsWith("delve")) {
                this.areaType = AreaType.Delve;
            } else {
                this.areaType = AreaType.Unknown;
            }
        } else {
            if (MAP_NAME_TOWN.test(name)) {
                this.areaType = AreaType.Town;
            } else {
                this.areaType = AreaType.Hideout;
            }
        }
        this.isUnique = lowerName.startsWith("mapunique");
        this.state = MapState.LOADING;
    }

    inHideout(): boolean {
        return this.span.hideoutStartTime !== null;
    }

    inMap(): boolean {
        return !this.inHideout();
    }

    enterHideout(ts: number): void {
        this.span.hideoutStartTime = ts;
        this.span.hideoutExitTime = null;
        this.state = MapState.UNLOADING;
    }

    exitHideout(ts: number): void {
        if (this.span.hideoutStartTime) {
            this.span.addToHideoutTime(ts - this.span.hideoutStartTime);
        }
        this.span.hideoutStartTime = null;
        this.span.hideoutExitTime = ts;
        this.state = MapState.LOADING;
    }

    applyLoadedAt(ts: number, uptimeMillis: number): number {
        let delta;
        {
            const tsDelta = ts - this.span.preloadTs!;
            const uptimeDelta = uptimeMillis - this.span.preloadUptimeMillis!;
            if (Math.abs(uptimeDelta - tsDelta) <= 1000) {
                delta = uptimeDelta;
            } else {
                logger.warn(`tsDelta and uptimeDelta are too different: ${tsDelta} ${uptimeDelta} - using tsDelta instead`);
                delta = tsDelta;
            }
        }
        if (this.state === MapState.LOADING) {
            this.state = MapState.ENTERED;
        } else if (this.state === MapState.UNLOADING) {
            this.span.hideoutStartTime! += delta;
            this.state = MapState.EXITED;
        } else {
            throw new Error(`illegal state: ${this.state}, only call addLoadTime in LOADING or UNLOADING state`);
        }
        this.span.addToLoadTime(delta);
        return delta;
    }
    
    static label(map: MapInstance): string {
        switch (map.areaType) {
            case AreaType.Campaign:
                return getZoneInfo(map.name, map.areaLevel)?.label ?? "Campaign " + map.name;
            case AreaType.Town:
                return getZoneInfo(map.name, map.areaLevel)?.label ?? "Town " + map.name;
            case AreaType.Labyrinth:
                return "Labyrinth " + map.name.substring(0, 1);
        }
        const name = map.name.replace(/(^MapUnique)|(^MapWorlds)|(^Map)|(_NoBoss$)/gi, '');
        const words = name.match(/[A-Z][a-z]*|[a-z]+/g) || [];
        if (words.length === 0) {
            return name;
        }
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
        return AreaType.Unknown;
    }

}

// example 2024/12/06 18:02:40 ***** LOG FILE OPENING *****
const LOG_FILE_OPEN_REGEX = /\*\*\*\*\* LOG FILE OPENING \*\*\*\*\*$/;
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
}

/**
 * common prefix between all examples, note that the prefix "ends" with a space: 
 *                  2024/12/18 16:07:27 368045718 3ef2336f [INFO Client 18032] 
 * example logs:
 * MsgFrom            @From Player1: Hi, I would like to buy your Victory Grip, Pearl Ring listed for 5 divine in Standard (stash tab "Q1"; position: left 20, top 19)
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
 */

// if spaces are eventually allowed in character names, "[^ ]+" portions of patterns need to be changed to ".+"
// very important to fail fast on those patterns, e.g. avoid starting off with wildcard matches
// optional capturing groups BEFORE the named capturing group are not supported within the composite regex
const EVENT_PATTERNS = [
    `@From (?<g${EventCG.MsgFrom}>[^ ]+): (.*)`,
    `@To (?<g${EventCG.MsgTo}>[^ ]+): (.*)`,
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
    `(?<g${EventCG.MsgBoss}>${Object.keys(BOSS_TABLE).join("|")}):(.*)`,
    `(?!Error|Duration|#)(?<g${EventCG.MsgLocal}>[^\\]\\[ ]+):(.*)`,
    `Successfully allocated passive skill id: (?<g${EventCG.PassiveAllocated}>[^ ]+), name: (.+)`,
    `Successfully unallocated passive skill id: (?<g${EventCG.PassiveUnallocated}>[^ ]+), name: (.+)`,
    `: (?<g${EventCG.AFKModeOn}>)AFK mode is now ON\\.`,
    `: (?<g${EventCG.AFKModeOff}>)AFK mode is now OFF\\.`,
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
    private currentMap: MapInstance | null;

    constructor() {
        this.recentMaps = new RingBuffer<MapInstance>(100);
        this.currentMap = null;
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
            const totalMiB = progress.totalBytes / 1024 / 1024;
            console.info(`Search tested ${(totalMiB).toFixed(1)} MiB of logs in ${tookSeconds} seconds`);
        }
    }

    /**
     * Process a single log line.
     * @param line - The log line to process.
     * @param filter - The filter to apply to the log line.
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
                    this.dispatchEvent(LogFileOpenEvent.of(ts));
                }
            }
            return true;
        }

        const remainder = line.substring(rIx + 2);
        const postLoadMatch = (this.currentMap && (this.currentMap.state === MapState.LOADING || this.currentMap.state === MapState.UNLOADING)) 
            && POST_LOAD_REGEX.exec(remainder);
        if (postLoadMatch) {
            ts ??= parseTs(line);
            if (!ts) {
                logger.warn(`no timestamp found in post load match: ${line}`);
                return true;
            }
            const uptimeMillis = parseUptimeMillis(line);
            const delta = this.currentMap!.applyLoadedAt(ts, uptimeMillis);
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
                    this.dispatchEvent(MsgFromEvent.of(ts, m[offset], m[offset + 1]));
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
                        this.dispatchEvent(MsgGuildEvent.of(ts, localName.substring(1), m[offset + 1]));
                    } else {
                        this.dispatchEvent(MsgLocalEvent.of(ts, localName, m[offset + 1]));
                    }
                    break;
                case EventCG.MsgBoss:
                    const boss = BOSS_TABLE[m[offset]];
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
                    this.enterArea(new AreaInfo(
                        ts,
                        uptimeMillisGen, 
                        areaLevel,
                        mapName,
                        mapSeed
                    ));
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
                    this.dispatchEvent(AFKModeOnEvent.of(ts));
                    break;
                case EventCG.AFKModeOff:
                    this.dispatchEvent(AFKModeOffEvent.of(ts));
                    break;
            }
            this.informInteraction(ts);
            return true;
        }
        return true;
    }

    processEOF(): void {
        // TODO EOF map can undercount mapTime because hideoutStartTime precedes trailing POSTLOAD event
        const currentMap = this.currentMap;
        if (currentMap) {
            const end = Math.max(
                currentMap.span.hideoutStartTime ?? 0, 
                currentMap.span.lastInteraction ?? 0, 
                currentMap.span.pausedAt ?? 0
            );
            if (end && end > currentMap.span.start) {
                this.completeMap(currentMap, end);
                this.currentMap = null;
            }
        }
    }

    enterArea(areaInfo: AreaInfo): void {
        let currentMap = this.currentMap;
        {
            const prevMap = currentMap || this.recentMaps.last();
            if (prevMap && areaInfo.ts <= prevMap.span.start && prevMap.seed !== areaInfo.seed) {
                const delta = (areaInfo.ts - prevMap.span.start);
                // TODO sometimes kind of a false positive, this can happen within the same second (area failed to load + player spamming??)
                //  in which case it would be more correct to discard the prior map
                logger.warn(`new areas must be ingested chronologically, discarding current map: ${areaInfo.ts} (${areaInfo.name}) <= ${prevMap.span.start} (${prevMap.name}) (offset: ${delta / 1000}s).`);
                this.currentMap = null;
                return;
            }
        }
        if (currentMap && currentMap.seed !== areaInfo.seed) {
            // stale map handling, could possibly be made more accurate using client uptime millis
            const mapTime = currentMap.span.mapTime(areaInfo.ts);
            if (mapTime > STALE_MAP_THRESHOLD) {
                let endTime: number;
                if (currentMap.span.hideoutStartTime) {
                    // player exited client while in hideout
                    endTime = currentMap.span.hideoutStartTime;
                } else {
                    // player exited client while in map
                    const lastInteraction = currentMap.span.lastInteraction;
                    if (lastInteraction) {
                        if (lastInteraction > currentMap.span.start) {
                            endTime = lastInteraction;
                        } else {
                            logger.warn(`unable to determine stale map's end time: ${JSON.stringify(currentMap)}`);
                            endTime = areaInfo.ts;
                        }
                    } else if (currentMap.span.hideoutStartTime) {
                        endTime = currentMap.span.hideoutStartTime;
                    } else {
                        logger.warn(`unable to determine stale map's end time: ${JSON.stringify(currentMap)}`);
                        endTime = areaInfo.ts;
                    }
                }
                this.completeMap(currentMap, endTime);
                currentMap = this.currentMap = null;
            }
        }

        if (areaInfo.isHideoutOrTown) {
            if (currentMap) {
                currentMap.enterHideout(areaInfo.ts);
                currentMap.span.preloadTs = areaInfo.ts;
                currentMap.span.preloadUptimeMillis = areaInfo.uptimeMillis;
                this.dispatchEvent(HideoutEnteredEvent.of(areaInfo.ts, areaInfo.name));
            }
            return;
        }

        if (currentMap) {
            currentMap.span.areaEnteredAt = areaInfo.ts;
            currentMap.span.preloadTs = areaInfo.ts;
            currentMap.span.preloadUptimeMillis = areaInfo.uptimeMillis;
            if (currentMap.inHideout()) {
                currentMap.exitHideout(areaInfo.ts);
                this.dispatchEvent(HideoutExitedEvent.of(areaInfo.ts));
            }
            if (areaInfo.seed === currentMap.seed) {
                this.dispatchEvent(MapReenteredEvent.of(areaInfo.ts));
                return;
            }
            // player entered a map with a different seed, this can be inaccurate if player entered a map of another party member
            this.completeMap(currentMap, areaInfo.ts);
        }

        this.currentMap = new MapInstance(
            this.mapId++,
            new MapSpan(areaInfo.ts),
            areaInfo.name,
            areaInfo.level,
            areaInfo.seed
        );
        this.currentMap.span.preloadTs = areaInfo.ts;
        this.currentMap.span.preloadUptimeMillis = areaInfo.uptimeMillis;
        this.dispatchEvent(MapEnteredEvent.of(areaInfo.ts));
    }

    private dispatchEvent(event: LogEvent) {
        this.eventDispatcher.emit(event);
    }

    informInteraction(ts: number): void {
        // FIXME should also count during hideout to get more accurate campaign times (and hideout times)
        if (this.inMap()) {
            this.currentMap!.span.lastInteraction = ts;
        }
    }

    private completeMap(map: MapInstance, endTime: number): void {
        if (!map) throw new Error("no current map to complete");

        map.span.end = endTime;
        map.state = MapState.COMPLETED;
        this.recentMaps.push(map);
        this.dispatchEvent(MapCompletedEvent.of(map.span.start, map));
    }

    // real time functions, no utility for analysis of logs

    getCurrentMap(): MapInstance | null {
        return this.currentMap;
    }

    inHideout(): boolean {
        return this.currentMap ? this.currentMap.inHideout() : true;
    }

    inMap(): boolean {
        return !this.inHideout();
    }

    pause(): void {
        const currentMap = this.currentMap;
        if (currentMap && currentMap.inMap() && !currentMap.span.pausedAt) {
            currentMap.span.pausedAt = Date.now();
        }
    }

    unpause(): void {
        const currentMap = this.currentMap;
        if (!currentMap?.span.pausedAt) {
            return;
        }

        if (currentMap.inMap()) {
            const pauseDelta = Date.now() - currentMap.span.pausedAt;
            currentMap.span.addToPauseTime(pauseDelta);
            logger.info(`Unpaused with delta ${pauseDelta}`);
        } else {
            const hideoutStartTime = currentMap.span.hideoutStartTime;
            if (hideoutStartTime && hideoutStartTime > currentMap.span.pausedAt) {
                // don't double dip and don't count time during hideout as pause time, count it as hideout time
                const pauseDelta = hideoutStartTime - currentMap.span.pausedAt;
                currentMap.span.addToPauseTime(pauseDelta);
            } else {
                logger.warn(`invariant: unpausing hideout with paused_at ${currentMap.span.pausedAt} and hideout_start_time ${hideoutStartTime}`);
            }
        }
        currentMap.span.pausedAt = null;
    }
}