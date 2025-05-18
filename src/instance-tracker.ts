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

    get isMap(): boolean {
        return this.seed > 1;
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
                return "Campaign " + map.name;
            case AreaType.Town:
                return "Town " + map.name;
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

class Filter {
    fromMillis?: number;
    toMillis?: number;
    fromAreaLevel?: number;
    toAreaLevel?: number;

    constructor(
        fromMillis?: number,
        toMillis?: number,
        fromAreaLevel?: number,
        toAreaLevel?: number
    ) {
        this.fromMillis = fromMillis;
        this.toMillis = toMillis;
        this.fromAreaLevel = fromAreaLevel;
        this.toAreaLevel = toAreaLevel;
    }

    static isEmpty(filter?: Filter): boolean {
        if (!filter) return true;

        return !filter.fromMillis && !filter.toMillis && !filter.fromAreaLevel && !filter.toAreaLevel;
    }

    static testAreaLevel(map: MapInstance, filter?: Filter): boolean {
        if (!filter) return true;

        if (filter.fromAreaLevel && map.areaLevel < filter.fromAreaLevel) return false;

        if (filter.toAreaLevel && map.areaLevel > filter.toAreaLevel) return false;

        return true;
    }

    static filterMaps(maps: MapInstance[], filter?: Filter): MapInstance[] {
        if (!filter || Filter.isEmpty(filter)) return maps; 

        let ix = 0;
        if (filter.fromMillis) {
            // find starting index via binary search when filtering lower bound
            let left = 0, right = maps.length - 1, startIx = maps.length;
            while (left <= right) {
                const mid = Math.floor((left + right) / 2);
                if (maps[mid].span.start >= filter.fromMillis) {
                    startIx = mid;
                    right = mid - 1;
                } else {
                    left = mid + 1;
                }
            }
            if (ix >= maps.length) return [];

            ix = startIx;
        }
        let endIx = maps.length;
        if (filter.toMillis) {
            let left = ix, right = maps.length - 1;
            while (left <= right) {
                const mid = Math.floor((left + right) / 2);
                if (maps[mid].span.start <= filter.toMillis) {
                    left = mid + 1;
                } else {
                    endIx = mid;
                    right = mid - 1;
                }
            }
        } else if (!filter.fromAreaLevel && !filter.toAreaLevel) {
            return maps.slice(ix);
        }
        const res = [];
        for (let i = ix; i < endIx; i++) {
            const map = maps[i];
            if (filter.fromAreaLevel && map.areaLevel < filter.fromAreaLevel) {
                continue;
            }
            if (filter.toAreaLevel && map.areaLevel > filter.toAreaLevel) {
                continue;
            }
            res.push(map);
        }
        return res;
    }

    static filterEvents(events: LogEvent[], filter?: Filter): LogEvent[] {
        if (!filter || Filter.isEmpty(filter)) return events; 

        let ix = 0;
        if (filter.fromMillis) {
            ix = binarySearch(events, filter.fromMillis, (event) => event.ts, BinarySearchMode.FIRST);
        }
        let endIx = events.length;
        if (filter.toMillis) {
            endIx = binarySearch(events, filter.toMillis, (event) => event.ts, BinarySearchMode.LAST, ix);
        }
        return events.slice(ix, endIx);
    }

}

// example 2024/12/06 21:38:54 35930140 403248f7 [INFO Client 1444] [SHADER] Delay: ON
const POST_LOAD_REGEX = new RegExp(`\\[SHADER\\] Delay:`, "i");

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
    LevelUp         
}

