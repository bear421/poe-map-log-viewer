import { AreaType, areaTypes, MapInstance, MapMarkerType } from "../ingest/log-tracker";
import { Segmentation } from "./segmentation";
import { Filter } from "./filter";
import { CharacterAggregation, CharacterInfo, buildCharacterAggregation } from "./character";
import { LogEvent, AnyMsgEvent, EventName } from "../ingest/events";
import { binarySearchFindFirstIx, binarySearchFindLastIx } from "../binary-search";
import { computeIfAbsent, FrameBarrier, Measurement } from "../util";
import { SplitCache } from "../split-cache";
import { getGameVersion, getZoneInfo } from "../data/areas";
import { BitSet } from "../bitset";
import { buildEventBitSetIndex, buildSessionsSegmentation } from "./event";
import { buildOverviewAggregation } from "./overview";
import { buildAreaTypeBitSetIndex, buildMapNameBitSetIndex, buildMapsBitSetIndex, IdentityCachingMapSorter, MapOrder } from "./map";

export const relevantEventNames = new Set<EventName>([
    "bossKill",
    "levelUp",
    "death",
    "passiveGained",
    "passiveAllocated",
    "passiveUnallocated",
    "bonusGained",
    "mapReentered",
    "joinedArea",
    "leftArea",
    "tradeAccepted",
    "msgParty",
    "hideoutEntered",
    "afkModeOn",
    "afkModeOff",
    "reflectingMist",
    "namelessSeer",
    "memoryTear",
]);


export class LogAggregationCube {
    private _mapSorter = new IdentityCachingMapSorter();
    private _overview?: OverviewAggregation;
    private _messages?: Map<string, AnyMsgEvent[]>;
    private _filteredCharacters?: CharacterInfo[];
    private _mapsBitSet?: BitSet;
    constructor(readonly maps: MapInstance[], readonly events: LogEvent[], readonly base: BaseLogAggregation, readonly filter: Filter, private readonly sfMaps: MapInstance[]) {}

    get gameVersion(): 1 | 2 {
        return this.base.gameVersion;
    }

    getMapsSorted(order: MapOrder): MapInstance[] {
        return this._mapSorter.sortMaps(this.maps, order, this);
    }

    get simpleFilterMapsBitSet(): BitSet {
        return this._mapsBitSet ??= buildMapsBitSetIndex(this.sfMaps);
    }

    async getOverviewAggregation(): Promise<OverviewAggregation> {
        return this._overview ??= await buildOverviewAggregation(this);
    }

    get messages(): Map<string, AnyMsgEvent[]> {
        if (this._messages) return this._messages;

        const messages = new Map<string, AnyMsgEvent[]>();
        for (const event of this.events) {
            switch (event.name) {
                case "msgFrom":
                    computeIfAbsent(messages, event.detail.character, () => []).push(event);
                    break;
                case "msgTo":
                    computeIfAbsent(messages, event.detail.character, () => []).push(event);
                    break;
            }
        }
        return this._messages = messages;
    }

    get characterAggregation(): CharacterAggregation {
        return this.base.characterAggregation;
    }

    get filteredCharacters(): CharacterInfo[] {
        if (this._filteredCharacters) return this._filteredCharacters;

        const filter = this.filter;
        const filteredCharacters = this.characterAggregation.characters.filter(char => {
            if (this.filter?.fromCharacterLevel && char.level < this.filter.fromCharacterLevel) {
                return false;
            }
            // don't filter by toCharacterLevel, this is generally undesired and uninteresting
            if (filter?.userTsBounds && filter.userTsBounds.length > 0) {
                if (char.lastPlayedTs < filter.userTsBounds[0].lo || char.createdTs > filter.userTsBounds[0].hi) {
                    return false;
                }
            } else if (PRACTICE_CHARACTER_REGEX.test(char.name) && char.level < 90 && char.lastPlayedTs < staleCharacterThreshold) {
                // discard practice characters unless explicitly included by tsBounds
                return false;
            }
            return true;
        });
        return this._filteredCharacters = filteredCharacters;
    }

}

