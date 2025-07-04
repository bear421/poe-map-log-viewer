import { AreaType, Filter, MapInstance, MapSpan, Segmentation } from "./ingest/log-tracker";
import { LogEvent, LevelUpEvent, SetCharacterEvent, AnyCharacterEvent, AnyMsgEvent } from "./ingest/events";
import { binarySearchFindFirstIx, binarySearchFindLast, binarySearchFindLastIx } from "./binary-search";
import { Feature, isFeatureSupportedAt } from "./data/log-versions";
import { freezeIntermediate, logTook } from "./util";
import { SplitCache } from "./split-cache";
import { getZoneInfo } from "./data/zone_table";

export type LogAggregation = Readonly<MutableLogAggregation>;

export interface MutableLogAggregation {
    /**
     * all maps, including unique and campaign
     */
    maps: MapInstance[];
    /**
     * all events
     */
    events: LogEvent[];
    /**
     * all messages
     */
    messages: Map<string, AnyMsgEvent[]>;
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
    /**
     * total number of buys attempted from players. based on whispers sent
     */
    totalBuysAttempted: number;
    /**
     * total number of sales attempted to players. based on whispers received
     */
    totalSalesAttempted: number;
    totalDeaths: number;
    totalWitnessedDeaths: number;
    totalMapTime: number;
    totalLoadTime: number;
    totalHideoutTime: number;
    totalBossKills: number;
    totalSessions: number;
    characterAggregation: CharacterAggregation;
    filter: Filter;
}

export enum Dimension {
    character,
    characterLevel,
    areaLevel,
    date,
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
    totalTime, 
    mapTime,
    hideoutTime,
    campaignTime,
    loadTime,
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
    [Metric.totalTime]: {type: "map", discrete: false},
    [Metric.mapTime]: {type: "map", discrete: false},
    [Metric.hideoutTime]: {type: "map", discrete: false},
    [Metric.campaignTime]: {type: "map", discrete: false},
    [Metric.loadTime]: {type: "map", discrete: false},
}

export enum Aggregation {
    total,
    median,
    exactMedian,
    average,
    max,
    min,
}

export interface CharacterInfo {
    name: string;
    level: number;
    ascendancy: string;
    createdTs: number;
    lastPlayedTs: number;
}

export class CharacterAggregation {
    readonly characterLevelIndex: Map<string, (LevelUpEvent|SetCharacterEvent)[]>;
    readonly characterTsIndex: AnyCharacterEvent[];
    readonly characterLevelSegmentation: Map<string, Segmentation[]>;
    readonly characters: CharacterInfo[];
    readonly filteredCharacters: CharacterInfo[];

    constructor(characterLevelIndex: Map<string, (LevelUpEvent|SetCharacterEvent)[]>, characterTsIndex: AnyCharacterEvent[], characterLevelSegmentation: Map<string, Segmentation[]>, 
            characters: CharacterInfo[], filteredCharacters: CharacterInfo[]) {
        this.characterLevelIndex = characterLevelIndex;
        this.characterTsIndex = characterTsIndex;
        this.characterLevelSegmentation = characterLevelSegmentation;
        this.characters = characters;
        this.filteredCharacters = filteredCharacters;
    }

    /**
     * @returns true if the character is likely to be owned by the owner of the log file
     */
    isOwned(character: string): boolean {
        return this.characterLevelIndex.has(character);
    }

    /**
     * @returns the level of the character that was likely active at the specified timestamp
     */
    guessLevel(ts: number): number {
        const levelEvent = this.guessLevelEvent(ts);
        if (!levelEvent) return 1;

        return levelEvent.detail.level;
    }

    /**
     * @returns the levelUp event or setCharacter event that occurred at or before the specified timestamp
     */
    guessLevelEvent(ts: number): LevelUpEvent | SetCharacterEvent | undefined {
        const anyEvent = this.guessAnyEvent(ts);
        if (!anyEvent) return undefined;

        const levelIndex = this.characterLevelIndex.get(anyEvent.detail.character);
        if (!levelIndex) throw new Error("illegal state: no level index found for character " + anyEvent.detail.character);

        return binarySearchFindLast(levelIndex, (e) => e.ts <= ts);
    }

    /**
     * @returns any character event before or at the specified timestamp, i.e. the character that was likely active at the specified timestamp
     */
    guessAnyEvent(ts: number): AnyCharacterEvent | undefined {
        return binarySearchFindLast(this.characterTsIndex, (e) => e.ts <= ts);
    }

