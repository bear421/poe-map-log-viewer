import { MapInstance, MapSpan } from "../ingest/log-tracker";
import { BitSet } from "../bitset";
import { AreaType } from "../ingest/log-tracker";
import { computeIfAbsent } from "../util";
import { LogAggregationCube, MapField, MapOrder } from "./aggregation";

const areaTypes = Object.values(AreaType).filter(v => typeof v === 'number') as AreaType[];

/**
 * @param maps - must be ordered by id (as is the case in LogAggregationCube and BaseLogAggregation)
 */
export function buildAreaTypeBitSetIndex(maps: MapInstance[]): Map<AreaType, BitSet> {
    const res = new Map<AreaType, BitSet>();
    const maxId = maps.length > 0 ? maps[maps.length - 1].id : 0;
    for (const areaType of areaTypes) {
        res.set(areaType, BitSet.of(maxId));
    }
    for (const map of maps) {
        res.get(map.areaType)!.set(map.id);
    }
    optimizeIndex(res);
    return res;
}

export function buildMapNameBitSetIndex(maps: MapInstance[]): Map<string, BitSet> {
    const res = new Map<string, BitSet>();
    const maxId = maps.length > 0 ? maps[maps.length - 1].id : 0;
    for (const map of maps) {
        computeIfAbsent(res, map.name, () => BitSet.of(maxId)).set(map.id);
    }
    optimizeIndex(res);
    return res;
}

export function buildMapsBitSetIndex(maps: MapInstance[]): BitSet {
    if (maps.length === 0) return BitSet.empty();

    const maxId = maps[maps.length - 1].id;
    const res = BitSet.of(maxId);
    for (const map of maps) {
        res.set(map.id);
    }
    return res.tryOptimize();
}

export function optimizeIndex<K>(bitSetIndex: Map<K, BitSet>): void {
    for (const [key, bitSet] of bitSetIndex) {
        bitSetIndex.set(key, bitSet.tryOptimize());
    }
}

/**
 * @param maps - must be ordered by id (as is the case in LogAggregationCube and BaseLogAggregation)
 */
export function shrinkMapBitSetIndex<K>(bitSetIndex: Map<K, BitSet>, maps: MapInstance[]): Map<K, BitSet> {
    const res = new Map<K, BitSet>();
    const maxId = maps.length > 0 ? maps[maps.length - 1].id : 0;
    const keep = BitSet.of(maxId);
    for (const map of maps) {
        keep.set(map.id);
    }
    for (const [key, bitSet] of bitSetIndex) {
        res.set(key, bitSet.and(keep).tryOptimize());
    }
    return res;
}


interface SortedCacheValue {
    source: MapInstance[];
    sorted: MapInstance[];
}

export class IdentityCachingMapSorter {
    private _mapsSorted: Map<number, SortedCacheValue> = new Map();

    sortMaps(maps: MapInstance[], order: MapOrder, agg: LogAggregationCube): MapInstance[] {
        const key = order.field * 2 + (order.ascending ? 0 : 1);
        const present = this._mapsSorted.get(key);
        if (present && present.source === maps) {
            return present.sorted;
        }
        const sorted = sortMaps(maps, order, agg);
        this._mapsSorted.set(key, {source: maps, sorted});
        return sorted;
    }
}

export function sortMaps(maps: MapInstance[], order: MapOrder, agg: LogAggregationCube): MapInstance[] {
    if (order.field == MapField.startedTs) {
        return order.ascending ? maps : maps.toReversed();
    } else {
        const cmp = (a: MapInstance, b: MapInstance) => {
            switch (order.field) {
                case MapField.name:
                    return a.name.localeCompare(b.name);
                case MapField.areaLevel:
                    return a.areaLevel - b.areaLevel;
                case MapField.mapTimePlusIdle:
                    return MapSpan.mapTimePlusIdle(a.span) - MapSpan.mapTimePlusIdle(b.span);
                case MapField.startLevel:
                    // TODO slow?
                    return agg.characterAggregation.guessLevel(a.span.start) - agg.characterAggregation.guessLevel(b.span.start);
                default: throw new Error(`unsupported map field: ${order.field}`);
            }
        }
        return maps.toSorted(order.ascending ? cmp : (a, b) => cmp(b, a));
    }
}