// could probably make eventBitSets lazy here, but then async proliferates everywhere and we can't use property getters
export interface BaseLogAggregation {
    readonly gameVersion: 1 | 2;
    readonly maps: MapInstance[];
    readonly events: LogEvent[];
    readonly characterAggregation: CharacterAggregation;
    readonly eventBitSetIndex: Map<EventName, BitSet>;
    readonly sessionsSegmentation: Segmentation;
    readonly areaTypeBitSetIndex: Map<AreaType, BitSet>;
    readonly mapNameBitSetIndex: Map<string, BitSet>;
    readonly areaTypes: AreaType[];
}

export interface OverviewAggregation {
    /**
     * all unique maps
     */
    mapsUnique: MapInstance[];
    /**
     * all delve nodes
     */
    mapsDelve: MapInstance[];
    /**
     * total number of trades, includes both trades with NPCs and players
     */
    totalTrades: number;
    totalDeaths: number;
    totalWitnessedDeaths: number;
    totalMapTime: number;
    totalLoadTime: number;
    totalHideoutTime: number;
    totalAFKTime: number;
    totalBossKills: number;
    totalSessions: number;
}

export enum Dimension {
    character,
    characterLevel,
    areaLevel,
    date,
    hourOfDay,
    hourOfSession,
    dayOfWeek,
    none,
}

export enum Metric {
    deaths,
    witnessedDeaths,
    totalBuysAttempted,
    salesAttempted,
    bossKills,
    sessions,
    maps,
    delveNodes,
    totalTime, 
    mapTime,
    hideoutTime,
    campaignTime,
    loadTime,
    afkTime,
}

interface MetricMeta {
    type: "event" | "map"; 
    discrete: boolean;
}

export const metricMeta: Record<Metric, MetricMeta> = {
    [Metric.deaths]: {type: "event", discrete: true},
    [Metric.witnessedDeaths]: {type: "event", discrete: true},
    [Metric.totalBuysAttempted]: {type: "event", discrete: true},
    [Metric.salesAttempted]: {type: "event", discrete: true},
    [Metric.bossKills]: {type: "event", discrete: true},
    [Metric.sessions]: {type: "event", discrete: true},
    [Metric.maps]: {type: "map", discrete: true},
    [Metric.delveNodes]: {type: "map", discrete: true},
    [Metric.totalTime]: {type: "map", discrete: false},
    [Metric.mapTime]: {type: "map", discrete: false},
    [Metric.hideoutTime]: {type: "map", discrete: false},
    [Metric.campaignTime]: {type: "map", discrete: false},
    [Metric.loadTime]: {type: "map", discrete: false},
    [Metric.afkTime]: {type: "map", discrete: false},
}

export enum Aggregation {
    total,
    median,
    exactMedian,
    average,
    max,
    min,
}

const aggregationCache = new SplitCache<string, LogAggregationCube>(16);

export function clearAggregationCache() {
    aggregationCache.clear();
}

export async function aggregateCached(maps: MapInstance[], events: LogEvent[], filter: Filter, prevAgg?: LogAggregationCube): Promise<LogAggregationCube> {
    const cacheKey = JSON.stringify(filter);
    const cachedResult = aggregationCache.get(cacheKey);
    if (cachedResult) return cachedResult;

    const m = new Measurement();
    const res = await aggregate(maps, events, filter, prevAgg);
    const took = m.logTook("aggregate");
    aggregationCache.set(cacheKey, res, took < 5 && !Filter.isEmpty(filter));
    return res;
}

