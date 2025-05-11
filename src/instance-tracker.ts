class AreaInfo {
    ts: number;
    level: number;
    name: string;
    seed: number;

    constructor(
        ts: number,
        areaLevel: number,
        name: string,
        seed: number
    ) {
        this.ts = ts;
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
        const totalTime = end - span.start;
        if (totalTime < 0) {
            throw new Error(`invariant: map time is negative: ${totalTime}`);
        }
        return totalTime - MapSpan.idleTime(span);
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
    Sanctum,
    Logbook,
    Tower,
    Unknown
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
    events = [];

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
    }

    get areaType(): AreaType {
        const towerMaps = [
            "maplosttowers",
            "mapmesa",
            "mapalpineridge",
            "mapbluff",
            "mapswamptower"
        ];
        const name = this.name.toLowerCase();
        if (towerMaps.includes(name)) {
            return AreaType.Tower;
        } else if (name.startsWith("map")) {
            return AreaType.Map;
        } else if (name.startsWith("sanctum")) {
            return AreaType.Sanctum;
        } else if (name.startsWith("expeditionlogbook")) {
            return AreaType.Logbook;
        } else if (MAP_NAME_CAMPAIGN.test(this.name)) {
            return AreaType.Campaign;
        } else {
            return AreaType.Unknown;
        }
    }

    inHideout(): boolean {
        return this.span.hideoutStartTime !== null;
    }

    inMap(): boolean {
        return !this.inHideout();
    }

    get mapLabel(): string {
        const map_name = this.name.replace(/^Map/, '');
        const words = map_name.match(/[A-Z][a-z]*|[a-z]+/g) || [];
        return words.join(' ');
    }

    enterHideout(ts: number): void {
        this.span.hideoutStartTime = ts;
        this.span.hideoutExitTime = null;
    }

    exitHideout(ts: number): void {
        if (this.span.hideoutStartTime) {
            this.span.addToHideoutTime(ts - this.span.hideoutStartTime);
        }
        this.span.hideoutStartTime = null;
        this.span.hideoutExitTime = ts;
    }

    isUnlockableHideout(): boolean {
        return this.name.toLowerCase().endsWith("_claimable");
    }

}

class Filter {
    fromMillis?: number;
    toMillis?: number;
    fromAreaLevel?: number;
    toAreaLevel?: number;

