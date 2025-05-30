import { Filter, MapInstance, MapSpan, Segmentation } from "./log-tracker";
import { LogEvent, LevelUpEvent, SetCharacterEvent, AnyCharacterEvent, AnyMsgEvent } from "./log-events";
import { binarySearch, binarySearchFindLast, BinarySearchMode, binarySearchRange } from "./binary-search";


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
    const characterAggregation = prevAgg ? prevAgg.characterAggregation : buildCharacterAggregation(maps, events);
    const agg = aggregate0(maps, events, filter, characterAggregation);
    if (prevAgg) {
        return freezeIntermediate({
            ...agg,
            characterAggregation: prevAgg.characterAggregation
        });
    }
    const took = performance.now() - then;
    if (took > 20) {
        console.warn("aggregate took ", took, "ms");
    }
    return freezeIntermediate(agg);
}

function freezeIntermediate<T extends Record<PropertyKey, any>>(obj: T): Readonly<T> {
    (Reflect.ownKeys(obj) as (keyof T)[]).forEach(key => {
        const value = obj[key];
        if (value && typeof value === "object") {
            Object.freeze(value);
        }
    });
    return Object.freeze(obj) as Readonly<T>;
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

function buildCharacterAggregation(maps: MapInstance[], events: LogEvent[]): CharacterAggregation {
    const foreignCharacters = new Set<string>();
    const characterLevelIndex = new Map<string, (LevelUpEvent|SetCharacterEvent)[]>();
    const characterTsIndex: AnyCharacterEvent[] = [];
    const expandCharacterRanges = (ts: number, character: string, level: number, eventLoopIndex: number) => {
        /*
            expands the supplied and prior's character's adjacent character level range by appending a setCharacter event to both
        */
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
            const prevTs = binarySearchFindLast(events, (e) => e.ts < ts, 0, eventLoopIndex - 1)?.ts;
            if (!prevTs) {
                throw new Error(`illegal state: no prior event found for character ${character} at ts ${ts}`);
            }
            const shrinkCharacter = SetCharacterEvent.of(prevTs, levelLikePrev.detail.character, levelLikePrev.detail.level);
            index.push(shrinkCharacter);
            characterTsIndex.push(shrinkCharacter);
            break;
        }
        const expandCharacter = SetCharacterEvent.of(ts, character, level);
        characterTsIndex.push(expandCharacter);
        computeIfAbsent(characterLevelIndex, character, () => []).push(expandCharacter);
    };
    const handleCharacterEvent = (event: AnyCharacterEvent, eventLoopIndex: number) => {
        const character = event.detail.character;
        if (event.name == "levelUp" && event.detail.level === 2) {
            // must be in 1st zone
            const map = binarySearchFindLast(maps, (m) => m.span.start < event.ts);
            let ts;
            if (map) {
                ts = map.span.start;
            } else {
                // possible if log is incomplete
                console.warn("log incomplete? failed to find map for level 2 character", event.detail.character, event.ts);
                ts = event.ts - 1;
            }
            if (characterLevelIndex.has(character)) {
                // FIXME handle character name reuse, maybe with an alias
                console.warn("duplicate characters not supported yet, discarding prior character data", character);
            }
            const index: (LevelUpEvent|SetCharacterEvent)[] = [];
            characterLevelIndex.set(character, index);
            expandCharacterRanges(ts, character, 1, eventLoopIndex);
            index.push(event);
        } else if (characterTsIndex.length >= 2 
            && characterTsIndex[characterTsIndex.length - 1].detail.character === character 
            && characterTsIndex[characterTsIndex.length - 2].detail.character === character
        ) {
            characterTsIndex[characterTsIndex.length - 1] = event;
            if (event.name == "levelUp") {
                computeIfAbsent(characterLevelIndex, character, () => []).push(event);
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
                computeIfAbsent(characterLevelIndex, character, () => []).push(event);
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
    for (const levelIndex of characterLevelIndex.values()) {
        for (let i = 0; i < levelIndex.length - 1; i++) {
            const level = levelIndex[i].detail.level, nextLevel = levelIndex[i + 1].detail.level;
            if (level > nextLevel) {
                console.log(levelIndex);
                throw new Error(`character index[${i}] is not contiguous: ${level} > ${nextLevel} (${levelIndex[i].detail.character})`);
            }
        }
    }
    const ownedCharacterTsIndex = characterTsIndex.filter(e => !foreignCharacters.has(e.detail.character));
    for (let i = 0; i < ownedCharacterTsIndex.length - 1; i++) {
        const event = ownedCharacterTsIndex[i];
        const nextEvent = ownedCharacterTsIndex[i + 1];
        const ts = event.ts, nextTs = nextEvent.ts;
        if (ts > nextTs) {
            console.error(new Date(ts), new Date(nextTs));
            throw new Error(`ts index[${i}] is not contiguous: ${ts} > ${nextTs} (${event.detail.character} > ${nextEvent.detail.character})`);
        }
    }
    return new CharacterAggregation(characterLevelIndex, ownedCharacterTsIndex);
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