export async function aggregate(maps: MapInstance[], events: LogEvent[], filter: Filter, prevAgg?: LogAggregationCube): Promise<LogAggregationCube> {
    const reassembledFilter = reassembleFilter(filter, prevAgg);
    let sfMaps: MapInstance[];
    if (reassembledFilter) {
        sfMaps = Filter.filterMaps(maps, reassembledFilter);
        if (reassembledFilter.mapBitSet) {
            maps = sfMaps.filter(m => reassembledFilter.mapBitSet!.get(m.id));
        } else {
            maps = sfMaps;
        }
        // events = Filter.filterEvents(events, reassembledFilter);
        events = Filter.filterEventsByMaps(events, maps);
    } else {
        // selected filter combination excludes all data
        maps = [];
        sfMaps = [];
        events = [];
    }
    let base: BaseLogAggregation;
    if (prevAgg) {
        base = prevAgg.base;
    } else {
        try {
            let gameVersion: 1 | 2 = 1;
            for (const map of maps) {
                const version = getGameVersion(map.name);
                if (version !== undefined) {
                    gameVersion = version;
                    break;
                }
            }
            const characterAggregation = await buildCharacterAggregation(maps, events);
            const eventBitSetIndex = buildEventBitSetIndex(maps, events);
            const sessionsSegmentation = buildSessionsSegmentation(maps);
            const areaTypeBitSetIndex = buildAreaTypeBitSetIndex(maps);
            const mapNameBitSetIndex = buildMapNameBitSetIndex(maps);
            base = {
                gameVersion,
                maps,
                events,
                characterAggregation,
                eventBitSetIndex,
                sessionsSegmentation,
                areaTypeBitSetIndex,
                mapNameBitSetIndex,
                areaTypes
            };
        } catch (e) {
            console.error("failed to build base aggregation, limited functionality available", e);
            base = {
                gameVersion: 1,
                maps,
                events,
                characterAggregation: new CharacterAggregation(new Map(), [], new Map(), []),
                eventBitSetIndex: new Map(),
                sessionsSegmentation: [],
                areaTypeBitSetIndex: new Map(),
                mapNameBitSetIndex: new Map(),
                areaTypes
            };
        }
    }
    return new LogAggregationCube(maps, events, base, reassembledFilter ?? filter, sfMaps);
}

function reassembleFilter(filter: Filter, prevAgg?: LogAggregationCube): Filter | undefined {
    if (!prevAgg) return filter; 
  
    const segmentations: Segmentation[] = [];
    const characterSegmentation = prevAgg.characterAggregation.guessSegmentation(filter.fromCharacterLevel, filter.toCharacterLevel, filter.character);
    if (!characterSegmentation) return undefined;

    if (characterSegmentation.length) {
        segmentations.push(characterSegmentation);
    }
    if (filter.userTsBounds && filter.userTsBounds.length) {
        segmentations.push(filter.userTsBounds);
    }
    if (segmentations.length) {
        const newBounds = Segmentation.intersectAll(segmentations);
        if (newBounds.length === 0) return undefined;

        return filter.withBounds(newBounds);
    }
    return filter;
}

const staleCharacterThreshold = Date.now() - 1000 * 60 * 60 * 24 * 30 * 6; // 6 months

const PRACTICE_CHARACTER_REGEX = /^AAA/i;

export const SESSION_THRESHOLD_MILLIS = 1000 * 60 * 60;
const TRADE_PATTERNS = [
    'Hi, I would like to buy your',         // english
    '你好，我想購買',                        // chinese (traditional)
    '안녕하세요, ',                          // korean
    'こんにちは、 ',                         // japanese
    'Здравствуйте, хочу купить у вас ',     // russian
    'Hi, ich möchte ',                      // german
    "Bonjour, je souhaiterais t'acheter ",  // french
    'Olá, eu gostaria de comprar o seu ',   // portuguese
    'Hola, quisiera comprar tu ',           // spanish
    'สวัสดี เราต้องการชื้อ ',                    // thai
];
export const TRADE_REGEX = new RegExp(`^(${TRADE_PATTERNS.join('|')})`);

interface MetricsAggregator {
    walkEvents(fn: (event: LogEvent) => number): Promise<void>;
    walkMaps(fn: (map: MapInstance) => number): Promise<void>;
}

interface Accumulator {
    add(value: number): void;
    result(): number;
}

export async function aggregateBy(agg: LogAggregationCube, dimension: Dimension, metric: Metric, aggregation: Aggregation): Promise<Map<string | number, number>> {
    const m = new Measurement();
    const res = await aggregateBy0(agg, dimension, metric, aggregation);
    m.logTook("aggregateBy");
    return res;
}