    static filterAll(filter: Filter, maps: MapInstance[]): MapInstance[] {
        let seekAhead = filter && !!filter.fromMillis;
        const res = [];
        for (const map of maps) {
            if (seekAhead) {
                if (map.span.start < filter.fromMillis!) {
                    continue;
                } else {
                    seekAhead = false;
                }
            }
            if (filter.toMillis && map.span.start > filter.toMillis) {
                break;
            }
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

}

const TS_REGEX = new RegExp("^(\\d{4}/\\d{2}/\\d{2} \\d{2}:\\d{2}:\\d{2})");
const MAP_ENTRY_REGEX = new RegExp(`Generating level (\\d+) area \"(.+?)\"(?:.*seed (\\d+))?`, "i");
const POST_LOAD_REGEX = new RegExp(`\\[SHADER\\] Delay:`, "i");
const EV_SLAIN_REGEX = new RegExp(`: (.*?) has been slain`, "i");
const EV_JOINED_AREA_REGEX = new RegExp(`: (.*?) has joined the area`, "i");
const EV_LEFT_AREA_REGEX = new RegExp(`: (.*?) has left the area`, "i");
const EV_LEVEL_UP_REGEX = new RegExp(`: (.*?) \\((.*?)\\) is now level (\\d+)`, "i");
const EV_TRADE_ACCEPTED = new RegExp(`: Trade accepted.`, "i");
const MAP_NAME_CAMPAIGN = new RegExp(`^(g\\d*_)|(c\\d*_)`);
const STALE_MAP_THRESHOLD = 6 * 60 * 60 * 1000; // 6 hours in milliseconds

const logger = console;

import { RingBuffer } from "./ringbuffer";

class InstanceTracker {
    
    private events: EventTarget;
    private recentMaps: RingBuffer<MapInstance>;
    private recentXpSnapshots: RingBuffer<XPSnapshot>;
    private currentMap: MapInstance | null;
    private nextWaystone: any | null;

    constructor() {
        this.events = new EventTarget();
        this.recentMaps = new RingBuffer<MapInstance>(100);
        this.recentXpSnapshots = new RingBuffer<XPSnapshot>(100);
        this.currentMap = null;
        this.nextWaystone = null;
    }

    processLogLinesRev(reverseLines: string[]): void {
        const lines: string[] = [];
        for (const line of reverseLines) {
            lines.push(line);
            if (MAP_ENTRY_REGEX.test(line)) {
                break;
            }
        }
        lines.reverse().forEach(line => this.processLogLine(line));
    }

    async processLogFile(file: File, filter?: Filter): Promise<boolean> {
        const reader = file.stream().getReader();
        try {
            const decoder = new TextDecoder();
            let tail = '';
            let seekAhead = filter && !!filter.fromMillis;
            for (;;) {
                const { done, value } = await reader.read();
                if (done) {
                    if (tail) {
                        this.processLogLine(tail, filter);
                    }
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
                    if (seekAhead) {
                        const ts = this.parseTs(line);
                        if (ts && ts >= filter!.fromMillis!) {
                            // logfiles are chronologically ordered, so we don't need to test fromMillis anymore
                            seekAhead = false;
                        } else {
                            continue;
                        }
                    }
                    if (!this.processLogLine(line, filter)) return false;
                }
                if (start < chunk.length) {
                    tail = chunk.slice(start);
                }
            }
        } finally {
            reader.releaseLock();
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
                        const ts = this.parseTs(line);
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
        }
    }

    private parseTs(line: string): number | null {
        const tsMatch = TS_REGEX.exec(line);
        if (!tsMatch) return null;

        return new Date(tsMatch[1].replace(/\//g, '-')).getTime();
    }

    /**
     * Process a single log line.
     * @param line - The log line to process.
     * @param filter - The filter to apply to the log line.
     * @returns false, if the filter would reject subsequent lines (toMillis filtering).
     */
    processLogLine(line: string, filter?: Filter): boolean {
        let ts;
        if (filter && !!filter.toMillis) {
            ts = this.parseTs(line);
            if (ts && ts > filter.toMillis) {
                return false;
            }
        }
        const mapMatch = MAP_ENTRY_REGEX.exec(line);
        if (mapMatch) {
            ts ??= this.parseTs(line);
            if (!ts) throw new Error(`no timestamp found in map match: ${line}`);

            const areaLevel = parseInt(mapMatch[1]);
            const mapName = mapMatch[2];
            const mapSeed = parseInt(mapMatch[3]);
            this.enterArea(new AreaInfo(
                ts,
                areaLevel,
                mapName,
                mapSeed
            ));
        } else if (this.currentMap) {
            const postLoadMatch = POST_LOAD_REGEX.exec(line);
            if (postLoadMatch) {
                if (this.currentMap && this.currentMap.span.areaEnteredAt) {
                    const postLoadTs = this.parseTs(line);
                    if (!postLoadTs) throw new Error(`no timestamp found in post load match: ${line}`);

                    const enteredAt = this.currentMap.span.areaEnteredAt;
                    const loadDelta = postLoadTs - enteredAt;
                    // logger.info(`load delta: ${loadDelta}`);
                    if (loadDelta >= 0) {
                        this.currentMap.span.addToLoadTime(loadDelta);
                        this.dispatchEvent("areaPostLoad", { loadDelta });
                    } else {
                        logger.warn(`load delta is negative: ${loadDelta}`);
                    }
                }
            } else if (this.currentMap.span.loadTime) {
                ts ??= this.parseTs(line);
                if (ts) {
                    this.informInteraction(ts);
                    const slainMatch = EV_SLAIN_REGEX.exec(line);
                    if (slainMatch) {
                        this.dispatchEvent("death", { event: "death", character: slainMatch[1], ts: ts });
                        return true;
                    }
                    const joinedMatch = EV_JOINED_AREA_REGEX.exec(line);
                    if (joinedMatch) {
                        this.dispatchEvent("joinedArea", { event: "joinedArea", character: joinedMatch[1], ts: ts });
                        return true;
                    }
                    const leftMatch = EV_LEFT_AREA_REGEX.exec(line);
                    if (leftMatch) {
                        this.dispatchEvent("leftArea", { event: "leftArea", character: leftMatch[1], ts: ts });
                        return true;
                    }
                    const levelMatch = EV_LEVEL_UP_REGEX.exec(line);
                    if (levelMatch) {
                        this.dispatchEvent("levelUp", { event: "levelUp", character: levelMatch[1], level: levelMatch[2], ts: ts });
                        return true;
                    }
                    const tradeAcceptedMatch = EV_TRADE_ACCEPTED.exec(line);
                    if (tradeAcceptedMatch) {
                        this.dispatchEvent("tradeAccepted", { event: "tradeAccepted", ts: ts });
                        return true;
                    }
                }
            }
        }
        return true;
    }

    enterArea(areaInfo: AreaInfo): void {
        const currentMap = this.currentMap;
        if (currentMap && areaInfo.ts <= currentMap.span.start && currentMap.seed !== areaInfo.seed) {
            throw new Error(`new areas must be entered in chronological order: ${areaInfo.ts} <= ${currentMap.span.start}`);
        }
        if (currentMap && currentMap.seed !== areaInfo.seed) {
            // stale map handling
            const mapTime = currentMap.span.mapTime(areaInfo.ts);
            let endTime: number | null = null;
            
            if (mapTime > STALE_MAP_THRESHOLD) {
                if (currentMap.span.hideoutStartTime) {
                    // player exited client while in hideout
                    endTime = currentMap.span.hideoutStartTime;
                } else {
                    // player exited client while in map
                    const lastInteraction = currentMap.span.lastInteraction;
                    if (lastInteraction) {
                        if (lastInteraction >= currentMap.span.start) {
                            endTime = lastInteraction;
                        } else {
                            logger.warn(`unable to determine stale map's end time: ${currentMap}`);
                            endTime = areaInfo.ts;
                        }
                    } else if (currentMap.span.hideoutStartTime) {
                        endTime = currentMap.span.hideoutStartTime;
                    } else {
                        logger.warn(`unable to determine stale map's end time: ${currentMap}`);
                        endTime = areaInfo.ts;
                    }
                }
                this.completeCurrentMap(endTime);
                this.currentMap = null;
                return;
            }
        }

        this.dispatchEvent("areaEntered", { areaInfo });

        if (!areaInfo.isMap) {
            if (currentMap) {
                currentMap.enterHideout(areaInfo.ts);
                this.dispatchEvent("hideoutEntered", { map: currentMap });
            }
            return;
        }

        if (currentMap) {
            currentMap.span.areaEnteredAt = areaInfo.ts;
            if (currentMap.inHideout()) {
                currentMap.exitHideout(areaInfo.ts);
                this.dispatchEvent("hideoutExited", { map: currentMap });
            }
            if (areaInfo.seed === currentMap.seed) {
                this.dispatchEvent("mapReentered", { map: currentMap });
                return;
            }
            // player entered a map with a different seed, this can be inaccurate if player entered a map of another party member
            this.completeCurrentMap(areaInfo.ts);
        }

        const initialXp = this.recentXpSnapshots.last()?.xp ?? null;
        const previousMap = currentMap;
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
        this.nextWaystone = null;
        this.dispatchEvent("mapEntered", { map: this.currentMap, previousMap });
    }

    private dispatchEvent(name: string, detail: any): boolean {
        /*
        if (detail.map) {
            detail.map.events.push(detail);
        }
        */
        return this.events.dispatchEvent(new CustomEvent(name, { detail }));
    }

    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
        this.events.addEventListener(type, listener);
    }

    removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
        this.events.removeEventListener(type, listener);
    }

    informInteraction(ts: number): void {
        if (this.inMap()) {
            this.currentMap!.span.lastInteraction = ts;
        }
    }

    private completeCurrentMap(endTime: number): void {
        const currentMap = this.currentMap;
        if (!currentMap) throw new Error("no current map to complete");

        currentMap.span.end = endTime;
        const mapTimeMs = currentMap.span.mapTime();
        const xpEnd = this.recentXpSnapshots.last()?.xp;
        if (xpEnd) {
            currentMap.xpGained = (xpEnd && currentMap.xpStart) ? (xpEnd - currentMap.xpStart) : 0;
            currentMap.xph = mapTimeMs > 0 ? (currentMap.xpGained / mapTimeMs) * 3600 * 1000 : 0;
        }
        this.recentMaps.push(currentMap);
        this.dispatchEvent("mapCompleted", { map: currentMap });
    }

    // real time functions, not utility for analysis of logs

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
        this.dispatchEvent("xpSnapshot", { snapshot });

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