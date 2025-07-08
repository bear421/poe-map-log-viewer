import { EventName, LogEvent } from "../ingest/events";
import { BitSet } from "../bitset";
import { relevantEventNames } from "./aggregation";
import { binarySearchRange } from "../binary-search";
import { MapInstance } from "../ingest/log-tracker";

export function buildBitsetIndex(maps: MapInstance[], events: LogEvent[]): Map<EventName, BitSet> {
    const res = new Map<EventName, BitSet>();
    const maxId = maps[maps.length - 1].id;
    for (const eventName of relevantEventNames) {
        res.set(eventName, new BitSet(maxId + 1));
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
    return res;
}

export function shrinkBitsets(bitSetIndex: Map<EventName, BitSet>, maps: MapInstance[]): Map<EventName, BitSet> {
    const res = new Map<EventName, BitSet>();
    const maxId = maps.length > 0 ? maps[maps.length - 1].id : 0;
    for (const eventName of relevantEventNames) {
        res.set(eventName, new BitSet(maxId + 1));
    }
    for (const eventName of relevantEventNames) {
        const bitSet = bitSetIndex.get(eventName)!;
        for (const map of maps) {
            if (bitSet.get(map.id)) {
                res.get(eventName)!.set(map.id);
            }
        }
    }
    return res;
}