    guessSegmentation(levelFrom?: number, levelTo?: number, character?: string): Segmentation | undefined {
        if (character) {
            const levelIndex = this.characterLevelSegmentation.get(character);
            if (!levelIndex) throw new Error("illegal state: no level index found for character " + character);

            return this.guessSegmentationFor(levelIndex, levelFrom, levelTo);
        } else if (levelFrom || levelTo) {
            const segmentation: Segmentation = [];
            for (const levelIndex of this.characterLevelSegmentation.values()) {
                const characterSegmentation = this.guessSegmentationFor(levelIndex, levelFrom, levelTo);
                if (characterSegmentation) {
                    segmentation.push(...characterSegmentation);
                }
            }
            if (!segmentation.length) return undefined;

            segmentation.sort((a, b) => a.lo - b.lo);
            return Segmentation.mergeContiguousConnected(segmentation);
        }
        return [];
    }

    private guessSegmentationFor(levelIndex: Segmentation[], levelFrom?: number, levelTo?: number): Segmentation | undefined {
        const segmentation: Segmentation = [];
        const limit = Math.min((levelTo ?? 100), levelIndex.length);
        for (let i = (levelFrom ?? 1) - 1; i < limit; i++) {
            const levelSegmentation = levelIndex[i];
            levelSegmentation && segmentation.push(...levelSegmentation);
        }
        return segmentation.length ? Segmentation.mergeContiguousConnected(segmentation) : undefined;
    }

    guessSegmentations(levelFrom?: number, levelTo?: number, characters?: string[]): Map<string, Segmentation> {
        if (!characters) {
            characters = Array.from(this.characterLevelSegmentation.keys());
        }
        const segmentations = new Map<string, Segmentation>();
        for (const character of characters) {
            const segmentation = this.guessSegmentation(levelFrom, levelTo, character);
            if (segmentation) {
                segmentations.set(character, segmentation);
            }
        }
        return segmentations;
    }
}

const aggregationCache = new SplitCache<string, LogAggregation>(16);

export function clearAggregationCache() {
    aggregationCache.clear();
}

export function aggregateCached(maps: MapInstance[], events: LogEvent[], filter: Filter, prevAgg?: LogAggregation): LogAggregation {
    const cacheKey = JSON.stringify(filter);
    const cachedResult = aggregationCache.get(cacheKey);
    if (cachedResult) return cachedResult;

    const then = performance.now();
    const res = aggregate(maps, events, filter, prevAgg);
    const took = logTook("aggregate", then);
    aggregationCache.set(cacheKey, res, took < 5 && !Filter.isEmpty(filter));
    return res;
}

export function aggregate(maps: MapInstance[], events: LogEvent[], filter: Filter, prevAgg?: LogAggregation): LogAggregation {
    const reassembledFilter = reassembleFilter(filter, prevAgg);
    if (reassembledFilter) {
        maps = Filter.filterMaps(maps, reassembledFilter);
        events = Filter.filterEvents(events, reassembledFilter);
    } else {
        // selected filter combination excludes all data
        maps = [];
        events = [];
    }
    let characterAggregation;
    try {
        if (prevAgg) {
            characterAggregation = prevAgg.characterAggregation;
        } else {
            characterAggregation = buildCharacterAggregation(maps, events);
        }
        characterAggregation = withFilteredCharacters(characterAggregation, filter);
    } catch (e) {
        console.error("failed to build character aggregation, limited functionality available", e);
        characterAggregation = new CharacterAggregation(new Map(), [], new Map(), [], []);
    }
    // FIXME don't default to filter if all data is excluded
    const agg = aggregate0(maps, events, reassembledFilter ?? filter, characterAggregation);
    return freezeIntermediate(agg);
}

function reassembleFilter(filter: Filter, prevAgg?: LogAggregation): Filter | undefined {
    if (!prevAgg) return filter; 
  
    const segmentations: Segmentation[] = [];
    const characterSegmentation = prevAgg.characterAggregation.guessSegmentation(filter.fromCharacterLevel, filter.toCharacterLevel, filter.character);
    if (!characterSegmentation) return undefined;

    if (characterSegmentation.length) {
        segmentations.push(characterSegmentation);
    }
    if (filter.tsBounds && filter.tsBounds.length) {
        segmentations.push(filter.tsBounds);
    }
    if (segmentations.length) {
        const newBounds = Segmentation.intersectAll(segmentations);
        if (newBounds.length === 0) return undefined;

        return filter.withBounds(newBounds);
    }
    return filter;
}

const staleThreshold = Date.now() - 1000 * 60 * 60 * 24 * 30 * 6; // 6 months

function withFilteredCharacters(ca: CharacterAggregation, filter: Filter): CharacterAggregation {
    const filteredCharacters = ca.characters.filter(char => {
        if (filter?.fromCharacterLevel && char.level < filter.fromCharacterLevel) {
            return false;
        }
        // don't filter by toCharacterLevel, this is generally undesired and uninteresting
        if (filter?.tsBounds && filter.tsBounds.length > 0) {
            if (char.createdTs < filter.tsBounds[0].lo || char.lastPlayedTs > filter.tsBounds[0].hi) {
                return false;
            }
        } else if (char.name.startsWith("AAA") && char.level < 90 && char.lastPlayedTs < staleThreshold) {
            // discard practice characters unless explicitly included by tsBounds
            return false;
        }
        return true;
    });
    return new CharacterAggregation(ca.characterLevelIndex, ca.characterTsIndex, ca.characterLevelSegmentation, ca.characters, filteredCharacters);
}

