import { RingBuffer } from "./ringbuffer";
import { parseTs, clearOffsetCache, parseUptimeMillis } from "./ts-parser";
import { EventDispatcher } from "./event-dispatcher";
import { binarySearchRange } from "./binary-search";
import { getZoneInfo } from "./data/zone_table";
import { BOSS_TABLE } from "./data/boss_table";
import {
    LogEvent,
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
    XPSnapshotEvent
} from "./log-events";

class AreaInfo {
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

class MapSpan {
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

    static mapTime(span: MapSpan, end?: number): number {
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
        const compactTime = baseTime - MapSpan.idleTime(span);
        if (compactTime < 0) {
            throw new Error(`invariant: map time minus idle time is negative: ${compactTime} (${JSON.stringify(span)})`);
        }
        return compactTime;
    }

    idleTime(): number {
        return MapSpan.idleTime(this);
    }

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

enum AreaType {
    Map,
    Hideout,
    Campaign,
    Town,
    Sanctum,
    Logbook,
    Tower,
    Unknown
}

enum MapState {
    LOADING,
    ENTERED,
    UNLOADING,
    EXITED,
    COMPLETED
}

class MapInstance {
    id: string;
    span: MapSpan;
    name: string;
    areaLevel: number;
    seed: number;
    xpStart: number | null;
    xpGained: number;
    xph: number;
    waystone: any | null;
    hasBoss: boolean;
    state: MapState;

