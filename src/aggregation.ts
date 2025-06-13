import { AreaType, Filter, MapInstance, MapSpan, Segmentation, TSRange } from "./log-tracker";
import { LogEvent, LevelUpEvent, SetCharacterEvent, AnyCharacterEvent, AnyMsgEvent, getEventMeta } from "./log-events";
import { binarySearch, binarySearchFindFirstIx, binarySearchFindLast, binarySearchFindLastIx, BinarySearchMode } from "./binary-search";
import { Feature, isFeatureSupportedAt } from "./data/log-versions";
import { freezeIntermediate, logTook } from "./util";

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
     * total number of items bought from players, highly inaccurate because there's no disambiguation between NPC/player tradeAccepted events
     */
    totalItemsBought: number;   
    /**
     * total number of items sold to players, highly inaccurate because there's no disambiguation between NPC/player tradeAccepted events
     */
    totalItemsSold: number;
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
}

export class CharacterAggregation {
    readonly characterLevelIndex: Map<string, (LevelUpEvent|SetCharacterEvent)[]>;
    readonly characterTsIndex: AnyCharacterEvent[];
    readonly characterLevelSegmentation: Map<string, Segmentation[]>;

    constructor(characterLevelIndex: Map<string, (LevelUpEvent|SetCharacterEvent)[]>, characterTsIndex: AnyCharacterEvent[], characterLevelSegmentation: Map<string, Segmentation[]>) {
        this.characterLevelIndex = characterLevelIndex;
        this.characterTsIndex = characterTsIndex;
        this.characterLevelSegmentation = characterLevelSegmentation;
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

    guessSegmentationOld(levelFrom?: number, levelTo?: number, character?: string): Segmentation | undefined {
        if (character) {
            const levelIndex = this.characterLevelIndex.get(character);
            if (!levelIndex) throw new Error("illegal state: no level index found for character " + character);

            return this.guessSegmentationForOld(levelIndex, levelFrom, levelTo);
        } else if (levelFrom || levelTo) {
            const segmentation: Segmentation = [];
            for (const levelIndex of this.characterLevelIndex.values()) {
                const characterSegmentation = this.guessSegmentationForOld(levelIndex, levelFrom, levelTo);
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


    private guessSegmentationForOld(levelIndex: (LevelUpEvent|SetCharacterEvent)[], levelFrom?: number, levelTo?: number): Segmentation | undefined {
        const segmentation: Segmentation = [];
        const loIx = levelFrom ? binarySearchFindFirstIx(levelIndex, (e) => levelFrom <= e.detail.level) : 0;
        if (loIx === -1) return undefined; // levelFrom exceeds highest level reached by character

        let hiIx;
        if (levelTo) {
            // find FIRST character event that is above levelTo to correctly include time spent at that level
            // this event is always a levelUp event, except for level 1
            hiIx = binarySearchFindFirstIx(levelIndex, (e) => levelTo + 1 <= e.detail.level);
            if (hiIx === -1) {
                hiIx = levelIndex.length - 1;
            }
        } else {
            hiIx = levelIndex.length - 1;
        }
        for (let i = loIx; i < hiIx; i++) {
            segmentation.push({lo: levelIndex[i].ts, hi: levelIndex[i + 1].ts});
        }
        return Segmentation.mergeContiguousConnected(segmentation);
    }
}

export interface CharacterInfo {
    level: number;
    ascendancy: string;
    extraPassives: number;
}

const maxSaleOffsetMillis = 1000 * 60 * 10;

export function aggregate(maps: MapInstance[], events: LogEvent[], filter: Filter, prevAgg?: LogAggregation): LogAggregation {
    const then = performance.now();
    const optFilter = reassembleFilter(filter, prevAgg);
    if (optFilter) {
        maps = Filter.filterMaps(maps, optFilter);
        events = Filter.filterEvents(events, optFilter);
    } else {
        maps = [];
        events = [];
    }
    let characterAggregation;
    try {
        characterAggregation = prevAgg ? prevAgg.characterAggregation : buildCharacterAggregation(maps, events);
    } catch (e) {
        console.error("failed to build character aggregation, limited functionality available", e);
        characterAggregation = new CharacterAggregation(new Map(), [], new Map());
    }
    const agg = aggregate0(maps, events, filter, characterAggregation);
    if (prevAgg) {
        return freezeIntermediate({
            ...agg,
            characterAggregation: prevAgg.characterAggregation
        });
    }
    const frozen = freezeIntermediate(agg);
    logTook("aggregate", then);
    return frozen;
}

function reassembleFilter(filter: Filter, prevAgg?: LogAggregation): Filter | undefined {
    if (!prevAgg) return filter; 
  
    const segmentations: Segmentation[] = [];
    const characterSegmentation = prevAgg.characterAggregation.guessSegmentation(filter.fromCharacterLevel, filter.toCharacterLevel, filter.character);
    if (!characterSegmentation) return undefined;

    segmentations.push(characterSegmentation);
    if (filter.tsBounds && filter.tsBounds.length) {
        segmentations.push(filter.tsBounds);
    }
    if (segmentations.length) {
        const newBounds = Segmentation.intersectAll(segmentations);
        return filter.withBounds(newBounds);
    }
    return filter;
}

const TRADE_PATTERN = /^(Hi, I would like to buy your|你好，我想購買|안녕하세요, |こんにちは、 |Здравствуйте, хочу купить у вас |Hi, ich möchte |Bonjour, je souhaiterais t'acheter )/;

function aggregate0(maps: MapInstance[], events: LogEvent[], filter: Filter, characterAggregation: CharacterAggregation): MutableLogAggregation {
    let totalBuys = 0, totalSales = 0, totalBuysAttempted = 0, totalSalesAttempted = 0, totalTrades = 0;
    let totalDeaths = 0, totalWitnessedDeaths = 0;
    const recentSales: AnyCharacterEvent[] = [];
    const recentBuys: AnyCharacterEvent[] = [];
    const probableNearbyCharacters = new Map<string, AnyCharacterEvent>();
    const messages = new Map<string, AnyMsgEvent[]>();
    let totalBossKills = 0;
    let totalSessions = 1;
    let prevEvent: LogEvent | null = null;
    eventLoop: for (let i = 0; i < events.length; i++) {
        const event = events[i];
        if (prevEvent) {
            const tsDelta = event.ts - prevEvent.ts;
            if (tsDelta > 1000 * 60 * 60) {
                totalSessions++;
            }
        }
        prevEvent = event;
        switch (event.name) {
            case "msgFrom":
                if (TRADE_PATTERN.test(event.detail.msg)) {
                    totalSalesAttempted++;
                    recentSales.push(event);
                }
                computeIfAbsent(messages, event.detail.character, () => []).push(event);
                break;
            case "msgTo":
                if (TRADE_PATTERN.test(event.detail.msg)) {
                    totalBuysAttempted++;
                    recentBuys.push(event);
                }
                computeIfAbsent(messages, event.detail.character, () => []).push(event);
                break;
            case "tradeAccepted":
                totalTrades++;
                /*
                    proper trade attribution is impossible without additional user input such as from 3rd party trade tools. here's why:
                    - NPC tradeAccepted events are indistinguishable from player tradeAccepted events
                    - it is not explicitly logged who or what tradeAccepted refers to
                    - whispers to and from Korean users are excluded from the log file (https://www.pathofexile.com/forum/view-thread/2567280/page/4)
                    - it is impossible to accurately track characters in the current instance;
                        when joining an instance with character(s) already present, the client doesn't generate a log of the present character(s) for the joiner
                */
                const thresholdTs = event.ts - maxSaleOffsetMillis;
                const discardStaleEvents = (events: AnyCharacterEvent[]) => {
                    const index = binarySearch(events, thresholdTs, (e) => e.ts, BinarySearchMode.LAST);
                    if (index !== -1) {
                        events.splice(0, index);
                    }
                }
                discardStaleEvents(recentSales);
                discardStaleEvents(recentBuys);
                const expectSale = !!recentSales.length;
                const expectBuy = !!recentBuys.length;
                if (!expectSale && !expectBuy) continue eventLoop;

                // high confidence attributions (still inaccurate)
                if (probableNearbyCharacters.size) {
                    if (expectSale) {
                        for (let i = 0; i < recentSales.length; i++) {
                            const sale = recentSales[i];
                            if (probableNearbyCharacters.has(sale.detail.character)) {
                                totalSales++;
                                recentSales.splice(i, 1);
                                continue eventLoop;
                            }
                        }
                    }
                    if (expectBuy) {
                        for (let i = 0; i < recentBuys.length; i++) {
                            const buy = recentBuys[i];
                            if (probableNearbyCharacters.has(buy.detail.character)) {
                                totalBuys++;
                                recentBuys.splice(i, 1);
                                continue eventLoop;
                            }
                        }
                    }
                }
                // low confidence attributions
                if (expectSale) {
                    if (expectBuy && recentBuys[recentBuys.length - 1].ts > recentSales[recentSales.length - 1].ts) {
                        recentBuys.pop();
                        totalBuys++;
                    } else {
                        recentSales.pop();
                        totalSales++;
                    }
                } else { // necessarily implies expectBuy
                    recentBuys.pop();
                    totalBuys++;
                }
                // while many other heuristics such as load-times and hideout names exist, they likely wouldn't contribute much to accuracy
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
            case "joinedArea":
                probableNearbyCharacters.set(event.detail.character, event);
                break;
            case "leftArea":
                probableNearbyCharacters.delete(event.detail.character);
                break;
            case "areaPostLoad":
                probableNearbyCharacters.clear();
                break;
            case "bossKill":
                // assume pinacle bosses are at least i75+ otherwise this matches campaign bosses such as King in the Mists
                if (event.detail.areaLevel >= 75) {
                    totalBossKills++;
                }
                break;
        }
    }

    let totalMapTime = 0, totalLoadTime = 0, totalHideoutTime = 0;
    for (const map of maps) {
        totalMapTime += MapSpan.mapTime(map.span);
        totalLoadTime += map.span.loadTime;
        totalHideoutTime += map.span.hideoutTime;
    }
    const mapsUnique = maps.filter(m => m.isUnique);
    const mapsDelve = maps.filter(m => m.areaType === AreaType.Delve);
    return {
        maps,
        mapsUnique,
        mapsDelve,
        events,
        messages,
        totalTrades,
        totalItemsBought: totalBuys,
        totalItemsSold: totalSales,
        totalBuysAttempted,
        totalSalesAttempted,
        totalDeaths,
        totalWitnessedDeaths,
        totalMapTime,
        totalLoadTime,
        totalHideoutTime,
        totalBossKills,
        totalSessions,
        characterAggregation
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
    const handleCharacterSwitch = (ts: number, character: string, level: number, eventLoopIndex: number) => {
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
            const prevCharacter = levelLikePrev.detail.character;
            if (prevCharacter === character) {
                throw new Error(`illegal state: prevCharacter === character: ${prevCharacter} === ${character} at ts ${ts}`);
            }
            if (prev.ts > prevTs) {
                // prior character event is after supplied threshold ts, should only be possible for a fresh character after it's levelUp(2) event
                // in the case of death or msg events AFTER character creation but BEFORE the levelUp(2) event
                const ix = binarySearchFindLastIx(characterTsIndex, (e) => e.ts < prevTs);
                if (ix === -1) throw new Error(`illegal state: no prior event found for character ${character} at ts ${prevTs}`);

                const prevCharacterEvent = SetCharacterEvent.of(prevTs, prevCharacter, levelLikePrev.detail.level);
                index.push(prevCharacterEvent);
                // also handle next character with special offset 
                const nextCharacterEvent = SetCharacterEvent.of(ts, character, level);
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
                const prevCharacterEvent = SetCharacterEvent.of(prevTs, prevCharacter, levelLikePrev.detail.level);
                index.push(prevCharacterEvent);
                characterTsIndex.push(prevCharacterEvent);
            }
            break;
        }
        const nextCharacter = SetCharacterEvent.of(ts, character, level);
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
            handleCharacterSwitch(ts, character, 1, eventLoopIndex);
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
                    let level;
                    if (levelIndex) {
                        level = levelIndex[levelIndex.length - 1].detail.level;
                    } else if (event.name === 'levelUp') {
                        // TODO check if this is fully correct?
                        level = event.detail.level - 1;
                    }
                    if (level !== undefined) {
                        handleCharacterSwitch(originCandidate.ts, character, level, eventLoopIndex);
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
        const level = levelIndex[levelIndex.length - 1].detail.level;
        const tailCharacterEvent = SetCharacterEvent.of(events[events.length - 1].ts, lastCharacterEvent.detail.character, level);
        characterTsIndex.push(tailCharacterEvent);
        levelIndex.push(tailCharacterEvent);
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
            if (characterMismatch || levelMismatch || i + 1 === ownedCharacterTsIndex.length) {
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
                    console.error(`invariant, level index is missing for character ${event.detail.character} at level ${event.detail.level}`, event);
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
    return new CharacterAggregation(characterLevelIndex, ownedCharacterTsIndex, characterLevelSegmentation);
}

/**
 * @returns all characters contained in events that are not owned by the owner of the log
 */
function determineForeignCharacters(events: LogEvent[]): Set<string> {
    const legacyCharacters = new Set<string>();
    const maybeOwnedCharacters = new Set<string>();
    const maybeForeignCharacters = new Set<string>();
    const foreignCharacters = new Set<string>();
    // use this double-pass approach for now, because unapplying foreign characters gets really complicated
    for (const e of events) {
        switch (e.name) {
            case "levelUp":
                if (isFeatureSupportedAt(Feature.ZoneGeneration, e.ts)) {
                    maybeOwnedCharacters.add(e.detail.character);
                } else {
                    legacyCharacters.add(e.detail.character);
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

function computeIfAbsent<K, V>(map: Map<K, V>, key: K, compute: () => V): V {
    const value = map.get(key);
    if (value === undefined) {
        const computed = compute();
        map.set(key, computed);
        return computed;
    }
    return value;
}