const SESSION_THRESHOLD_MILLIS = 1000 * 60 * 60;
const TRADE_PATTERN = /^(Hi, I would like to buy your|你好，我想購買|안녕하세요, |こんにちは、 |Здравствуйте, хочу купить у вас |Hi, ich möchte |Bonjour, je souhaiterais t'acheter )/;

function aggregate0(maps: MapInstance[], events: LogEvent[], filter: Filter, characterAggregation: CharacterAggregation): MutableLogAggregation {
    let totalBuysAttempted = 0, totalSalesAttempted = 0, totalTrades = 0;
    let totalDeaths = 0, totalWitnessedDeaths = 0;
    const messages = new Map<string, AnyMsgEvent[]>();
    let totalBossKills = 0;
    let totalSessions = 1;
    let prevEvent: LogEvent | null = null;
    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        if (prevEvent) {
            const tsDelta = event.ts - prevEvent.ts;
            if (tsDelta > SESSION_THRESHOLD_MILLIS) {
                totalSessions++;
            }
        }
        prevEvent = event;
        switch (event.name) {
            case "msgFrom":
                if (TRADE_PATTERN.test(event.detail.msg)) {
                    totalSalesAttempted++;
                }
                computeIfAbsent(messages, event.detail.character, () => []).push(event);
                break;
            case "msgTo":
                if (TRADE_PATTERN.test(event.detail.msg)) {
                    totalBuysAttempted++;
                }
                computeIfAbsent(messages, event.detail.character, () => []).push(event);
                break;
            case "tradeAccepted":
                totalTrades++;
                break;
            case "death":
                if (filter.fromAreaLevel && event.detail.areaLevel < filter.fromAreaLevel) break;

                if (filter.toAreaLevel && event.detail.areaLevel > filter.toAreaLevel) break;

                if (characterAggregation.isOwned(event.detail.character)) {
                    totalDeaths++;
                } else {
                    totalWitnessedDeaths++;
                }
                break;
            case "bossKill":
                // assume pinacle bosses are at least i75+ otherwise this matches campaign bosses such as King in the Mists
                if (event.detail.areaLevel >= 75) {
                    totalBossKills++;
                }
                break;
        }
    }

    let totalMapTime = 0, totalLoadTime = 0, totalHideoutTime = 0
    const mapsUnique: MapInstance[] = [];
    const mapsDelve: MapInstance[] = [];
    for (const map of maps) {
        totalMapTime += MapSpan.mapTime(map.span);
        totalLoadTime += map.span.loadTime;
        totalHideoutTime += map.span.hideoutTime;
        if (map.isUnique) {
            mapsUnique.push(map);
        }
        if (map.areaType === AreaType.Delve) {
            mapsDelve.push(map);
        }
    }
    return {
        maps,
        mapsUnique,
        mapsDelve,
        events,
        messages,
        totalTrades,
        totalBuysAttempted,
        totalSalesAttempted,
        totalDeaths,
        totalWitnessedDeaths,
        totalMapTime,
        totalLoadTime,
        totalHideoutTime,
        totalBossKills,
        totalSessions,
        characterAggregation,
        filter
    };
}

class ContiguousArray<T extends {ts: number}> extends Array<T> {
    push(...items: T[]) {
        if (items.length) {
            checkContiguous(items);
            if (this.length > 0) {
                const tail = this[this.length - 1];
                const itemHead = items[0];
                if (itemHead.ts < tail.ts) {
                    throw new Error(`new element precedes prior element: ${itemHead.ts} < ${tail.ts}`);
                }
            }
        }
        return super.push(...items);
    }

    unshift(...items: T[]) {
        if (items.length) {
            checkContiguous(items);
            if (this.length) {
                const head = this[0];
                const itemTail = items[items.length - 1];
                if (itemTail.ts > head.ts) {
                    throw new Error(`new tail[${items.length - 1}] succeeds current head[0]: ${itemTail.ts} > ${head.ts}`);
                }
            }
        }
        return super.unshift(...items);
    }

    checkedSet(ix: number, item: T) {
        if (ix < 0 || ix >= this.length) {
            throw new Error(`index out of bounds: ${ix} is not in range [0, ${this.length})`);
        }
        if (ix > 0) {
            const prev = this[ix - 1];
            if (item.ts < prev.ts) {
                throw new Error(`new element precedes prior element: ${item.ts} < ${prev.ts}`);
            }
        }
        if (ix < this.length - 1) {
            const next = this[ix + 1];
            if (item.ts > next.ts) {
                throw new Error(`new element succeeds next element: ${item.ts} > ${next.ts}`);
            }
        }
        super[ix] = item;
    }

    sort(): this {
        throw new Error("must not sort a contiguous array");
    }

