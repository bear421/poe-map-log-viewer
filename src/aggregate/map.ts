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
        res.set(areaType, new BitSet(maxId + 1));
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
        computeIfAbsent(res, map.name, () => new BitSet(maxId + 1)).set(map.id);
    }
    optimizeIndex(res);
    return res;
}

export function optimizeIndex<K>(bitSetIndex: Map<K, BitSet>): void {
    for (const [key, bitSet] of bitSetIndex) {
        bitSetIndex.set(key, bitSet.tryShrink());
    }
}

/**
 * @param maps - must be ordered by id (as is the case in LogAggregationCube and BaseLogAggregation)
 */
export function shrinkMapBitSetIndex<K>(bitSetIndex: Map<K, BitSet>, maps: MapInstance[]): Map<K, BitSet> {
    const res = new Map<K, BitSet>();
    const maxId = maps.length > 0 ? maps[maps.length - 1].id : 0;
    const keep = new BitSet(maxId + 1);
    for (const map of maps) {
        keep.set(map.id);
    }
    for (const [key, bitSet] of bitSetIndex) {
        res.set(key, bitSet.and(keep).tryShrink());
    }
    return res;
}