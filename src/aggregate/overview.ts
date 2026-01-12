import { FrameBarrier } from "../util";
import { AreaType, MapInstance, MapMarkerType } from "../ingest/log-tracker";
import { OverviewAggregation, LogAggregationCube } from "./aggregation";
import { BitSet } from "../bitset";

export async function  buildOverviewAggregation(agg: LogAggregationCube): Promise<OverviewAggregation> {
    let totalTrades = 0;
    let totalDeaths = 0, totalWitnessedDeaths = 0;
    let totalBossKills = 0;
    let totalSessions = 0;
    const filter = agg.filter;
    const sessionsSegmentation = agg.base.sessionsSegmentation;
    let sessionIx = 0;
    let nextSessionRange = sessionsSegmentation[sessionIx];
    for (let i = 0, fb = new FrameBarrier(); i < agg.events.length; i++) {
        if (fb.shouldYield()) await fb.yield();

        const event = agg.events[i];
        if (nextSessionRange) {
            if (event.ts >= nextSessionRange.lo && event.ts <= nextSessionRange.hi) {
                nextSessionRange = sessionsSegmentation[++sessionIx];
                totalSessions++;
            } else if (event.ts > nextSessionRange.hi) {
                nextSessionRange = sessionsSegmentation[++sessionIx];
            }
        }
        switch (event.name) {
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
                // assume pinnacle bosses are at least i75+ otherwise this matches campaign bosses such as King in the Mists
                if (event.detail.areaLevel >= 75) {
                    totalBossKills++;
                }
                break;
        }
    }

    let totalMapTime = 0, totalLoadTime = 0, totalHideoutTime = 0, totalAFKTime = 0;
    const mapsUnique: MapInstance[] = [];
    const mapsDelve: MapInstance[] = [];
    const fb = new FrameBarrier();
    for (const map of agg.maps) {
        if (fb.shouldYield()) await fb.yield();

        const times = map.getTimeMap();
        totalMapTime += times.get(MapMarkerType.map) ?? 0;
        totalLoadTime += times.get(MapMarkerType.load) ?? 0;
        totalHideoutTime += times.get(MapMarkerType.hideout) ?? 0;
        totalAFKTime += times.get(MapMarkerType.afk) ?? 0;
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
        totalDeaths,
        totalWitnessedDeaths,
        totalMapTime,
        totalLoadTime,
        totalHideoutTime,
        totalAFKTime,
        totalBossKills,
        totalSessions,
    };
}

export function buildBetterOverviewAggregation(agg: LogAggregationCube): any {
    const eventBitSetIndex = agg.base.eventBitSetIndex;
    const areaTypeBitSetIndex = agg.base.areaTypeBitSetIndex;
    const baseBitSet = agg.simpleFilterMapsBitSet;
    
    const bossKills = BitSet.andAll(baseBitSet, eventBitSetIndex.get("bossKill"))?.cardinality() ?? 0;
    const mapsDelve = BitSet.andAll(baseBitSet, areaTypeBitSetIndex.get(AreaType.Delve))?.cardinality() ?? 0;
    return {
        bossKills,
        mapsDelve
    };
}