import { binarySearchFindLast } from "../binary-search";
import { LogEvent } from "../ingest/events";

export interface TSRange {
    readonly lo: number;
    readonly hi: number;
}

export type Segmentation = TSRange[];
export namespace Segmentation {

    export function ofEvents(events: LogEvent[]): Segmentation {
        const res: TSRange[] = [];
        for (let i = 0; i < events.length - 1; i++) {
            res.push({lo: events[i].ts, hi: events[i + 1].ts});
        }
        return res;
    }

    /**
     * Merges contiguous ranges that are connected (touching or overlapping)
     * @segmentation must be sorted by lo
     */
    export function mergeContiguousConnected(segmentation: Segmentation): Segmentation {
        if (segmentation.length <= 1) return segmentation;

        const res: Segmentation = [];
        for (let i = 0; i < segmentation.length; i++) {
            let range = segmentation[i];
            if (i + 1 >= segmentation.length) {
                res.push(range);
                break;
            }
            while (i + 1 < segmentation.length) {
                const nextRange = segmentation[i + 1];
                if (range.hi >= nextRange.lo) {
                    range = {lo: range.lo, hi: Math.max(range.hi, nextRange.hi)};
                    i++;
                } else {
                    break;
                }
            }
            res.push(range);
        }
        return res;
    }

    export function toBoundingInterval(segmentation: Segmentation): Segmentation {
        if (segmentation.length <= 1) return segmentation;

        return [{lo: segmentation[0].lo, hi: segmentation[segmentation.length - 1].hi}];
    }

    export function intersectAll(segmentations: Segmentation[]): Segmentation {
        if (segmentations.length === 0) return [];

        return segmentations.reduce((a, b) => intersect(a, b), segmentations[0]);
    }
    
    /**
     * Intersects two segmentations using closed intervals [a,b] (including zero-width ranges where a=b).
     * For example:
     * - [1,2] ∩ [2,3] = [2,2] (includes the point where they touch)
     * - [1,3] ∩ [2,4] = [2,3] (includes both endpoints)
     * - [1,2] ∩ [3,4] = [] (no overlap)
     */
    export function intersect(a: Segmentation, b: Segmentation): Segmentation {
        if (a.length === 0 || b.length === 0) return [];
        
        const res: Segmentation = [];
        let iA = 0, iB = 0;
        for (;;) {
            const rangeA = a[iA], rangeB = b[iB];
            const lo = Math.max(rangeA.lo, rangeB.lo);
            const hi = Math.min(rangeA.hi, rangeB.hi);
            if (rangeA.hi > rangeB.hi) {
                if (lo <= hi) {
                    res.push({lo, hi});
                }
                if (++iB >= b.length) break;
            } else if (rangeA.hi < rangeB.hi) {
                if (lo <= hi) {
                    res.push({lo, hi});
                }
                if (++iA >= a.length) break;
            } else {
                if (lo <= hi) {
                    res.push({lo, hi});
                }
                if (++iA >= a.length || ++iB >= b.length) break;
            }
        }
        return res;
    }

    export function find(segmentation: Segmentation, ts: number): TSRange | undefined {
        const candidate = binarySearchFindLast(segmentation, (r) => ts >= r.lo);
        return candidate && candidate.hi >= ts ? candidate : undefined;
    }
}