import { Filter, MapInstance, MapSpan, TSRange, Segmentation } from "./log-tracker";
import { LogEvent, CharacterEvent, LevelUpEvent, MsgEvent, SetCharacterEvent } from "./log-events";
import { binarySearch, BinarySearchMode } from "./binary-search";

export interface LogAggregation {
    maps: MapInstance[];
    events: LogEvent[];
    messages: Map<string, MsgEvent[]>;
    totalItemsBought: number;
    totalItemsSold: number;
    totalBuysAttempted: number;
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

export interface CharacterAggregation {
    characters: Map<string, LevelUpEvent>;
    characterLevelIndex: LevelUpEvent[];
    characterTsIndex: CharacterEvent[];
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
    const agg = aggregate0(maps, events, filter);
    if (prevAgg) {
        agg.characterAggregation = prevAgg.characterAggregation;
    }
    const took = performance.now() - then;
    if (took > 20) {
        console.warn("aggregate took ", took, "ms");
    }
    return agg;
}

function reassembleFilter(filter: Filter, prevAgg?: LogAggregation): Filter {
    if (!prevAgg) return filter;

    const segmentations: Segmentation[] = [];
    if (filter.fromCharacterLevel || filter.toCharacterLevel) {
        const shrunkCharacterLevelIndex = prevAgg.characterAggregation.characterLevelIndex.filter(e => {
            if (filter.character && e.detail.character !== filter.character) return false;

            if (filter.fromCharacterLevel && e.detail.level < filter.fromCharacterLevel) return false;

            if (filter.toCharacterLevel && e.detail.level > filter.toCharacterLevel) return false;

            return true;
        });
        // FIXME include lower close boundary and upper close boundary (??) (e.g. character is still level 100 or character is lte level 2 (during strand))
        // technically this is currently equal to:
        // const x: Segmentation = [{lo: shrunkCharacterLevelIndex[0].ts, hi: shrunkCharacterLevelIndex[shrunkCharacterLevelIndex.length - 1].ts}];
        segmentations.push(Segmentation.toBoundingInterval(Segmentation.ofEvents(shrunkCharacterLevelIndex)));
    }
    if (filter.character && prevAgg.characterAggregation.characterTsIndex.length > 1) {
        const characterSegmentation: Segmentation = [];
        const characterTsIndex = prevAgg.characterAggregation.characterTsIndex;
        outer: for (let i = 0; i < characterTsIndex.length; i++) {
            const event = characterTsIndex[i];
            if (event.detail.character !== filter.character) continue;
            
            const lo = i === 0 ? -Infinity : event.ts;
            do {
                if (i + 1 >= characterTsIndex.length) {
                    characterSegmentation.push({lo, hi: Infinity});
                    break outer;
                }
                i++;
                const nextEvent = characterTsIndex[i];
                if (nextEvent.detail.character === filter.character) {
                    continue;
                }
                characterSegmentation.push({lo, hi: nextEvent.ts});
                break;
            } while (i < characterTsIndex.length);
        }
        characterSegmentation.length && segmentations.push(characterSegmentation);
    }
    if (segmentations.length) {
        if (filter.tsBounds) {
            segmentations.push(filter.tsBounds);
        }
        return filter.withBounds(Segmentation.intersectAll(segmentations));
    }
    return filter;
}

const TRADE_PATTERN = /^(Hi, I would like to buy your|你好，我想購買|안녕하세요, |こんにちは、 |Здравствуйте, хочу купить у вас |Hi, ich möchte |Bonjour, je souhaiterais t'acheter )/;

function aggregate0(maps: MapInstance[], events: LogEvent[], filter: Filter): LogAggregation {
    const foreignCharacters = new Set<string>();
    const characters = new Map<string, LevelUpEvent>();
    const characterLevelIndex: LevelUpEvent[] = [];
    const characterTsIndex: CharacterEvent[] = [];
    const handleCharacterEvent = (characterEvent: CharacterEvent, i: number) => {
        const character = characterEvent.detail.character;
        if (characterTsIndex.length >= 2 
            && characterTsIndex[characterTsIndex.length - 1].detail.character === character 
            && characterTsIndex[characterTsIndex.length - 2].detail.character === character
        ) {
            characterTsIndex[characterTsIndex.length - 1] = characterEvent;
        } else {
            if (characterTsIndex.length > 1) {
                /*
                    backtrack to find likeliest time when character logged in. 
                    why is this needed? the only true identifying character events are death and levelUp.
                    thus, when either of those events occured, there is NECESSARILY a prior event which matches a character
                    UNLESS the player switched between characters which are both already in a campaign instance 
                    (does that ever happen? - requires switched to character to still have the server instance up)
                    because normally, when a character switch happens, the switched to character will need to join a town or the hideout first
                */
                const prevCharacterEvent = characterTsIndex[characterTsIndex.length - 1];
                const threshold = prevCharacterEvent.ts;
                let originCandidate: LogEvent | null = null;
                for (let y = i - 1; y >= 0; y--) {
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
                    characterTsIndex.push(SetCharacterEvent.of(originCandidate.ts, character));
                }
            }
            characterTsIndex.push(characterEvent);
        }
    }
    let totalBuys = 0, totalSales = 0, totalBuysAttempted = 0, totalSalesAttempted = 0;
    let totalDeaths = 0;
    const recentSales: CharacterEvent[] = [];
    const recentBuys: CharacterEvent[] = [];
    const probableNearbyCharacters = new Map<string, CharacterEvent>();
    const messages = new Map<string, MsgEvent[]>();
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
            case "msgLocal":
            case "msgParty":
                if (characters.has(event.detail.character)) {
                    handleCharacterEvent(event, i);
                }
                break;
            case "tradeAccepted":
                /*
                    proper trade attribution is impossible without additional user input such as from 3rd party trade tools. here's why:
                    - it is not explicitly logged who or what tradeAccepted refers to
                    - whispers to and from Korean users are excluded from the log file (https://www.pathofexile.com/forum/view-thread/2567280/page/4)
                    - it is impossible to accurately track characters in the current instance;
                        when joining an instance with character(s) already present, the client doesn't generate a log of the present character(s) for the joiner
                */
                const thresholdTs = event.ts - maxSaleOffsetMillis;
                const discardStaleEvents = (events: CharacterEvent[]) => {
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
            case "levelUp":
                handleCharacterEvent(event, i);
                characters.set(event.detail.character, event);
                characterLevelIndex.push(event);
                break;
            case "death":
                handleCharacterEvent(event, i);
                if (filter.fromAreaLevel && event.detail.areaLevel < filter.fromAreaLevel) break;

                if (filter.toAreaLevel && event.detail.areaLevel > filter.toAreaLevel) break;

                // FIXME split between deaths / witnessed deaths depending on foreign characters
                totalDeaths++;
                break;
            case "joinedArea":
                foreignCharacters.add(event.detail.character);
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

    foreignCharacters.forEach(character => {
        characters.delete(character);
    });

    const compactedCharacterTsIndex: CharacterEvent[] = [];
    outer: for (let i = 0; i < characterTsIndex.length; i++) {
        const event = characterTsIndex[i];
        if (!characters.has(event.detail.character)) continue;

        compactedCharacterTsIndex.push(event);
        const character = event.detail.character;
        do {
            i++;
            if (i >= characterTsIndex.length) break outer;

            const nextEvent = characterTsIndex[i];
            if (!characters.has(nextEvent.detail.character)) continue outer;

            if (nextEvent.detail.character === character && i + 1 < characterTsIndex.length) {
                const nextNextEvent = characterTsIndex[i + 1];
                if (nextNextEvent.detail.character === character) continue;

                compactedCharacterTsIndex.push(nextEvent);
                continue outer;
            } else {
                compactedCharacterTsIndex.push(nextEvent);
            }
        } while (i < characterTsIndex.length);
    }

    let totalMapTime = 0, totalLoadTime = 0, totalHideoutTime = 0;
    for (const map of maps) {
        totalMapTime += MapSpan.mapTime(map.span);
        totalLoadTime += map.span.loadTime;
        totalHideoutTime += map.span.hideoutTime;
    }
    return {
        maps,
        events,
        messages,
        totalItemsBought: totalBuys,
        totalItemsSold: totalSales,
        totalBuysAttempted,
        totalSalesAttempted,
        totalDeaths,
        totalWitnessedDeaths: 0, // TODO
        totalMapTime,
        totalLoadTime,
        totalHideoutTime,
        totalBossKills,
        totalSessions,
        characterAggregation: {
            characters,
            characterLevelIndex,
            characterTsIndex: compactedCharacterTsIndex
        }
    };
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