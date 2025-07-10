import { binarySearchFindFirstIx, binarySearchFindLastIx, binarySearchRange } from "../binary-search";
import { BitSet } from "../bitset";
import { LogEvent } from "../ingest/events";
import { MapInstance } from "../ingest/log-tracker";
import { Segmentation } from "./segmentation";

export class Filter {
    userTsBounds: Segmentation;
    tsBounds: Segmentation;
    fromAreaLevel?: number;
    toAreaLevel?: number;
    fromCharacterLevel?: number;
    toCharacterLevel?: number;
    character?: string;
    mapBitSet?: BitSet;

    constructor(
        userTsBounds?: Segmentation,
        tsBounds?: Segmentation,
        fromAreaLevel?: number,
        toAreaLevel?: number,
        fromCharacterLevel?: number,
        toCharacterLevel?: number,
        character?: string,
        mapBitSet?: BitSet
    ) {
        this.userTsBounds = userTsBounds ?? [];
        this.tsBounds = tsBounds ?? [];
        this.fromAreaLevel = fromAreaLevel;
        this.toAreaLevel = toAreaLevel;
        this.fromCharacterLevel = fromCharacterLevel;
        this.toCharacterLevel = toCharacterLevel;
        this.character = character;
        this.mapBitSet = mapBitSet;
    }

    withBounds(tsBounds: Segmentation): Filter {
        return new Filter(this.userTsBounds, tsBounds, this.fromAreaLevel, this.toAreaLevel, this.fromCharacterLevel, this.toCharacterLevel, this.character, this.mapBitSet);
    }

}

export namespace Filter {
    export function isEmpty(filter?: Filter): boolean {
        if (!filter) return true;

        let hasFiniteBounds;
        if (filter.tsBounds) {
            if (filter.tsBounds.length === 1) {
                hasFiniteBounds = filter.tsBounds[0].lo !== -Infinity || filter.tsBounds[0].hi !== Infinity;
            } else {
                hasFiniteBounds = filter.tsBounds.length > 1;
            }
        } else {
            hasFiniteBounds = false;
        }
        return !hasFiniteBounds && !filter.fromAreaLevel && !filter.toAreaLevel && !filter.character;
    }

    export function testAreaLevel(map: MapInstance, filter?: Filter): boolean {
        if (!filter) return true;

        if (filter.fromAreaLevel && map.areaLevel < filter.fromAreaLevel) return false;

        if (filter.toAreaLevel && map.areaLevel > filter.toAreaLevel) return false;

        return true;
    }

    export function filterMaps(maps: MapInstance[], filter: Filter): MapInstance[] {
        if (Filter.isEmpty(filter)) return maps;

        const tsBounds = filter.tsBounds;
        if (!filter.fromAreaLevel && !filter.toAreaLevel && tsBounds.length > 0) {
            let ix = 0;
            const res = [];
            for (const { lo, hi } of tsBounds) {
                const boundsLoIx = binarySearchFindFirstIx(maps, (m) => m.span.start >= lo, ix);
                if (boundsLoIx === -1) continue;

                const boundsHiIx = binarySearchFindLastIx(maps, (m) => m.span.start <= hi, ix);
                if (boundsHiIx === -1) continue;

                if (tsBounds.length === 1 && boundsLoIx === 0 && boundsHiIx === maps.length - 1) return maps;

                for (let i = boundsLoIx; i <= boundsHiIx; i++) {
                    res.push(maps[i]);
                }
                ix = boundsHiIx + 1;
            }
            return res;
        }
        const res = [];
        if (tsBounds.length > 0) {
            let ix = 0, hiIx = maps.length - 1;
            for (const { lo, hi } of tsBounds) {
                const { loIx: boundsLoIx, hiIx: boundsHiIx } = binarySearchRange(maps, lo, hi, (m) => m.span.start, ix, hiIx);
                if (boundsLoIx === -1) continue;

                for (let i = boundsLoIx; i <= boundsHiIx; i++) {
                    const map = maps[i];
                    if (filter.fromAreaLevel && map.areaLevel < filter.fromAreaLevel) continue;

                    if (filter.toAreaLevel && map.areaLevel > filter.toAreaLevel) continue;

                    res.push(map);
                }
                ix = boundsHiIx + 1;
            }
        } else {
            for (let i = 0; i < maps.length; i++) {
                const map = maps[i];
                if (filter.fromAreaLevel && map.areaLevel < filter.fromAreaLevel) continue;

                if (filter.toAreaLevel && map.areaLevel > filter.toAreaLevel) continue;

                res.push(map);
            }
        }
        return res;
    }

    export function filterEvents(events: LogEvent[], filter: Filter): LogEvent[] {
        const tsBounds = filter.tsBounds;
        if (tsBounds.length === 0) return events;

        let ix = 0, hiIx = events.length - 1;
        let res: LogEvent[] = [];
        for (const { lo, hi } of tsBounds) {
            const { loIx: boundsLoIx, hiIx: boundsHiIx } = binarySearchRange(events, lo, hi, (e) => e.ts, ix, hiIx);

            if (boundsLoIx === -1) continue;

            if (tsBounds.length === 1 && boundsLoIx === 0 && boundsHiIx === events.length - 1) return events;

            for (let i = boundsLoIx; i <= boundsHiIx; i++) {
                res.push(events[i]);
            }
            ix = boundsHiIx + 1;
        }
        return res;
    }
}