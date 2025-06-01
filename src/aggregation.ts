import { Filter, MapInstance, MapSpan, Segmentation } from "./log-tracker";
import { LogEvent, LevelUpEvent, SetCharacterEvent, AnyCharacterEvent, AnyMsgEvent } from "./log-events";
import { binarySearch, binarySearchFindLast, binarySearchFindLastIx, BinarySearchMode, binarySearchRange } from "./binary-search";
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

    constructor(characterLevelIndex: Map<string, (LevelUpEvent|SetCharacterEvent)[]>, characterTsIndex: AnyCharacterEvent[]) {
        this.characterLevelIndex = characterLevelIndex;
        this.characterTsIndex = characterTsIndex;
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

        const k = binarySearchFindLast(levelIndex, (e) => e.ts <= ts);
        if (!k) {
            console.log("why?", ts, anyEvent);
        }
        return k;
    }

    /**
     * @returns any character event before or at the specified timestamp, i.e. the character that was likely active at the specified timestamp
     */
    guessAnyEvent(ts: number): AnyCharacterEvent | undefined {
        return binarySearchFindLast(this.characterTsIndex, (e) => e.ts <= ts);
    }

    guessSegmentation(levelFrom?: number, levelTo?: number, character?: string): Segmentation {
        if (character) {
            const levelIndex = this.characterLevelIndex.get(character);
            if (!levelIndex) throw new Error("illegal state: no level index found for character " + character);

            const segmentation: Segmentation = [];
            const {loIx, hiIx} = binarySearchRange(levelIndex, levelFrom, levelTo, (e) => e.detail.level);
            for (let i = loIx; i < hiIx - 1; i++) {
                segmentation.push({lo: levelIndex[i].ts, hi: levelIndex[i + 1].ts});
            }
            return segmentation.length > 0 ? segmentation : [{lo: levelIndex[loIx].ts, hi: levelIndex[hiIx].ts}];
        } else if (levelFrom || levelTo) {
            const segmentation: Segmentation = [];
            for (const levelIndex of this.characterLevelIndex.values()) {
                const {loIx, hiIx} = binarySearchRange(levelIndex, levelFrom, levelTo, (e) => e.detail.level);
                if (loIx !== -1 && loIx === hiIx) {
                    segmentation.push({lo: levelIndex[loIx].ts, hi: levelIndex[loIx].ts});
                } else {
                    for (let i = loIx; i < hiIx - 1; i++) {
                        segmentation.push({lo: levelIndex[i].ts, hi: levelIndex[i + 1].ts});
                    }
                }
            }
            segmentation.sort((a, b) => a.lo - b.lo);
            return Segmentation.mergeContiguous(segmentation);
        }
        return [];
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
    filter = reassembleFilter(filter, prevAgg);
    maps = Filter.filterMaps(maps, filter);
    events = Filter.filterEvents(events, filter);
    let characterAggregation;
    try {
        characterAggregation = prevAgg ? prevAgg.characterAggregation : buildCharacterAggregation(maps, events);
    } catch (e) {
        console.error("failed to build character aggregation, limited functionality available", e);
        characterAggregation = new CharacterAggregation(new Map(), []);
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

function reassembleFilter(filter: Filter, prevAgg?: LogAggregation): Filter {
    if (!prevAgg) return filter; 
  
    const segmentations: Segmentation[] = [];
    const characterSegmentation = prevAgg.characterAggregation.guessSegmentation(filter.fromCharacterLevel, filter.toCharacterLevel, filter.character);
    characterSegmentation.length && segmentations.push(characterSegmentation);
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
    return {
        maps,
        mapsUnique,
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

function buildCharacterAggregation(maps: MapInstance[], events: LogEvent[]): CharacterAggregation {
    checkContiguous(events);
    // a foreign character is a character that's owned by another player
    const foreignCharacters = new Set<string>();
    const characterLevelIndex = new Map<string, ContiguousArray<LevelUpEvent|SetCharacterEvent>>();
    const characterTsIndex = new ContiguousArray<AnyCharacterEvent>();
    /*
        expands the supplied and prior's character's adjacent character level range by appending a setCharacter event to both
    */
    const expandCharacterRanges = (ts: number, character: string, level: number, eventLoopIndex: number) => {
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
            if (prev.ts > prevTs) {
                // prior character event is after supplied threshold ts, should only be possible for a fresh character after it's levelUp(2) event
                // in the case of death or msg events AFTER character creation but BEFORE the levelUp(2) event
                const ix = binarySearchFindLastIx(characterTsIndex, (e) => e.ts < prevTs);
                if (ix === -1) throw new Error(`illegal state: no prior event found for character ${character} at ts ${prevTs}`);

                const prevCharacter = SetCharacterEvent.of(prevTs, levelLikePrev.detail.character, levelLikePrev.detail.level);
                index.push(prevCharacter);
                // also handle next character with special offset 
                const nextCharacter = SetCharacterEvent.of(ts, character, level);
                characterTsIndex.splice(ix, 0, prevCharacter, nextCharacter);
                // const nextIndex = characterLevelIndex.get(character);
                computeIfAbsent(characterLevelIndex, character, () => new ContiguousArray()).push(nextCharacter);
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
                const prevCharacter = SetCharacterEvent.of(prevTs, levelLikePrev.detail.character, levelLikePrev.detail.level);
                index.push(prevCharacter);
                characterTsIndex.push(prevCharacter);
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
            expandCharacterRanges(ts, character, 1, eventLoopIndex);
            index.push(event);
        } else if (characterTsIndex.length >= 2 
            && characterTsIndex[characterTsIndex.length - 1].detail.character === character 
            && characterTsIndex[characterTsIndex.length - 2].detail.character === character
        ) {
            characterTsIndex.checkedSet(characterTsIndex.length - 1, event);
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
                        // levelIndex may be absent for foreign characters
                        const level = levelIndex[levelIndex.length - 1].detail.level;
                        expandCharacterRanges(originCandidate.ts, character, level, eventLoopIndex);
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
                // it is possible that there's a false positive despite this check;
                // when playing with a guild mate for at least one level, but they always join the area first
                if (characterLevelIndex.has(event.detail.character)) {
                    handleCharacterEvent(event, i);
                }
                break;
            case "levelUp":
            case "death":
                handleCharacterEvent(event, i);
                break;
            case "joinedArea":
                // joinedArea is never fired for the player's own character from the perspective of the player's log
                foreignCharacters.add(event.detail.character);
                break;
        }
    }

    foreignCharacters.forEach(character => {
        characterLevelIndex.delete(character);
    });
    const aliasedCharacterLevelIndex = new Map<string, (LevelUpEvent|SetCharacterEvent)[]>();
    const aliasNameCounters = new Map<string, number>();

    for (const levelIndex of characterLevelIndex.values()) {
        if (!levelIndex || levelIndex.length === 0) throw new Error("illegal state: level index is empty");

        const originalBaseCharacterName = levelIndex[0].detail.character;
        let effectiveCharacterKeyName = originalBaseCharacterName;
        let currentSegmentStartIndex = 0;

        for (let i = 0; i < levelIndex.length; i++) {
            const isLast = (i === levelIndex.length - 1);
            let isEndOfThisContiguousSegment = isLast;

            if (!isLast) {
                const current = levelIndex[i], next = levelIndex[i + 1];
                if (current.ts > next.ts) {
                    // non-contiguity indicates a bug in the character aggregation and necessarily causes follow up bugs elsewhere
                    throw new Error(`illegal state: current ts ${current.ts} > next ts ${next.ts} for character ${current.detail.character}`);
                }
                if (current.detail.level > next.detail.level) {
                    console.info(`found non-contiguous level, aliasing ${originalBaseCharacterName} (${current.detail.level} > ${next.detail.level})`);
                    isEndOfThisContiguousSegment = true;
                }
            }

            if (isEndOfThisContiguousSegment) {
                const segmentData = levelIndex.slice(currentSegmentStartIndex, i + 1);
                
                if (!aliasedCharacterLevelIndex.has(effectiveCharacterKeyName)) {
                    aliasedCharacterLevelIndex.set(effectiveCharacterKeyName, []);
                }
                aliasedCharacterLevelIndex.get(effectiveCharacterKeyName)!.push(...segmentData);

                // alias next segment
                if (!isLast && levelIndex[i].detail.level > levelIndex[i + 1].detail.level) {
                    const aliasNum = (aliasNameCounters.get(originalBaseCharacterName) || 0) + 1;
                    aliasNameCounters.set(originalBaseCharacterName, aliasNum);
                    effectiveCharacterKeyName = `${originalBaseCharacterName} (${aliasNum})`;
                }
                currentSegmentStartIndex = i + 1;
            }
        }
    }

    const ownedCharacterTsIndex = characterTsIndex.filter(e => !foreignCharacters.has(e.detail.character));
    for (let i = 0; i < ownedCharacterTsIndex.length - 1; i++) {
        const event = ownedCharacterTsIndex[i];
        const nextEvent = ownedCharacterTsIndex[i + 1];
        const ts = event.ts, nextTs = nextEvent.ts;
        if (ts > nextTs) {
            // non-contiguity indicates a bug in the character aggregation and necessarily causes follow up bugs elsewhere
            throw new Error(`ts index[${i}] is not contiguous: ${ts} > ${nextTs} (${event.detail.character} > ${nextEvent.detail.character})`);
        }
    }
    return new CharacterAggregation(aliasedCharacterLevelIndex, ownedCharacterTsIndex);
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