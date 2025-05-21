import { Filter, MapInstance, MapSpan } from "./instance-tracker";
import { LogEvent } from "./event-dispatcher";
import { binarySearch, BinarySearchMode } from "./binary-search";

export interface LogAggregation {
    maps: MapInstance[];
    events: LogEvent[];
    characters: Map<string, LogEvent>;
    messages: Map<string, LogEvent[]>;
    totalItemsBought: number;
    totalItemsSold: number;
    totalBuysAttempted: number;
    totalSalesAttempted: number;
    totalDeaths: number;
    totalMapTime: number;
    totalLoadTime: number;
    totalHideoutTime: number;
    totalBossKills: number;
    totalSessions: number;
}

const maxSaleOffsetMillis = 1000 * 60 * 10;

export function aggregate(maps: MapInstance[], events: LogEvent[], filter: Filter): LogAggregation {
    maps = Filter.filterMaps(maps, filter);
    events = Filter.filterEvents(events, filter);
    return aggregate0(maps, events);
}

const TRADE_PATTERN = /^(Hi, I would like to buy your|你好，我想購買|안녕하세요, |こんにちは、 |Здравствуйте, хочу купить у вас |Hi, ich möchte |Bonjour, je souhaiterais t'acheter )/;

function aggregate0(maps: MapInstance[], events: LogEvent[]): LogAggregation {
    const foreignCharacters = new Set<string>();
    const characters = new Map<string, any>();
    let characterTsIndex: LogEvent[] = [];
    let totalItemsBought = 0, totalItemsSold = 0, totalBuysAttempted = 0, totalSalesAttempted = 0;
    let totalDeaths = 0;
    const recentSales: LogEvent[] = [];
    const recentBuys: LogEvent[] = [];
    const probableNearbyCharacters = new Map<string, LogEvent>();
    const messages = new Map<string, LogEvent[]>();
    let totalBossKills = 0;
    let totalSessions = 1;
    let prevEvent: LogEvent | null = null;
    eventLoop: for (const event of events) {
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
                    characterTsIndex.push(event);
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
                const discardStaleEvents = (events: LogEvent[]) => {
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
                                totalItemsSold++;
                                recentSales.splice(i, 1);
                                continue eventLoop;
                            }
                        }
                    }
                    if (expectBuy) {
                        for (let i = 0; i < recentBuys.length; i++) {
                            const buy = recentBuys[i];
                            if (probableNearbyCharacters.has(buy.detail.character)) {
                                totalItemsBought++;
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
                        totalItemsBought++;
                    } else {
                        recentSales.pop();
                        totalItemsSold++;
                    }
                } else { // necessarily implies expectBuy
                    recentBuys.pop();
                    totalItemsBought++;
                }
                // while many other heuristics such as load-times and hideout names exist, they likely wouldn't contribute much to accuracy
                break;
            case "levelUp":
                characterTsIndex.push(event);
                characters.set(event.detail.character, event);
                break;
            case "death":
                characterTsIndex.push(event);
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

    let totalMapTime = 0, totalLoadTime = 0, totalHideoutTime = 0;
    for (const map of maps) {
        totalMapTime += MapSpan.mapTime(map.span);
        totalLoadTime += map.span.loadTime;
        totalHideoutTime += map.span.hideoutTime;
    }
    return {
        maps,
        events,
        characters,
        messages,
        totalItemsBought,
        totalItemsSold,
        totalBuysAttempted,
        totalSalesAttempted,
        totalDeaths,
        totalMapTime,
        totalLoadTime,
        totalHideoutTime,
        totalBossKills,
        totalSessions
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