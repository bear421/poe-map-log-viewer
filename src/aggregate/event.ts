import { EventName, LogEvent } from "../ingest/events";
import { BitSet } from "../bitset";
import { relevantEventNames, SESSION_THRESHOLD_MILLIS } from "./aggregation";
import { binarySearchRange } from "../binary-search";
import { MapInstance } from "../ingest/log-tracker";
import { Segmentation } from "./segmentation";

/**
 * @param maps - must be ordered by id (as is the case in LogAggregationCube and BaseLogAggregation)
 * @param events - must be sorted by ts (as is the case in LogAggregationCube and BaseLogAggregation)
 */
export function buildEventBitSetIndex(maps: MapInstance[], events: LogEvent[]): Map<EventName, BitSet> {
    const res = new Map<EventName, BitSet>();
    const maxId = maps[maps.length - 1].id;
    for (const eventName of relevantEventNames) {
        res.set(eventName, BitSet.of(maxId));
    }
    let prevHiIx = 0;
    for (const map of maps) {
        const { loIx, hiIx } = binarySearchRange(events, map.start, map.end, e => e.ts, prevHiIx + 1);
        if (loIx === -1) continue;

        const eventsInMap = new Set<EventName>();
        for (let i = loIx; i <= hiIx; i++) {
            const event = events[i];
            if (relevantEventNames.has(event.name)) {
                eventsInMap.add(event.name);
            }
        }

        for (const eventName of eventsInMap) {
            res.get(eventName)!.set(map.id);
        }
        prevHiIx = hiIx;
    }
    for (const [key, bitSet] of res) {
        res.set(key, bitSet.tryOptimize());
    }
    return res;
}

export function buildSessionsSegmentation(maps: MapInstance[]): Segmentation {
    if (maps.length === 0) return [];

    const res: Segmentation = [];
    let loMap = maps[0];
    for (let i = 1; i < maps.length; i++) {
        const map = maps[i], prevMap = maps[i - 1];
        const tsDelta = map.start - prevMap.end;
        if (tsDelta > SESSION_THRESHOLD_MILLIS) {
            res.push({lo: loMap.start, hi: prevMap.end});
            loMap = map;
        }
    }
    if (loMap) {
        const tailMap = maps[maps.length - 1];
        res.push({lo: loMap.start, hi: tailMap.end});
    }
    return res;
}