async function aggregateBy0(agg: LogAggregationCube, dimension: Dimension, metric: Metric, aggregation: Aggregation): Promise<Map<string | number, number>> {
    const filter = agg.filter;
    const fromCharacterLevel = agg.filter.fromCharacterLevel;
    const toCharacterLevel = agg.filter.toCharacterLevel;
    const characters = agg.filteredCharacters.map(c => c.name);
    const events = agg.events;
    let eventDimensionSegmentation: Map<string | number, Segmentation> | undefined;
    let metricAggregator: MetricsAggregator;
    let dataMap = new Map<string | number, Accumulator>();
    const fb = new FrameBarrier();
    const accumulatorFn = getAccumulatorFn(aggregation);
    const zeroAgnostic = aggregation === Aggregation.total;
    function eventSegmentationMetricsAggregator(eventDimensionSegmentation: Map<string | number, Segmentation>) {
        return {
            walkEvents: async (fn: (event: LogEvent, key: string | number) => number) => {
                for (const [key, segmentation] of eventDimensionSegmentation.entries()) {
                    const accumulator = accumulatorFn();
                    for (const range of segmentation) {
                        const loIx = binarySearchFindFirstIx(events, (e) => e.ts >= range.lo);
                        if (loIx === -1) continue;
        
                        const end = range.hi;
                        const hiIx = end ? binarySearchFindLastIx(events, (e) => e.ts <= end) : events.length - 1;
                        if (hiIx === -1) continue;
        
                        for (let i = loIx; i <= hiIx; i++) {
                            if (fb.shouldYield()) await fb.yield();
                            
                            const event = events[i];
                            accumulator.add(fn(event, key));
                        }
                    }
                    dataMap.set(key, accumulator);
                }
            },
            walkMaps: async (fn: (map: MapInstance, key: string | number) => number) => {
                for (const [key, segmentation] of eventDimensionSegmentation.entries()) {
                    const accumulator = accumulatorFn();
                    for (const range of segmentation) {
                        const loIx = binarySearchFindFirstIx(agg.maps, (m) => m.start >= range.lo);
                        if (loIx === -1) continue;
        
                        const end = range.hi;
                        const hiIx = end ? binarySearchFindLastIx(agg.maps, (m) => !m.end || m.end <= end) : agg.maps.length - 1;
                        if (hiIx === -1) continue;
        
                        for (let i = loIx; i <= hiIx; i++) {
                            if (fb.shouldYield()) await fb.yield();

                            const map = agg.maps[i];
                            accumulator.add(fn(map, key));
                        }
                    }
                    dataMap.set(key, accumulator);
                }
            }
        }
    }

    function keyedMetricsAggregator<T extends string | number>(eventKeyFn: (event: LogEvent) => T, mapKeyFn: (map: MapInstance) => T, postWalk?: () => void) {
        return {
            walkEvents: async (fn: (event: LogEvent) => number) => {
                for (const event of events) {
                    if (fb.shouldYield()) await fb.yield();

                    const value = fn(event);
                    if (zeroAgnostic && value === 0) continue;

                    const key = eventKeyFn(event);
                    computeIfAbsent(dataMap, key, () => accumulatorFn()).add(value);
                }
                postWalk?.();
            },
            walkMaps: async (fn: (map: MapInstance) => number) => {
                for (const map of agg.maps) {
                    if (fb.shouldYield()) await fb.yield();

                    const value = fn(map);
                    if (zeroAgnostic && value === 0) continue;

                    const key = mapKeyFn(map);
                    computeIfAbsent(dataMap, key, () => accumulatorFn()).add(value);
                }
                postWalk?.();
            }
        }
    }
    
    switch (dimension) {
        case Dimension.character:
            eventDimensionSegmentation = agg.characterAggregation.guessSegmentations(fromCharacterLevel, toCharacterLevel, characters);
            metricAggregator = eventSegmentationMetricsAggregator(eventDimensionSegmentation);
            break;
        case Dimension.characterLevel:
            eventDimensionSegmentation = new Map<string, Segmentation>();
            const lo = (fromCharacterLevel ?? 1) - 1;
            const hi = (toCharacterLevel ?? 100);
            for (let i = lo; i < hi; i++) {
                const segmentations: Segmentation[] = [];
                for (const levelIndex of agg.characterAggregation.characterLevelSegmentation.values()) {
                    const segmentation = levelIndex[i];
                    if (segmentation) {
                        segmentations.push(segmentation);
                    }
                }
                const merged = Segmentation.mergeContiguousConnected(segmentations.flat().sort((a, b) => a.lo - b.lo));
                eventDimensionSegmentation.set(i + 1, merged);
            }
            metricAggregator = eventSegmentationMetricsAggregator(eventDimensionSegmentation);
            break;
        case Dimension.date:
            eventDimensionSegmentation = new Map<string, Segmentation>();
            const start = events[0].ts;
            const end = events[events.length - 1].ts;
            let date = new Date(start);
            while (date.getTime() < end) {
                date.setHours(0, 0, 0, 0);
                const key = date.toLocaleDateString();
                const lo = date.getTime();
                date.setHours(23, 59, 59, 999);
                const hi = date.getTime();
                eventDimensionSegmentation.set(key, [{lo, hi}]);
                date.setDate(date.getDate() + 1);
            }
            metricAggregator = eventSegmentationMetricsAggregator(eventDimensionSegmentation);
            break;
        case Dimension.hourOfDay:
            for (let i = 0; i < 24; i++) {
                dataMap.set(i, accumulatorFn());
            }
            metricAggregator = keyedMetricsAggregator(event => new Date(event.ts).getHours(), map => new Date(map.start).getHours());
            break;
        case Dimension.hourOfSession:
            function getHourOfSession(ts: number): number {
                const range = Segmentation.find(agg.base.sessionsSegmentation, ts);
                if (!range) return -1;

                return Math.floor((ts - range.lo) / 1000 / 3600);
            }
            metricAggregator = keyedMetricsAggregator(event => getHourOfSession(event.ts), map => getHourOfSession(map.start), () => {
                dataMap = new Map([...dataMap.entries()].sort((a, b) => (a[0] as number) - (b[0] as number)));
            });
            break;
        case Dimension.dayOfWeek:
            const weekDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
            for (let i = 1; i < 7; i++) {
                dataMap.set(weekDays[i], accumulatorFn());
            }
            dataMap.set(weekDays[0], accumulatorFn());
            metricAggregator = keyedMetricsAggregator(event => weekDays[new Date(event.ts).getDay()], map => weekDays[new Date(map.start).getDay()]);
            break;
        case Dimension.areaLevel:
            metricAggregator = {
                walkEvents: async (fn: (event: LogEvent) => number) => {
                    for (const map of agg.maps) {
                        const loIx = binarySearchFindFirstIx(events, (e) => e.ts >= map.start);
                        if (loIx === -1) continue;

                        const end = map.end;
                        const hiIx = end ? binarySearchFindLastIx(events, (e) => e.ts <= end) : events.length - 1;
                        if (hiIx === -1) continue;

                        const accumulator = computeIfAbsent(dataMap, map.areaLevel, () => accumulatorFn());
                        for (let i = loIx; i <= hiIx; i++) {
                            if (fb.shouldYield()) await fb.yield();

                            accumulator.add(fn(events[i]));
                        }
                    }
                    // TODO do this cleaner and type-safer
                    dataMap = new Map([...dataMap.entries()].sort((a, b) => (a[0] as number) - (b[0] as number)));
                },
                walkMaps: async (fn: (map: MapInstance) => number) => {
                    for (const map of agg.maps) {
                        if (fb.shouldYield()) await fb.yield();

                        const accumulator = computeIfAbsent(dataMap, map.areaLevel, () => accumulatorFn());
                        accumulator.add(fn(map));
                    }
                    // TODO do this cleaner and type-safer
                    dataMap = new Map([...dataMap.entries()].sort((a, b) => (a[0] as number) - (b[0] as number)));
                }
            };
            break;
        case Dimension.none:
            const accumulator = accumulatorFn();
            dataMap.set("none", accumulator);
            metricAggregator = {
                walkEvents: async (fn: (event: LogEvent) => number) => {
                    for (const event of events) {
                        if (fb.shouldYield()) await fb.yield();
    
                        accumulator.add(fn(event));
                    }
                },
                walkMaps: async (fn: (map: MapInstance) => number) => {
                    for (const map of agg.maps) {
                        if (fb.shouldYield()) await fb.yield();
    
                        accumulator.add(fn(map));
                    }
                }
            };
            break;
    }
    if (metricMeta[metric].type === "event") {
        let lastEventTs = 0;
        await metricAggregator.walkEvents((event) => {
            let found = false;
            switch (metric) {
                case Metric.deaths:
                    if (event.name !== 'death') break;

                    if (filter.fromAreaLevel && event.detail.areaLevel < filter.fromAreaLevel) break;

                    if (filter.toAreaLevel && event.detail.areaLevel > filter.toAreaLevel) break;

                    found = agg.characterAggregation.isOwned(event.detail.character);
                    break;
                case Metric.witnessedDeaths:
                    if (event.name !== 'death') break;

                    if (filter.fromAreaLevel && event.detail.areaLevel < filter.fromAreaLevel) break;

                    if (filter.toAreaLevel && event.detail.areaLevel > filter.toAreaLevel) break;

                    found = !agg.characterAggregation.isOwned(event.detail.character);
                    break;
                case Metric.bossKills:
                    found = event.name === 'bossKill' && event.detail.areaLevel >= 75;
                    break;
                case Metric.sessions:
                    found = lastEventTs !== 0 && event.ts - lastEventTs > SESSION_THRESHOLD_MILLIS;
                    lastEventTs = event.ts;
                    break;
                case Metric.totalBuysAttempted:
                    found = event.name === 'msgTo' && TRADE_REGEX.test(event.detail.msg);
                    break;
                case Metric.salesAttempted:
                    found = event.name === 'msgFrom' && TRADE_REGEX.test(event.detail.msg);
                    break;
                default: throw new Error(`unsupported metric: ${metric}`);
            }
            return found ? 1 : 0;
        });
    } else {
        await metricAggregator.walkMaps((map) => {
            switch (metric) {
                case Metric.maps:
                    return 1;
                case Metric.delveNodes:
                    return map.areaType === AreaType.Delve ? 1 : 0;
                case Metric.totalTime:
                    return map.getTime();
                case Metric.mapTime:
                    return map.getTime(new Set([MapMarkerType.map]));
                case Metric.hideoutTime:
                    return map.getTime(new Set([MapMarkerType.hideout]));
                case Metric.loadTime:
                    return map.getTime(new Set([MapMarkerType.load]));
                case Metric.afkTime:
                    return map.getTime(new Set([MapMarkerType.afk]));
                case Metric.campaignTime:
                    // return agg.isCampaignMap(map) ? MapSpan.mapTimePlusIdle(map.span) : 0;
                    // FIXME should only count time until campaign is completed (per character), e.g. once the final zone is reached, stop counting campaign zones towards campaign time
                    const zoneInfo = getZoneInfo(map.name, map.areaLevel);
                    return zoneInfo ? map.getTime() : 0;
                default: throw new Error(`unsupported metric: ${metric}`);
            }
        });
    }
    const aggregatedData = new Map<string | number, number>();
    for (const [key, accumulator] of dataMap.entries()) {
        aggregatedData.set(key, accumulator.result());
    }
    return aggregatedData;
}

