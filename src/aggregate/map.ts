import { MapInstance, MapMarkerType } from "../ingest/log-tracker";
import { BitSet } from "../bitset";
import { AreaType } from "../ingest/log-tracker";
import { computeIfAbsent } from "../util";
import { LogAggregationCube } from "./aggregation";

const areaTypes = Object.values(AreaType).filter(v => typeof v === 'number') as AreaType[];

/**
 * @param maps must be ordered by id (as is the case in LogAggregationCube and BaseLogAggregation)
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
    const sortedEntries = Array.from(res.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    return new Map(sortedEntries);
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
 * @param maps must be ordered by id (as is the case in LogAggregationCube and BaseLogAggregation)
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

export enum MapField {
    name,
    startedTs,
    areaLevel,
    mapTime,
    startLevel,
}

export interface MapOrder {
    field: MapField;
    ascending: boolean;
    timeContributors?: Set<MapMarkerType>;
}

interface SortedCacheValue {
    source: MapInstance[];
    sorted: MapInstance[];
}

export class IdentityCachingMapSorter {
    private _mapsSorted: Map<number, SortedCacheValue> = new Map();

    sortMaps(maps: MapInstance[], order: MapOrder, agg: LogAggregationCube): MapInstance[] {
        let key = ((order.field << 1) | (order.ascending ? 1 : 0)) << 15;
        if (order.field === MapField.mapTime && order.timeContributors) {
            for (const contributor of order.timeContributors) {
                if (contributor > 15) throw new Error(`marker exceeds max key bits: ${contributor}`);

                key |= 1 << contributor;
            }
        }
        const present = this._mapsSorted.get(key);
        if (present?.source === maps) {
            return present.sorted;
        }
        const presentInversed = this._mapsSorted.get(key ^ 1);
        if (presentInversed?.source === maps) {
            const sorted = presentInversed.sorted.toReversed();
            this._mapsSorted.set(key, {source: maps, sorted});
            return sorted;
        }   
        const sorted = sortMaps(maps, order, agg);
        this._mapsSorted.set(key, {source: maps, sorted});
        return sorted;
    }
}

/**
 * @param maps must be sorted in ascending order by start ts
 */
export function sortMaps(maps: MapInstance[], order: MapOrder, agg: LogAggregationCube): MapInstance[] {
    if (order.field == MapField.startedTs) {
        return order.ascending ? maps : maps.toReversed();
    } else {
        let cmp: (a: MapInstance, b: MapInstance) => number;
        
        switch (order.field) {
            case MapField.name:
                cmp = (a, b) => a.name.localeCompare(b.name);
                break;
            case MapField.areaLevel:
                cmp = (a, b) => a.areaLevel - b.areaLevel;
                break;
            case MapField.mapTime:
                const timeCache = new Map<MapInstance, number>();
                for (const map of maps) {
                    timeCache.set(map, map.getTime(order.timeContributors));
                }
                cmp = (a, b) => timeCache.get(a)! - timeCache.get(b)!;
                break;
            case MapField.startLevel:
                const levelCache = new Map<MapInstance, number>();
                for (const map of maps) {
                    levelCache.set(map, agg.characterAggregation.guessLevel(map.start));
                }
                cmp = (a, b) => levelCache.get(a)! - levelCache.get(b)!;
                break;
            default: 
                throw new Error(`unsupported map field: ${order.field}`);
        }
        
        return maps.toSorted(order.ascending ? cmp : (a, b) => cmp(b, a));
    }
}