    reverse(): this {
        throw new Error("must not reverse a contiguous array");
    }

    copyWithin(): this {
        throw new Error("unsupported");
    }

    fill(): this {
        throw new Error("unsupported");
    }

    splice(ix: number, delCount: number, ...items: T[]) {
        if (items.length) {
            checkContiguous(items);
            if (this.length) {
                if (items[0].ts < this[ix - 1].ts) {
                    throw new Error(`new head[0] precedes prior element: ${items[0].ts} < ${this[ix - 1].ts}`);
                }
                if (items[items.length - 1].ts > this[ix].ts) {
                    throw new Error(`new tail[${items.length - 1}] precedes prior element: ${items[items.length - 1].ts} > ${this[ix].ts}`);
                }
            }
        }
        return super.splice(ix, delCount, ...items);
    }
}

function checkContiguous<T extends {ts: number}>(items: T[]) {
    for (let i = 0; i < items.length - 1; i++) {
        const prev = items[i];
        const next = items[i + 1];
        if (prev.ts > next.ts) {
            const e = new Error(`element[${i}] precedes element[${i + 1}]: ${next.ts} < ${prev.ts}`,
                { cause: { prev, next } }
            );
            console.error(e, e.cause);
            throw e;
        }
    }
}

// corner-case city
function buildCharacterAggregation(_: MapInstance[], events: LogEvent[]): CharacterAggregation {
    checkContiguous(events);
    const foreignCharacters = determineForeignCharacters(events);
    const characterLevelIndex = new Map<string, ContiguousArray<LevelUpEvent|SetCharacterEvent>>();
    const characterTsIndex = new ContiguousArray<AnyCharacterEvent>();
    // expands the supplied and prior's character's adjacent character level range by appending a setCharacter event to both
    const handleCharacterSwitch = (ts: number, character: string, ascendancy: string, level: number, eventLoopIndex: number) => {
        // expand the range of the prior character, unless this is the first character
        for (let i = characterTsIndex.length - 1; i >= 0; i--) {
            const prev = characterTsIndex[i];
            const index = characterLevelIndex.get(prev.detail.character);
            if (!index) {
                if (prev.detail.character === character) {
                    throw new Error("illegal state: expected prior event to be of another character " + character);
                }
                // prev is definitely an event of a foreign character
                continue;
            }
            const levelLikePrev = index[index.length - 1];
            if (!levelLikePrev) {
                // not sure how this corner-case is possible, but it is (at least for PoE 1 logs)
                break;
            }
            // backtrack to ANY prior event. if we take ts both character would share an event / map (WRONG!)
            // it is unusual, perhaps even impossible for prevTs to not be found, but just in case:
            // ts - 1 is fair enough and prevents character from including the initial breach event
            const prevTs = binarySearchFindLast(events, (e) => e.ts < ts, 0, eventLoopIndex)?.ts ?? ts - 1;
            if (prevTs < levelLikePrev.ts) {
                throw new Error(`illegal state: prevTs < levelLikePrev.ts for character ${character} at ts ${ts}`);
            }
            if (levelLikePrev.detail.character === character) {
                throw new Error(`illegal state: prevCharacter === character: ${levelLikePrev.detail.character} === ${character} at ts ${ts}`);
            }
            if (prev.ts > prevTs) {
                // prior character event is after supplied threshold ts, should only be possible for a fresh character after it's levelUp(2) event
                // in the case of death or msg events AFTER character creation but BEFORE the levelUp(2) event
                const ix = binarySearchFindLastIx(characterTsIndex, (e) => e.ts < prevTs);
                if (ix === -1) throw new Error(`illegal state: no prior event found for character ${character} at ts ${prevTs}`);

                const prevCharacterEvent = SetCharacterEvent.ofEvent(prevTs, levelLikePrev);
                index.push(prevCharacterEvent);
                // also handle next character with special offset 
                const nextCharacterEvent = SetCharacterEvent.of(ts, character, ascendancy, level);
                characterTsIndex.splice(ix, 0, prevCharacterEvent, nextCharacterEvent);
                // const nextIndex = characterLevelIndex.get(character);
                computeIfAbsent(characterLevelIndex, character, () => new ContiguousArray()).push(nextCharacterEvent);
                /*
                if (!nextIndex) {
                    throw new Error(`illegal state: no next index found for character ${character} at ts ${ts}`);
                }
                const nextCharacterIx = binarySearchFindLastIx(nextIndex, (e) => e.ts < prevTs);
                if (nextCharacterIx === -1) {
                    console.error(nextIndex);
                    throw new Error(`invariant: character index (${character}) has no preceding event at ${prevTs}`);
                }
                nextIndex.splice(nextCharacterIx, 0, nextCharacter);*/
                return;
            } else {
                const prevCharacterEvent = SetCharacterEvent.ofEvent(prevTs, levelLikePrev);
                index.push(prevCharacterEvent);
                characterTsIndex.push(prevCharacterEvent);
            }
            break;
        }
        const nextCharacter = SetCharacterEvent.of(ts, character, ascendancy, level);
        characterTsIndex.push(nextCharacter);
        computeIfAbsent(characterLevelIndex, character, () => new ContiguousArray()).push(nextCharacter);
    };
    const handleCharacterEvent = (event: AnyCharacterEvent, eventLoopIndex: number) => {
        const character = event.detail.character;
        if (event.name == "levelUp" && event.detail.level === 2) {
            // must be in 1st zone (beach / riverbank)
            // note that this will not find the earliest possible beach event (for this character)
            // this is desirable if a player is resetting the 1st area for speedruns or what have you
            let beachEvent: LogEvent | undefined = undefined;
            // cannot use binary search for non-monotonic predicate
            for (let i = eventLoopIndex; i > 0; i--) {
                const e = events[i];
                if (e.name == "mapEntered" && e.ts < event.ts) {
                    beachEvent = e;
                    break;
                }
            }
            let ts;
            if (beachEvent) {
                ts = beachEvent.ts;
            } else {
                // possible if log is incomplete, or very old log format (?)
                if (isFeatureSupportedAt(Feature.ZoneGeneration, event.ts)) {
                    console.warn("log incomplete? failed to find beach event for level 2 character", event.detail.character, event.ts);
                } else {
                    // legacy log format, silently discard for now
                    return;
                }
                ts = event.ts - 1;
            }
            if (characterLevelIndex.has(character)) {
                // FIXME handle character name reuse, maybe with an alias
                console.warn("duplicate characters not supported yet, discarding prior character data", character);
            }
            const index = new ContiguousArray<LevelUpEvent|SetCharacterEvent>();
            characterLevelIndex.set(character, index);
            handleCharacterSwitch(ts, character, event.detail.ascendancy, 1, eventLoopIndex);
            characterTsIndex.push(event);
            index.push(event);
        } else if (characterTsIndex.length > 0 && characterTsIndex[characterTsIndex.length - 1].detail.character === character) {
            // characterTsIndex.checkedSet(characterTsIndex.length - 1, event);
            characterTsIndex.push(event);
            if (event.name == "levelUp") {
                computeIfAbsent(characterLevelIndex, character, () => new ContiguousArray()).push(event);
            }
        } else {
            if (characterTsIndex.length > 1) {
                /*
                    backtrack to find likeliest time when character logged in. it is guaranteed that the character event follows the login event.

                    why is this needed? the only true identifying character events are death and levelUp.
                    thus, when either of those events occured, there is NECESSARILY a prior event which matches a character
                    UNLESS the player switched between characters which are both already in a campaign instance 
                    (does that ever happen? - requires switched to character to still have the server instance up)
                    because normally, when a character switch happens, the switched to character will need to join a town or the hideout first
                    
                    keep in mind that this is still highly inaccurate, especially during endgame where identifying character events may not fire
                    for a long time. and a player may choose to alternate characters often.
                    for example, assume character events [A1, B1]: it is possible that between A1 and B1 character C and D were logged in but
                    never fired a character event.
                */
                const prevCharacterEvent = characterTsIndex[characterTsIndex.length - 1];
                const threshold = prevCharacterEvent.ts;
                let originCandidate: LogEvent | null = null;
                for (let y = eventLoopIndex - 1; y >= 0; y--) {
                    const event = events[y];
                    if (event.ts <= threshold) break;

                    switch (event.name) {
                        // TODO check other events
                        case "hideoutEntered":
                            originCandidate = event;
                            break;
                        case "mapEntered":
                            if (originCandidate) break;

                            originCandidate = event;
                    }
                }
                if (originCandidate) {  
                    const levelIndex = characterLevelIndex.get(character);
                    if (levelIndex) {
                        const lastLevelEvent = levelIndex[levelIndex.length - 1];
                        const ascendancy = lastLevelEvent.detail.ascendancy;
                        const level = lastLevelEvent.detail.level;
                        handleCharacterSwitch(originCandidate.ts, character, ascendancy, level, eventLoopIndex);
                    } else if (event.name === 'levelUp') {
                        // TODO check if this is fully correct?
                        const ascendancy = event.detail.ascendancy;
                        const level = event.detail.level - 1;
                        handleCharacterSwitch(originCandidate.ts, character, ascendancy, level, eventLoopIndex);
                    }
                } else {
                    if (isFeatureSupportedAt(Feature.ZoneGeneration, event.ts)) {
                        throw new Error(`unable to determine origin candidate for character ${character} at ts ${event.ts}`);
                    }
                }
            }
            characterTsIndex.push(event);
            if (event.name == "levelUp") {
                computeIfAbsent(characterLevelIndex, character, () => new ContiguousArray()).push(event);
            }
        }
    }
    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        switch (event.name) {
            case "msgLocal":
            case "msgParty":
            case "msgGuild":
            case "levelUp":
            case "death":
            // it is possible that there's a false positive despite this check;
            // when playing with a guild mate for at least one level, but they always join the area first
            if (foreignCharacters.has(event.detail.character)) continue;
            
            handleCharacterEvent(event, i);
            break;
        }
    }
    // create tail event for last active character, otherwise, there is a gap at the end
    const lastCharacterEvent = characterTsIndex[characterTsIndex.length - 1];
    if (lastCharacterEvent) {
        const levelIndex = characterLevelIndex.get(lastCharacterEvent.detail.character)!;
        const lastLevelEvent = levelIndex[levelIndex.length - 1];
        const tailCharacterEvent = SetCharacterEvent.ofEvent(events[events.length - 1].ts, lastLevelEvent);
        characterTsIndex.push(tailCharacterEvent);
    }

    foreignCharacters.forEach(character => {
        characterLevelIndex.delete(character);
    });

    const ownedCharacterTsIndex = characterTsIndex;
    const characterLevelSegmentation = new Map<string, Segmentation[]>();
    for (let i = 0; i < ownedCharacterTsIndex.length - 1; i++) {
        const event = ownedCharacterTsIndex[i];
        const character = event.detail.character;
        let level: number | undefined;
        levelPrev: for (let j = i; j >= 0; j--) {
            // also checks current event
            const prevEvent = ownedCharacterTsIndex[j];
            if (prevEvent.detail.character !== character) {
                break;
            }
            switch (prevEvent.name) {
                case "levelUp":
                case "setCharacter":
                    level = prevEvent.detail.level;
                    break levelPrev;
            }
        }
        if (!level) {
            // corner case, incomplete log file
            levelNext: for (let j = i + 1; j < ownedCharacterTsIndex.length; j++) {
                const nextEvent = ownedCharacterTsIndex[j];
                if (nextEvent.detail.character !== character) {
                    break;
                }
                switch (nextEvent.name) {
                    case "levelUp":
                    case "setCharacter":
                        level = nextEvent.detail.level - 1;
                        break levelNext;
                }
            }
        }
        if (!level) {
            // TODO probably just discard this character
            throw new Error(`no levelUp event found for character ${character} at ts ${event.ts}`);
        }
        const levelIndex: Segmentation[] = computeIfAbsent(characterLevelSegmentation, character, () => new Array(100));
        let prevEvent, nextEvent;
        while (i + 1 < ownedCharacterTsIndex.length) {
            const nextNextEvent = ownedCharacterTsIndex[i + 1];
            const nextNextLevel = (nextNextEvent.detail as {level?: number}).level;
            const characterMismatch = nextNextEvent.detail.character !== character;
            const levelMismatch = typeof nextNextLevel === "number" && nextNextLevel !== level;
            if (characterMismatch || levelMismatch || i + 2 === ownedCharacterTsIndex.length) {
                let segmentation = levelIndex[level - 1];
                if (!segmentation) {
                    segmentation = levelIndex[level - 1] = [];
                }
                if (characterMismatch) {
                    if (!nextEvent) {
                        throw new Error(`expected boundary setCharacter events for character ${character} at level ${level} at ts ${event.ts}`);
                    }
                    const lo = event.ts;
                    const hi = nextEvent.ts;
                    segmentation.push({lo, hi});
                } else {
                    // create an adjacent segmentation for inter-character events
                    const lo = prevEvent?.ts ?? event.ts;
                    const hi = nextNextEvent.ts;
                    segmentation.push({lo, hi});
                }
                break;
            } else {
                i++;
                nextEvent = nextNextEvent;
                prevEvent = event;
            }
        }
    }
    {
        for (const character of characterLevelSegmentation.keys()) {
            const s = characterLevelSegmentation.get(character)!;
            for (let i = 0; i < s.length - 1; i++) {
                if (s[i] === undefined) {
                    let firstEmptySlot = i;
                    while (++i < s.length) {
                        if (s[i] !== undefined) {
                            console.error(`invariant, segmentation has gaps for levels: ${character} ${firstEmptySlot + 1} .. ${i}`, s);
                            break;
                        }
                    }
                }
            }
        }
        for (const event of characterTsIndex) {
            if (event.name === "levelUp" && !foreignCharacters.has(event.detail.character)) {
                const levelIndex = characterLevelSegmentation.get(event.detail.character);
                const s = levelIndex![event.detail.level - 1];
                if (!s) {
                    console.error(`invariant, level index is missing for character ${event.detail.character} at level ${event.detail.level}`, event, levelIndex);
                }
                let found = false;
                for (const range of s) {
                    if (range.lo <= event.ts && range.hi >= event.ts) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    console.error(`invariant, level index did not populate levelUp event for character ${event.detail.character} at level ${event.detail.level}`, event);
                }
            }
        }
    }
    const characters: CharacterInfo[] = [];
    for (const charName of characterLevelIndex.keys()) {
        const levelIndex = characterLevelIndex.get(charName)!;
        if (levelIndex.length === 0) continue;
    
        const lastLevelEvent = levelIndex[levelIndex.length - 1];
        const level = lastLevelEvent.detail.level;
        const ascendancy = lastLevelEvent.detail.ascendancy;
        const lastPlayedTs = characterTsIndex.findLast(e => e.detail.character === charName)!.ts;
        characters.push({
            name: charName,
            level,
            ascendancy,
            createdTs: levelIndex[0].ts,
            lastPlayedTs,
        });
    }
    const sortedCharacters = characters.sort((a, b) => b.lastPlayedTs - a.lastPlayedTs);
    return new CharacterAggregation(characterLevelIndex, ownedCharacterTsIndex, characterLevelSegmentation, sortedCharacters, sortedCharacters);
}

