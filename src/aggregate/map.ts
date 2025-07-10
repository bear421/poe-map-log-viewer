import { MapInstance } from "../ingest/log-tracker";
import { BitSet } from "../bitset";
import { AreaType } from "../ingest/log-tracker";
import { computeIfAbsent } from "../util";

const areaTypes = Object.values(AreaType).filter(v => typeof v === 'number') as AreaType[];

/**
 * @param maps - must be ordered by id (as is the case in LogAggregationCube and BaseLogAggregation)
 */
export function buildAreaTypeBitSetIndex(maps: MapInstance[]): Map<AreaType, BitSet> {
    const res = new Map<AreaType, BitSet>();
    const maxId = maps[maps.length - 1].id;
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
    const maxId = maps[maps.length - 1].id;
    for (const map of maps) {
        computeIfAbsent(res, map.name, () => BitSet.of(maxId)).set(map.id);
    }
    optimizeIndex(res);
    return res;
}

export function buildMapsBitSetIndex(maps: MapInstance[]): BitSet {
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