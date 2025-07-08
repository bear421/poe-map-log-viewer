import { FrameBarrier } from "../util";
import { AreaType, MapInstance, MapSpan } from "../ingest/log-tracker";
import { OverviewAggregation, SESSION_THRESHOLD_MILLIS, TRADE_REGEX, LogAggregationCube } from "./aggregation";
import { LogEvent } from "../ingest/events";

export async function buildOverviewAggregation(agg: LogAggregationCube): Promise<OverviewAggregation> {
    let totalBuysAttempted = 0, totalSalesAttempted = 0, totalTrades = 0;
    let totalDeaths = 0, totalWitnessedDeaths = 0;
    let totalBossKills = 0;
    let totalSessions = 1;
    let prevEvent: LogEvent | null = null;
    const filter = agg.filter;
    for (let i = 0, fb = new FrameBarrier(); i < agg.events.length; i++) {
        if (fb.shouldYield()) await fb.yield();

        const event = agg.events[i];
        if (prevEvent) {
            const tsDelta = event.ts - prevEvent.ts;
            if (tsDelta > SESSION_THRESHOLD_MILLIS) {
                totalSessions++;
            }
        }
        prevEvent = event;
        switch (event.name) {
            case "msgFrom":
                if (TRADE_REGEX.test(event.detail.msg)) {
                    totalSalesAttempted++;
                }
                break;
            case "msgTo":
                if (TRADE_REGEX.test(event.detail.msg)) {
                    totalBuysAttempted++;
                }
                break;
            case "tradeAccepted":
                totalTrades++;
                break;
            case "death":
                if (filter.fromAreaLevel && event.detail.areaLevel < filter.fromAreaLevel) break;

                if (filter.toAreaLevel && event.detail.areaLevel > filter.toAreaLevel) break;

                if (agg.characterAggregation.isOwned(event.detail.character)) {
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
    const fb = new FrameBarrier();
    for (const map of agg.maps) {
        if (fb.shouldYield()) await fb.yield();

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
        mapsUnique,
        mapsDelve,
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
    };
}