/**
 * @events must be sorted by ts, ascending
 * @returns all characters contained in events that are not owned by the owner of the log
 */
function determineForeignCharacters(events: LogEvent[]): Set<string> {
    const legacyCharacters = new Set<string>();
    const maybeOwnedCharacters = new Set<string>();
    const maybeForeignCharacters = new Set<string>();
    const foreignCharacters = new Set<string>();
    // use this double-pass approach for now, because unapplying foreign characters gets really complicated
    for (let i = 0; i < events.length; i++) {
        const e = events[i];
        switch (e.name) {
            case "levelUp":
                const character = e.detail.character;
                if (isFeatureSupportedAt(Feature.ZoneGeneration, e.ts)) {
                    if (!maybeOwnedCharacters.has(character) && !foreignCharacters.has(character)) {
                        const level = e.detail.level;
                        if (level <= 2) {
                            maybeOwnedCharacters.add(character);
                        } else {
                            let currentLevel = level;
                            for (let y = i; y < events.length; y++) {
                                const nextEvent = events[y];
                                if (nextEvent.detail.character === character) {
                                    if (nextEvent.name === "levelUp") {
                                        if (nextEvent.detail.level !== currentLevel + 1) {
                                            // found non-contiguous levelUp event, it is likely that this character is foreign. 
                                            // note that this is already uncommon, because it requires the foreign character to never trigger a joinedArea event
                                            foreignCharacters.add(character);
                                            break;
                                        } else if (currentLevel - level >= 2) {
                                            // found two subsequent levelUp events, it is likely that this character is owned and the log is incomplete (i.e. missing the creation of the character)
                                            maybeOwnedCharacters.add(character);
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                } else {
                    legacyCharacters.add(character);
                }
                break;
            case "msgLocal":
            case "msgParty":
            case "msgGuild":
            case "death":
                maybeForeignCharacters.add(e.detail.character);
                break;
            case "joinedArea":
                // joinedArea is never fired for the player's own character from the perspective of the player's log
                foreignCharacters.add(e.detail.character);
                break;
        }
    }
    for (const character of maybeForeignCharacters) {
        if (!maybeOwnedCharacters.has(character)) {
            // super common scenario, e.g. whispers from other players that never fire a joinedArea event
            // could make this check more loose (e.g. require level2 levelUp event and / or contiguous & complete levelUp events)
            // to mark incomplete (possibly owned) characters as foreign
            foreignCharacters.add(character);
        }
    }
    for (const character of legacyCharacters) {
        foreignCharacters.add(character);
        if (maybeOwnedCharacters.has(character)) {
            console.warn(`marking character ${character} as foreign because it was created before zone generation was introduced`);
        }
    }
    return foreignCharacters;
}

interface MetricsAggregator {
    walkEvents(fn: (event: LogEvent, key: string | number) => number): void;
    walkMaps(fn: (map: MapInstance, key: string | number) => number): void;
}

export function aggregateBy(agg: LogAggregation, dimension: Dimension, metric: Metric, aggregation: Aggregation): Map<string | number, number> {
    const then = performance.now();
    const res = aggregateBy0(agg, dimension, metric, aggregation);
    logTook("aggregateBy", then, 10);
    return res;
}

function aggregateBy0(agg: LogAggregation, dimension: Dimension, metric: Metric, aggregation: Aggregation): Map<string | number, number> {
    const filter = agg.filter;
    const fromCharacterLevel = agg.filter.fromCharacterLevel;
    const toCharacterLevel = agg.filter.toCharacterLevel;
    const characters = agg.characterAggregation.filteredCharacters.map(c => c.name);
    const events = agg.events;
    let eventDimensionSegmentation: Map<string | number, Segmentation> | undefined;
    let metricAggregator: MetricsAggregator;
    const dataMap = new Map<string | number, number[]>();
    const eventSegmentationMetricsAggregator = (eventDimensionSegmentation: Map<string | number, Segmentation>) => {
        return {
            walkEvents: (fn: (event: LogEvent, key: string | number) => number) => {
                for (const [key, segmentation] of eventDimensionSegmentation.entries()) {
                    const values: number[] = [];
                    for (const range of segmentation) {
                        const loIx = binarySearchFindFirstIx(events, (e) => e.ts >= range.lo);
                        if (loIx === -1) continue;
        
                        const end = range.hi;
                        const hiIx = end ? binarySearchFindLastIx(events, (e) => e.ts <= end) : events.length - 1;
                        if (hiIx === -1) continue;
        
                        for (let i = loIx; i <= hiIx; i++) {
                            const event = events[i];
                            values.push(fn(event, key));
                        }
                    }
                    dataMap.set(key, values);
                }
            },
            walkMaps: (fn: (map: MapInstance, key: string | number) => number) => {
                for (const [key, segmentation] of eventDimensionSegmentation.entries()) {
                    const values: number[] = [];
                    for (const range of segmentation) {
                        const loIx = binarySearchFindFirstIx(agg.maps, (m) => m.span.start >= range.lo);
                        if (loIx === -1) continue;
        
                        const end = range.hi;
                        const hiIx = end ? binarySearchFindLastIx(agg.maps, (m) => !m.span.end || m.span.end <= end) : agg.maps.length - 1;
                        if (hiIx === -1) continue;
        
                        for (let i = loIx; i <= hiIx; i++) {
                            const map = agg.maps[i];
                            values.push(fn(map, key));
                        }
                    }
                    dataMap.set(key, values);
                }
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
        case Dimension.areaLevel:
            metricAggregator = {
                walkEvents: (fn: (event: LogEvent, key: string | number) => number) => {
                    for (const map of agg.maps) {
                        const loIx = binarySearchFindFirstIx(events, (e) => e.ts >= map.span.start);
                        if (loIx === -1) continue;

                        const end = map.span.end;
                        const hiIx = end ? binarySearchFindLastIx(events, (e) => e.ts <= end) : events.length - 1;
                        if (hiIx === -1) continue;

                        const values = computeIfAbsent(dataMap, map.areaLevel, () => []);
                        for (let i = loIx; i <= hiIx; i++) {
                            values.push(fn(events[i], map.areaLevel));
                        }
                    }
                },
                walkMaps: (fn: (map: MapInstance, key: string | number) => number) => {
                    for (const map of agg.maps) {
                        const values = computeIfAbsent(dataMap, map.areaLevel, () => []);
                        values.push(fn(map, map.areaLevel));
                    }
                }
            };
            break;
        case Dimension.none:
            throw new Error("not yet supported");
            break;
    }
    if (metricMeta[metric].type === "event") {
        let lastEventTs = 0;
        metricAggregator.walkEvents((event, _) => {
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
                    found = event.name === 'msgTo' && TRADE_PATTERN.test(event.detail.msg);
                    break;
                case Metric.salesAttempted:
                    found = event.name === 'msgFrom' && TRADE_PATTERN.test(event.detail.msg);
                    break;
                default: throw new Error(`unsupported metric: ${metric}`);
            }
            return found ? 1 : 0;
        });
    } else {
        metricAggregator.walkMaps((map, _) => {
            switch (metric) {
                case Metric.maps:
                    return 1;
                case Metric.totalTime:
                    return MapSpan.mapTimePlusIdle(map.span);
                case Metric.mapTime:
                    return MapSpan.mapTime(map.span);
                case Metric.hideoutTime:
                    return map.span.hideoutTime;
                case Metric.loadTime:
                    return map.span.loadTime;
                case Metric.campaignTime:
                    // FIXME should only count time until campaign is completed (per character), e.g. once the final zone is reached, stop counting campaign zones towards campaign time
                    const zoneInfo = getZoneInfo(map.name, map.areaLevel);
                    return zoneInfo ? MapSpan.mapTimePlusIdle(map.span) : 0;
                default: throw new Error(`unsupported metric: ${metric}`);
            }
        });
    }
    const aggregatedData = new Map<string | number, number>();
    for (const [key, values] of dataMap.entries()) {
        switch(aggregation) {
            case Aggregation.total:
                aggregatedData.set(key, total(values));
                break;
            case Aggregation.average:
                aggregatedData.set(key, average(values));
                break;
            case Aggregation.median:
                aggregatedData.set(key, values.length === 0 ? 0 : medianQuickSelect(values));
                break;
            case Aggregation.exactMedian:
                aggregatedData.set(key, values.length === 0 ? 0 : medianExact(values));
                break;
            case Aggregation.max:
                aggregatedData.set(key, values.length === 0 ? 0 : max(values));
                break;
            case Aggregation.min:
                aggregatedData.set(key, values.length === 0 ? 0 : min(values));
                break;
        }
    }
    return aggregatedData;
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

function computeIfAbsent<K, V>(map: Map<K, V>, key: K, compute: () => V): V {
    const value = map.get(key);
    if (value === undefined) {
        const computed = compute();
        map.set(key, computed);
        return computed;
    }
    return value;
}