function getAccumulatorFn(aggregation: Aggregation): () => Accumulator {
    class SumAcc implements Accumulator {
        private sum = 0;
        add(value: number): void {
            this.sum += value;
        }
        result(): number {
            return this.sum;
        }
    }
    class AverageAcc implements Accumulator {
        private sum = 0;
        private count = 0;
        add(value: number): void {
            this.sum += value;
            this.count++;
        }
        result(): number {
            return this.sum / this.count;
        }
    }
    class MinAcc implements Accumulator {
        private min = Infinity;
        add(value: number): void {
            this.min = Math.min(this.min, value);
        }
        result(): number {
            return this.min;
        }
    }
    class MaxAcc implements Accumulator {
        private max = -Infinity;
        add(value: number): void {
            this.max = Math.max(this.max, value);
        }
        result(): number {
            return this.max;
        }
    }
    abstract class ArrayAcc implements Accumulator {
        protected values: number[] = [];
        add(value: number): void {
            this.values.push(value);
        }
        abstract result(): number;
    }
    class MedianAcc extends ArrayAcc {
        result(): number {
            return this.values.length !== 0 ? medianQuickSelect(this.values) : 0;
        }
    }
    class ExactMedianAcc extends ArrayAcc {
        result(): number {
            return this.values.length !== 0 ? medianExact(this.values) : 0;
        }
    }
    switch (aggregation) {
        case Aggregation.total:
            return () => new SumAcc();
        case Aggregation.average:
            return () => new AverageAcc();
        case Aggregation.median:
            return () => new MedianAcc();
        case Aggregation.min:
            return () => new MinAcc();
        case Aggregation.max:
            return () => new MaxAcc();
        case Aggregation.exactMedian:
            return () => new ExactMedianAcc();
    }
}