/**
 * example logs:
 * MsgFrom:         2024/12/18 16:07:27 368045718 3ef2336f [INFO Client 18032] @From Player1: Hi, I would like to buy your Victory Grip, Pearl Ring listed for 5 divine in Standard (stash tab "Q1"; position: left 20, top 19)
 * MsgTo:           2024/12/09 17:20:32 161926000 3ef2336d [INFO Client 12528] @To Player1: Hi, I would like to buy your Chalybeous Sapphire Ring of Triumph listed for 1 exalted in Standard (stash tab "~price 1 exalted"; position: left 1, top 19)
 * MsgParty:        2024/12/08 16:07:33 125147609 3ef2336d [INFO Client 12528] %Player1: meow
 * Generating:      2024/12/06 21:38:41 35916765 2caa1679 [DEBUG Client 1444] Generating level 1 area "G1_1" with seed 2665241567
 * TradeAccepted:   2024/12/06 23:53:01 43976781 3ef2336d [INFO Client 19904] : Trade accepted.
 * ItemsIdentified: 2024/12/07 01:41:51 50507140 3ef2336d [INFO Client 18244] : 5 Items identified
 * Slain:           2024/12/06 23:47:07 43622984 3ef2336d [INFO Client 19904] : Player1 has been slain.
 * Joined:          2024/12/06 23:05:09 41105484 3ef2336d [INFO Client 22004] : Player1 has joined the area.
 * Left:            2024/12/06 23:12:20 41536000 3ef2336d [INFO Client 22004] : Player1 has left the area.
 * LevelUp:         2024/12/06 22:44:59 39895562 3ef2336d [INFO Client 2636] : Player1 (Sorceress) is now level 2
 * LevelUp:         2025/02/10 09:47:04 937716484 3ef2336a [INFO Client 13352] : Player1 (Stormweaver) is now level 100
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
    `: (?<g${EventCG.LevelUp}>[^ ]+) \\(([^)]+)\\) is now level (\\d+)`
];

// Runtime check to ensure EVENT_PATTERNS are correctly aligned with EventCG numeric values
// TODO maybe implement this a bit better, technically unnecessary, could simply reorder offset table
for (let i = 0; i < EVENT_PATTERNS.length; i++) {
    const pattern = EVENT_PATTERNS[i];
    const expectedNamedGroup = `(?<g${i}>`;
    if (!pattern.includes(expectedNamedGroup)) {
        throw new Error(`pattern ${pattern} is missing named capture group ${expectedNamedGroup}`);
    }
}

const COMPOSITE_EV_REGEX = new RegExp(`] (?:` + EVENT_PATTERNS.map(p => `(${p})`).join("|") + `)`);
const COMPOSITE_PATTERN_OFFSETS: number[] = [];
{
    let currentOffset = 2; // own group + enclosing group
    for (const pattern of EVENT_PATTERNS) {
        COMPOSITE_PATTERN_OFFSETS.push(currentOffset);
        const captureGroupCount = new RegExp("^|" + pattern).exec("")!.length!;
        currentOffset += captureGroupCount;
    }
}

const MAP_NAME_CAMPAIGN = /^([cg]\d?_g?([a-z0-9]+)_?([a-z0-9]*)_?([a-z0-9]*))$/;
const MAP_NAME_TOWN = /^(g([a-z0-9]+)_town)$/;
const STALE_MAP_THRESHOLD = 6 * 60 * 60 * 1000; // 6 hours in milliseconds

const logger = console;

import { RingBuffer } from "./ringbuffer";
import { parseTs, clearOffsetCache, parseUptimeMillis } from "./ts-parser";
import { EventDispatcher, LogEvent } from "./event-dispatcher";
import { binarySearch, BinarySearchMode } from "./binary-search";

class InstanceTracker {
    
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

    async processLogFile(file: File, filter?: Filter): Promise<boolean> {
        if (Filter.isEmpty(filter)) {
            filter = undefined;
        } else {
            // create defensive copy since instance-tracker may modify filter
            filter = new Filter(filter!.fromMillis, filter!.toMillis, filter!.fromAreaLevel, filter!.toAreaLevel);
        }
        const reader = file.stream().getReader();
        try {
            const decoder = new TextDecoder();
            let tail = '';
            for (;;) {
                const { done, value } = await reader.read();
                if (done) {
                    if (tail) {
                        this.processLogLine(tail, filter);
                    }
                    this.processEOF(filter);
                    return true;
                }
                const chunk = decoder.decode(value, { stream: true });
                let start = 0;
                let ix: number;
                if (tail) {
                    ix = chunk.indexOf('\n');
                    if (ix !== -1) {
                        if (!this.processLogLine(tail + chunk.slice(0, ix), filter)) return false;

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
                    if (!this.processLogLine(line, filter)) return false;
                }
                if (start < chunk.length) {
                    tail = chunk.slice(start);
                }
            }
        } finally {
            reader.releaseLock();
            clearOffsetCache();
        }
    }

    async searchLogFile(pattern: RegExp, limit: number, file: File, filter?: Filter): Promise<string[]> {
        const lines: string[] = [];
        const reader = file.stream().getReader();
        try {
            const decoder = new TextDecoder();
            let tail = '';
            let seekAhead = filter && !!filter.fromMillis;
            for (;;) {
                const { done, value } = await reader.read();
                if (done) {
                    if (tail) {
                        if (pattern.test(tail)) {
                            lines.push(tail);
                            if (limit > 0 && lines.length >= limit) {
                                return lines;
                            }
                        }
                    }
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
                        if (pattern.test(line)) {
                            lines.push(line);
                            if (limit > 0 && lines.length >= limit) {
                                return lines;
                            }
                        }
                    } else {
                        tail += chunk;
                        continue;
                    }
                }
                while ((ix = chunk.indexOf('\n', start)) !== -1) {
                    const line = chunk.slice(start, ix);
                    start = ix + 1;
                    if (seekAhead) {
                        const ts = parseTs(line);
                        if (ts && ts >= filter!.fromMillis!) {
                            // logfiles are chronologically ordered, so we don't need to test fromMillis anymore
                            seekAhead = false;
                        } else {
                            continue;
                        }
                    }
                    if (pattern.test(line)) {
                        lines.push(line);
                        if (limit > 0 && lines.length >= limit) {
                            return lines;
                        }
                    }
                }
                if (start < chunk.length) {
                    tail = chunk.slice(start);
                }
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
    processLogLine(line: string, filter?: Filter): boolean {
        try {
            return this.processLogLineUnchecked(line, filter);
        } catch (e) {
            logger.error(`error processing log line, discarding current map: ${line}`, e);
            this.currentMap = null;
            return true;
        }
    }

    private processLogLineUnchecked(line: string, filter?: Filter): boolean {
        let ts;
        if (filter && (filter.fromMillis || filter.toMillis)) {
            ts = parseTs(line);
            if (ts) {
                if (filter.fromMillis && ts < filter.fromMillis) {
                    filter.fromMillis = undefined;
                }
                if (filter.toMillis && ts > filter.toMillis) return false;
            }
        }
        const postLoadMatch = (this.currentMap && (this.currentMap.state === MapState.LOADING || this.currentMap.state === MapState.UNLOADING)) && POST_LOAD_REGEX.exec(line);
        if (postLoadMatch) {
            ts ??= parseTs(line);
            if (!ts) {
                logger.warn(`no timestamp found in post load match: ${line}`);
                return true;
            }
            const uptimeMillis = parseUptimeMillis(line);
            const delta = this.currentMap!.applyLoadedAt(ts, uptimeMillis);
            this.dispatchEvent("areaPostLoad", ts, { delta });
        } else {
            const m = COMPOSITE_EV_REGEX.exec(line);
            if (!m) return true;

            ts ??= parseTs(line);
            if (!ts) {
                logger.warn(`no timestamp found in event match: ${line}`);
                return true;
            }
            const g = m.groups!;
            const strGroup = Object.keys(g).find(k => g[k] !== undefined)!;
            const eventCG = parseInt(strGroup.substring(1), 10) as EventCG;
            const offset = COMPOSITE_PATTERN_OFFSETS[eventCG];
            switch (eventCG) {
                case EventCG.MsgFrom:
                    this.dispatchEvent("msgFrom", ts, { character: m[offset], msg: m[offset + 1] });
                    break;
                case EventCG.MsgTo:
                    this.dispatchEvent("msgTo", ts, { character: m[offset], msg: m[offset + 1] });
                    break;
                case EventCG.MsgParty:
                    this.dispatchEvent("msgParty", ts, { character: m[offset], msg: m[offset + 1] });
                    break;
                case EventCG.Generating:
                    const uptimeMillis = parseUptimeMillis(line);
                    const areaLevel = parseInt(m[offset]);
                    const mapName = m[offset + 1];
                    const mapSeed = parseInt(m[offset + 2]);
                    this.enterArea(new AreaInfo(
                        ts,
                        uptimeMillis,
                        areaLevel,
                        mapName,
                        mapSeed
                    ), filter);
                    break;
                case EventCG.Slain:
                    this.dispatchEvent("death", ts, { character: m[offset] });
                    break;
                case EventCG.Joined:
                    this.dispatchEvent("joinedArea", ts, { character: m[offset] });
                    break;
                case EventCG.Left:
                    this.dispatchEvent("leftArea", ts, { character: m[offset] });
                    break;
                case EventCG.LevelUp:
                    this.dispatchEvent("levelUp", ts, { character: m[offset], ascendancy: m[offset + 1], level: m[offset + 2] });
                    break;
                case EventCG.TradeAccepted:
                    this.dispatchEvent("tradeAccepted", ts);
                    break;
                case EventCG.ItemsIdentified:
                    this.dispatchEvent("itemsIdentified", ts, { count: parseInt(m[offset]) });
                    break;
            }
            this.informInteraction(ts);
            return true;
        }
        return true;
    }

    processEOF(filter?: Filter): void {
        // TODO EOF map can undercount mapTime because hideoutStartTime precedes trailing POSTLOAD event
        const currentMap = this.currentMap;
        if (currentMap) {
            const end = Math.max(currentMap.span.hideoutStartTime ?? 0, currentMap.span.lastInteraction ?? 0);
            if (end) {
                this.completeMap(currentMap, end, filter);
                this.currentMap = null;
            }
        }
    }

    enterArea(areaInfo: AreaInfo, filter?: Filter): void {
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
                this.completeMap(currentMap, endTime, filter);
                currentMap = this.currentMap = null;
            }
        }

        if (!areaInfo.isMap) {
            if (currentMap) {
                currentMap.enterHideout(areaInfo.ts);
                currentMap.span.preloadTs = areaInfo.ts;
                currentMap.span.preloadUptimeMillis = areaInfo.uptimeMillis;
                this.dispatchEvent("hideoutEntered", areaInfo.ts);
            }
            return;
        }

        if (currentMap) {
            currentMap.span.areaEnteredAt = areaInfo.ts;
            currentMap.span.preloadTs = areaInfo.ts;
            currentMap.span.preloadUptimeMillis = areaInfo.uptimeMillis;
            if (currentMap.inHideout()) {
                currentMap.exitHideout(areaInfo.ts);
                this.dispatchEvent("hideoutExited", areaInfo.ts);
            }
            if (areaInfo.seed === currentMap.seed) {
                this.dispatchEvent("mapReentered", areaInfo.ts);
                return;
            }
            // player entered a map with a different seed, this can be inaccurate if player entered a map of another party member
            this.completeMap(currentMap, areaInfo.ts, filter);
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
        this.dispatchEvent("mapEntered", areaInfo.ts);
    }

    private dispatchEvent(name: string, ts: number, detail: any = {}) {
        const event = {name, detail, ts};
        this.eventDispatcher.emit(event);
    }

    informInteraction(ts: number): void {
        if (this.inMap()) {
            this.currentMap!.span.lastInteraction = ts;
        }
    }

    private completeMap(map: MapInstance, endTime: number, filter?: Filter): void {
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
        if (Filter.testAreaLevel(map, filter)) {
            this.dispatchEvent("mapCompleted", map.span.start, { map });
        }
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
        this.dispatchEvent("xpSnapshot", ts, { snapshot });

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
    InstanceTracker,
    Filter
};