    constructor(
        id: string,
        span: MapSpan,
        name: string,
        areaLevel: number,
        seed: number,
        xpStart: number | null = null,
        xpGained: number = 0,
        xph: number = 0,
        waystone: any | null = null
    ) {
        if (!name?.trim()) {
            throw new Error("name must be a non-empty string");
        }
        if (areaLevel < 0) {
            throw new Error("areaLevel must be a positive integer");
        }
        if (xpStart !== null && xpStart < 0) {
            throw new Error("initialXp may not be negative");
        }

        this.id = id;
        this.span = span;
        this.name = name;
        this.areaLevel = areaLevel;
        this.seed = seed;
        this.xpStart = xpStart;
        this.xpGained = xpGained;
        this.xph = xph;
        this.waystone = waystone;
        this.hasBoss = !this.name.toLowerCase().endsWith("noboss") || this.name.toLowerCase().startsWith("uberboss");
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

    isUnlockableHideout(): boolean {
        return this.name.toLowerCase().endsWith("_claimable");
    }
    
    static label(map: MapInstance): string {
        const areaType = MapInstance.areaType(map);
        switch (areaType) {
            case AreaType.Campaign:
                return getZoneInfo(map.name)?.label ?? "Campaign " + map.name;
            case AreaType.Town:
                return getZoneInfo(map.name)?.label ?? "Town " + map.name;
        }
        const name = map.name.replace(/^Map/, '');
        const words = name.match(/[A-Z][a-z]*|[a-z]+/g) || [];
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

export interface TSRange {
    readonly lo: number;
    readonly hi: number;
}

export type Segmentation = TSRange[];
export namespace Segmentation {

    export function ofEvents(events: LogEvent[]): Segmentation {
        const res: TSRange[] = [];
        for (let i = 0; i < events.length - 1; i++) {
            res.push({lo: events[i].ts, hi: events[i + 1].ts});
        }
        return res;
    }

    export function merge(segmentation: Segmentation): Segmentation {
        if (segmentation.length <= 1) return segmentation;

        const res: Segmentation = [];
        for (let i = 0; i < segmentation.length; i++) {
            const range = segmentation[i];
            if (i + 1 >= segmentation.length) {
                res.push(range);
                break;
            }
            const nextRange = segmentation[i + 1];
            if (range.hi > nextRange.lo) {
                res.push({lo: range.lo, hi: nextRange.hi});
                i++;
            } else {
                res.push(range);
            }
        }
        return res;
    }

    export function toBoundingInterval(segmentation: Segmentation): Segmentation {
        if (segmentation.length <= 1) return segmentation;

        return [{lo: segmentation[0].lo, hi: segmentation[segmentation.length - 1].hi}];
    }

    export function intersectAll(segmentations: Segmentation[]): Segmentation {
        if (segmentations.length === 0) return [];

        return segmentations.reduce((a, b) => intersect(a, b), segmentations[0]);
    }
    
    export function intersect(a: Segmentation, b: Segmentation): Segmentation {
        const res: Segmentation = [];
        let iA = 0, iB = 0;
        for (;;) {
            const rangeA = a[iA], rangeB = b[iB];
            const lo = Math.max(rangeA.lo, rangeB.lo);
            const hi = Math.min(rangeA.hi, rangeB.hi);
            if (rangeA.hi > rangeB.hi) {
                lo < hi && res.push({lo, hi});
                if (++iB >= b.length) break;
            } else if (rangeB.hi < rangeA.hi) {
                lo < hi && res.push({lo, hi});
                if (++iA >= a.length) break;
            } else {
                lo < hi && res.push({lo, hi});
                if (++iA >= a.length || ++iB >= b.length) break;
            }
        }
        return res;
    }

}

class Filter {
    tsBounds?: Segmentation;
    fromAreaLevel?: number;
    toAreaLevel?: number;
    fromCharacterLevel?: number;
    toCharacterLevel?: number;
    character?: string;

    constructor(
        tsBounds?: Segmentation,
        fromAreaLevel?: number,
        toAreaLevel?: number,
        fromCharacterLevel?: number,
        toCharacterLevel?: number,
        character?: string
    ) {
        this.tsBounds = tsBounds;
        this.fromAreaLevel = fromAreaLevel;
        this.toAreaLevel = toAreaLevel;
        this.fromCharacterLevel = fromCharacterLevel;
        this.toCharacterLevel = toCharacterLevel;
        this.character = character;
    }

    withBounds(tsBounds: Segmentation): Filter {
        return new Filter(tsBounds, this.fromAreaLevel, this.toAreaLevel, this.fromCharacterLevel, this.toCharacterLevel, this.character);
    }

    static isEmpty(filter?: Filter): boolean {
        if (!filter) return true;

        let hasFiniteBounds;
        if (filter.tsBounds) {
            if (filter.tsBounds.length === 1) {
                hasFiniteBounds = filter.tsBounds[0].lo !== -Infinity || filter.tsBounds[0].hi !== Infinity;
            } else {
                hasFiniteBounds = filter.tsBounds.length > 1;
            }
        } else {
            hasFiniteBounds = false;
        }
        return !hasFiniteBounds && !filter.fromAreaLevel && !filter.toAreaLevel && !filter.character;
    }

    static testAreaLevel(map: MapInstance, filter?: Filter): boolean {
        if (!filter) return true;

        if (filter.fromAreaLevel && map.areaLevel < filter.fromAreaLevel) return false;

        if (filter.toAreaLevel && map.areaLevel > filter.toAreaLevel) return false;

        return true;
    }

    static filterMaps(maps: MapInstance[], filter: Filter): MapInstance[] {
        if (Filter.isEmpty(filter)) return maps; 

        const tsBounds = filter.tsBounds;
        if (!filter.fromAreaLevel && !filter.toAreaLevel && tsBounds) {
            let ix = 0, hiIx = maps.length - 1;
            const res = [];
            for (const {lo, hi} of tsBounds) {
                const { loIx: boundsLoIx, hiIx: boundsHiIx } = binarySearchRange(maps, lo, hi, (m) => m.span.start, ix, hiIx);
                if (boundsLoIx === -1) continue;

                const slice = Filter.sliceOrShare(maps, boundsLoIx, boundsHiIx + 1);
                if (tsBounds.length === 1) return slice;

                res.push(...slice);
                ix = boundsHiIx + 1;
            }
            return res;
        }
        const res = [];
        if (tsBounds) {
            let ix = 0, hiIx = maps.length - 1;
            for (const {lo, hi} of tsBounds) {
                const { loIx: boundsLoIx, hiIx: boundsHiIx } = binarySearchRange(maps, lo, hi, (m) => m.span.start, ix, hiIx);
                if (boundsLoIx === -1) continue;

                for (let i = boundsLoIx; i < boundsHiIx; i++) {
                    const map = maps[i];
                    if (filter.fromAreaLevel && map.areaLevel < filter.fromAreaLevel) {
                        continue;
                    }
                    if (filter.toAreaLevel && map.areaLevel > filter.toAreaLevel) {
                        continue;
                    }
                    res.push(map);
                }
                ix = boundsHiIx + 1;
            }
        } else {
            for (let i = 0; i < maps.length; i++) {
                const map = maps[i];
                if (filter.fromAreaLevel && map.areaLevel < filter.fromAreaLevel) {
                    continue;
                }
                if (filter.toAreaLevel && map.areaLevel > filter.toAreaLevel) {
                    continue;
                }
                res.push(map);
            }
        }
        return res;
    }

    static filterEvents(events: LogEvent[], filter: Filter): LogEvent[] {
        const tsBounds = filter.tsBounds;
        if (!tsBounds) return events;

        let ix = 0, hiIx = events.length - 1;
        const res = [];
        for (const {lo, hi} of tsBounds) {
            const { loIx: boundsLoIx, hiIx: boundsHiIx } = binarySearchRange(events, lo, hi, (e) => e.ts, ix, hiIx);

            if (boundsLoIx === -1) continue;

            const slice = Filter.sliceOrShare(events, boundsLoIx, boundsHiIx + 1);
            if (tsBounds.length === 1) return slice;
            
            res.push(...slice);
            ix = boundsHiIx + 1;
        }
        return res;
    }

    private static sliceOrShare<T>(array: T[], ix: number, endIx: number): T[] {
        if (ix === 0 && endIx === array.length - 1) {
            return array;
        }
        return array.slice(ix, endIx);
    }

}

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
    BonusGained,
    MsgBoss,
    MsgLocal
}

/**
 * common prefix between all examples, note that the prefix "ends" with a space: 
 *                  2024/12/18 16:07:27 368045718 3ef2336f [INFO Client 18032] 
 * example logs:
 * MsgFrom         @From Player1: Hi, I would like to buy your Victory Grip, Pearl Ring listed for 5 divine in Standard (stash tab "Q1"; position: left 20, top 19)
 * MsgTo           @To Player1: Hi, I would like to buy your Chalybeous Sapphire Ring of Triumph listed for 1 exalted in Standard (stash tab "~price 1 exalted"; position: left 1, top 19)
 * MsgParty        Generating level 1 area "G1_1" with seed 2665241567
 * TradeAccepted   : Trade accepted.
 * ItemsIdentified : 5 Items identified
 * Slain           : Player1 has been slain.
 * Joined          : Player1 has joined the area.
 * Left            : Player1 has left the area.
 * LevelUp         : Player1 (Sorceress) is now level 2
 * LevelUp         : Player1 (Stormweaver) is now level 100
 * PassiveGained   : You have received 2 Weapon Set Passive Skill Points.
 * PassiveGained   : You have received 2 Passive Skill Points.
 * PassiveGained   : You have received a Passive Skill Point.
 * BonusGained     : You have received +10% to [Resistances|Cold Resistance].
 * BonusGained     : You have received +30 to [Spirit|Spirit].
 * BonusGained     : You have received +20 to maximum Life.
 * BonusGained     : You have received +10% to [Resistances|Lightning Resistance].
 * BonusGained     : You have received +10% to [Resistances|Fire Resistance].
 * BonusGained     : You have received 8% increased maximum Life.
 * BossKill        Xesht, We That Are One: Ugh...! We That Failed...
 * BossKill        The Arbiter of Ash: The Mothersoul... Must prevail...
 * BossKill        Strange Voice: So be it. Keep your precious sanity, my agent of chaos. You shall serve me, whether you like it or not. I'm not going anywhere...
 * BossKill        Sirus, Awakener of Worlds: At least I felt something...
 * MsgLocal        Player1: hello
 */

// if spaces are eventually allowed in character names, "[^ ]+" portions of patterns need to be changed to ".+"
// very important to fail fast on those patterns, e.g. avoid starting off with wildcard matches
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
    `: You have received (?<g${EventCG.PassiveGained}>[0-9a-zA-Z]+) ?Passive Skill Points`, // weapon set passives are redundant with normal ones
    `(?<g${EventCG.MsgBoss}>${Object.keys(BOSS_TABLE).join("|")}):(.*)`,
    `(?!Error|Duration|#)(?<g${EventCG.MsgLocal}>[^\\]\\[ ]+):(.*)` 
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

const MAP_NAME_CAMPAIGN = /^(?:g\d+_|c_g|g_)/;
const MAP_NAME_TOWN = /^(g([a-z0-9]+)_town)$/;
const STALE_MAP_THRESHOLD = 6 * 60 * 60 * 1000; // 6 hours in milliseconds

const logger = console;

export interface Progress {
    totalBytes: number;
    bytesRead: number;
}

export class LogTracker {
    
    public eventDispatcher = new EventDispatcher();
    private recentMaps: RingBuffer<MapInstance>;
    private recentXpSnapshots: RingBuffer<XPSnapshot>;
    private currentMap: MapInstance | null;
    private nextWaystone: any | null;

    constructor() {
        this.recentMaps = new RingBuffer<MapInstance>(100);
        this.recentXpSnapshots = new RingBuffer<XPSnapshot>(100);
        this.currentMap = null;
        this.nextWaystone = null;
    }

    async ingestLogFile(file: File, onProgress?: (progress: Progress) => void): Promise<boolean> {
        const progress = {
            totalBytes: file.size,
            bytesRead: 0
        };
        const reader = file.stream().getReader();
        try {
            const decoder = new TextDecoder();
            let tail = '';
            for (;;) {
                const { done, value } = await reader.read();
                if (done) {
                    if (tail) {
                        this.processLogLine(tail);
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
                        if (!this.processLogLine(tail + chunk.slice(0, ix))) return false;

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
                    if (!this.processLogLine(line)) return false;
                }
                if (start < chunk.length) {
                    tail = chunk.slice(start);
                }
                progress.bytesRead += chunk.length;
                onProgress?.(progress);
            }
        } finally {
            reader.releaseLock();
            clearOffsetCache();
        }
    }

    async searchLogFile(pattern: RegExp, limit: number, file: File, onProgress?: (progress: { totalBytes: number, bytesRead: number }) => void, tsFilter?: TSRange): Promise<string[]> {
        const lines: string[] = [];
        const progress = {
            totalBytes: file.size,
            bytesRead: 0
        };
        const reader = file.stream().getReader();
        try {
            const decoder = new TextDecoder();
            let tail = '';
            let hadTsMatch = false;
            for (;;) {
                const { done, value } = await reader.read();
                const handleLine = (line: string) => {
                    if (tsFilter) {
                        const ts = parseTs(line);
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
                        lines.push(line);
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
                progress.bytesRead += chunk.length;
                onProgress?.(progress);
            }
        } finally {
            reader.releaseLock();
            clearOffsetCache();
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
        if (rIx === -1) return true;

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
                            this.dispatchEvent(BossKillEvent.of(ts, boss.alias ?? m[offset], m[offset + 1], this.currentMap!.areaLevel));
                        } else if (line.includes("how could")) {
                            console.log("Doryani", line);
                        }
                    }
                    break;
                case EventCG.Generating:
                    const uptimeMillisGen = parseUptimeMillis(line);
                    const areaLevel = parseInt(m[offset]);
                    const mapName = m[offset + 1];
                    const mapSeed = parseInt(m[offset + 2]);
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
                    } else {
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
                    this.dispatchEvent(PassiveGainedEvent.of(ts, passiveCount));
                    break;
                case EventCG.TradeAccepted:
                    this.dispatchEvent(TradeAcceptedEvent.of(ts));
                    break;
                case EventCG.ItemsIdentified:
                    this.dispatchEvent(ItemsIdentifiedEvent.of(ts, parseInt(m[offset])));
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
            const end = Math.max(currentMap.span.hideoutStartTime ?? 0, currentMap.span.lastInteraction ?? 0);
            if (end) {
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

        const initialXp = this.recentXpSnapshots.last()?.xp ?? null;
        this.currentMap = new MapInstance(
            crypto.randomUUID(),
            new MapSpan(areaInfo.ts),
            areaInfo.name,
            areaInfo.level,
            areaInfo.seed,
            initialXp,
            0,
            0,
            this.nextWaystone
        );
        this.currentMap.span.preloadTs = areaInfo.ts;
        this.currentMap.span.preloadUptimeMillis = areaInfo.uptimeMillis;
        this.nextWaystone = null;
        this.dispatchEvent(MapEnteredEvent.of(areaInfo.ts));
    }

    private dispatchEvent(event: LogEvent) {
        this.eventDispatcher.emit(event);
    }

    informInteraction(ts: number): void {
        if (this.inMap()) {
            this.currentMap!.span.lastInteraction = ts;
        }
    }

    private completeMap(map: MapInstance, endTime: number): void {
        if (!map) throw new Error("no current map to complete");

        map.span.end = endTime;
        map.state = MapState.COMPLETED;
        const xpEnd = this.recentXpSnapshots.last()?.xp;
        if (xpEnd) {
            const mapTimeMs = map.span.mapTime();
            map.xpGained = (xpEnd && map.xpStart) ? (xpEnd - map.xpStart) : 0;
            map.xph = mapTimeMs > 0 ? (map.xpGained / mapTimeMs) * 3600 * 1000 : 0;
        }
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

    setNextWaystone(item: any): void {
        if (!item) {
            throw new TypeError("item must be an Item object");
        }
        this.nextWaystone = item;
    }

    getNextWaystone(): any | null {
        return this.nextWaystone;
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

    applyXpSnapshot(xp: number, ts: number | null = null, source: string | null = null, encounterType: string | null = null): XPSnapshot {
        if (ts === null) {
            ts = Date.now();
        }
        if (xp < 0) {
            throw new Error("xp must be a positive integer");
        }
        const prev = this.recentXpSnapshots.last() ?? null;
        const prevXp = prev?.xp ?? null;
        const delta = prevXp !== null ? xp - prevXp : 0;

        if (source === "ladder" && prev) {
            const timeDiff = (prev.ts - ts) / 1000; // Convert to seconds
            if (prev.source !== source && delta < 0 && timeDiff <= 300) {
                logger.info(`skipping ladder XP snapshot with negative delta (prev was non-ladder), delta: ${delta}`);
                return prev;
            }
        }

        const currentMap = this.currentMap;
        const areaLevel = currentMap?.areaLevel ?? null;

        const snapshot = new XPSnapshot(
            crypto.randomUUID(),
            ts,
            xp,
            delta,
            areaLevel,
            source,
            encounterType
        );

        this.recentXpSnapshots.push(snapshot);
        this.dispatchEvent(XPSnapshotEvent.of(ts, snapshot));

        if (currentMap) {
            if (currentMap.xpStart !== null) {
                const xpGained = xp ? (xp - currentMap.xpStart) : 0;
                currentMap.xpGained = xpGained;
            } else {
                const delta = ts - currentMap.span.start - currentMap.span.idleTime();
                // grace period if user takes snapshot after entering map
                if (delta <= 30000) { // 30 seconds in milliseconds
                    currentMap.xpStart = xp;
                }
            }
        }

        return snapshot;
    }
}

export {
    XPSnapshot,
    MapSpan,
    MapInstance,
    AreaInfo,
    Filter
};