export function medianExact(arr: number[]): number {
    if (arr.length === 0) throw new Error('empty array');

    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The array is mutated for maximum speed; pass a copy if you need the original order.
 * @param a – unsorted numeric values
 * @returns median (average of two middles if n even)
 */
export function medianQuickSelect(a: number[] | Float64Array | Uint32Array) {
    const n = a.length;
    if (n === 0) throw new Error('empty array');
  
    // The k-th smallest element we need
    const k1 = (n - 1) >> 1;          // lower median index
    const k2 = n >> 1;                // upper median (same as k1 if n odd)
  
    // iterative Hoare Quickselect with median-of-three pivots
    let lo = 0, hi = n - 1;
    while (true) {
        // Median-of-three to cut worst-case probability
        const mid = (lo + hi) >>> 1;
        const pivot = median3(a, lo, mid, hi);

        // 3-way partition (Lomuto)
        let i = lo, j = hi;
        while (i <= j) {
            while (a[i] < pivot) ++i;
            while (a[j] > pivot) --j;
            if (i <= j) {
                const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
                ++i; --j;
            }
        }

        if (k2 <= j)       hi = j;           // target(s) in the left part
        else if (k1 >= i)  lo = i;           // in the right part
        else break;                          // both medians are inside [j+1 .. i-1]
    }
  
    // We now know elements [0..k1] ≤ medians ≤ elements [k2..n-1].
    // If even length, we still need the upper median (a[k2]).
    // One pass through the narrowed window is enough (≤ 3n/4 items worst-case).
    let m1 = -Infinity, m2 = Infinity;
    for (let t = lo; t <= hi; ++t) {
        const v = a[t];
        if (v < m1 && v > m2) continue; // fast path
        if (v <= m1 || t === k1) m1 = Math.max(m1, v);
        if (v >= m2 || t === k2) m2 = Math.min(m2, v);
    }
    return n & 1 ? m2 /* same as m1 */ : 0.5 * (m1 + m2);
  }

function median3(a: number[] | Float64Array | Uint32Array, i: number, j: number, k: number): number {
    const A = a[i], B = a[j], C = a[k];
    return (A < B)
        ? (B < C ? B : (A < C ? C : A))
        : (A < C ? A : (B < C ? C : B));
}

export function average(arr: number[]): number {
    if (arr.length === 0) return 0;

    const sum = arr.reduce((acc, val) => acc + val, 0);
    return sum / arr.length;
}

export function total(arr: number[]): number {
    return arr.reduce((acc, val) => acc + val, 0);
}

export function max(arr: number[]): number {
    return arr.reduce((acc, val) => Math.max(acc, val), -Infinity);
}

export function min(arr: number[]): number {
    return arr.reduce((acc, val) => Math.min(acc, val), Infinity);
}