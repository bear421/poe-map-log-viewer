import { EventName, LogEvent } from "../ingest/events";
import { BitSet } from "../bitset";
import { relevantEventNames } from "./aggregation";
import { binarySearchRange } from "../binary-search";
import { MapInstance } from "../ingest/log-tracker";

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
        const { loIx, hiIx } = binarySearchRange(events, map.span.start, map.span.end, e => e.ts, prevHiIx + 1);
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