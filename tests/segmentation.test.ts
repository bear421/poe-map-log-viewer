import { Segmentation } from '../src/aggregate/segmentation';

describe('Segmentation.intersect', () => {
    it('should return an empty array if one segmentation is empty', () => {
        const segA: Segmentation = [{ lo: 1, hi: 5 }];
        const segB: Segmentation = [];
        expect(Segmentation.intersect(segA, segB)).toEqual([]);
        expect(Segmentation.intersect(segB, segA)).toEqual([]);
    });

    it('should return an empty array if there is no overlap', () => {
        const segA: Segmentation = [{ lo: 1, hi: 5 }];
        const segB: Segmentation = [{ lo: 6, hi: 10 }];
        expect(Segmentation.intersect(segA, segB)).toEqual([]);
    });

    it('should return the intersection for partial overlap', () => {
        const segA: Segmentation = [{ lo: 1, hi: 5 }];
        const segB: Segmentation = [{ lo: 3, hi: 7 }];
        expect(Segmentation.intersect(segA, segB)).toEqual([{ lo: 3, hi: 5 }]);
    });

    it('should handle when one segment contains another', () => {
        const segA: Segmentation = [{ lo: 1, hi: 10 }];
        const segB: Segmentation = [{ lo: 3, hi: 7 }];
        expect(Segmentation.intersect(segA, segB)).toEqual([{ lo: 3, hi: 7 }]);
        expect(Segmentation.intersect(segB, segA)).toEqual([{ lo: 3, hi: 7 }]);
    });

    it('should handle touching segments (inclusive intersection point)', () => {
        const segA: Segmentation = [{ lo: 1, hi: 5 }];
        const segB: Segmentation = [{ lo: 5, hi: 10 }];
        expect(Segmentation.intersect(segA, segB)).toEqual([{ lo: 5, hi: 5 }]);
    });

    it('should handle identical segments', () => {
        const segA: Segmentation = [{ lo: 1, hi: 5 }];
        const segB: Segmentation = [{ lo: 1, hi: 5 }];
        expect(Segmentation.intersect(segA, segB)).toEqual([{ lo: 1, hi: 5 }]);
    });

    it('should intersect multiple segments correctly', () => {
        const segA: Segmentation = [{ lo: 1, hi: 5 }, { lo: 10, hi: 15 }];
        const segB: Segmentation = [{ lo: 3, hi: 7 }, { lo: 12, hi: 14 }];
        expect(Segmentation.intersect(segA, segB)).toEqual([{ lo: 3, hi: 5 }, { lo: 12, hi: 14 }]);
    });

    it('should handle complex multiple segment intersections', () => {
        const segA: Segmentation = [{ lo: 0, hi: 2 }, { lo: 4, hi: 6 }, { lo: 8, hi: 10 }];
        const segB: Segmentation = [{ lo: 1, hi: 5 }, { lo: 9, hi: 12 }];
        expect(Segmentation.intersect(segA, segB)).toEqual([{ lo: 1, hi: 2 }, { lo: 4, hi: 5 }, { lo: 9, hi: 10 }]);
    });
    
    it('should handle cases where one segmentation is exhausted first', () => {
        const segA: Segmentation = [{ lo: 1, hi: 5 }];
        const segB: Segmentation = [{ lo: 3, hi: 4 }, { lo: 6, hi: 8 }];
        expect(Segmentation.intersect(segA, segB)).toEqual([{ lo: 3, hi: 4 }]);

        const segC: Segmentation = [{ lo: 3, hi: 4 }, { lo: 6, hi: 8 }];
        const segD: Segmentation = [{ lo: 1, hi: 5 }];
        expect(Segmentation.intersect(segC, segD)).toEqual([{ lo: 3, hi: 4 }]);
    });

    it('should handle multiple overlaps and non-overlaps', () => {
        const segA: Segmentation = [{lo: 10, hi: 20}, {lo: 30, hi: 40}, {lo: 50, hi: 60}];
        const segB: Segmentation = [{lo: 15, hi: 25}, {lo: 28, hi: 32}, {lo: 55, hi: 58}, {lo: 70, hi: 80}];
        expect(Segmentation.intersect(segA, segB)).toEqual([{lo:15, hi:20}, {lo:30, hi:32}, {lo:55, hi:58}]);
    });
});

describe('Segmentation.mergeContiguous', () => {
    it('should return an empty array for empty input', () => {
        expect(Segmentation.mergeContiguousConnected([])).toEqual([]);
    });

    it('should return the same segment for a single segment input', () => {
        const seg: Segmentation = [{ lo: 1, hi: 5 }];
        expect(Segmentation.mergeContiguousConnected(seg)).toEqual([{ lo: 1, hi: 5 }]);
    });

    it('should not merge already disjoint segments', () => {
        const segs: Segmentation = [{ lo: 1, hi: 5 }, { lo: 10, hi: 15 }];
        expect(Segmentation.mergeContiguousConnected(segs)).toEqual([{ lo: 1, hi: 5 }, { lo: 10, hi: 15 }]);
    });

    it('should merge touching segments', () => {
        const s: Segmentation = [{ lo: 1, hi: 5 }, { lo: 5, hi: 10 }];
        expect(Segmentation.mergeContiguousConnected(s)).toEqual([{ lo: 1, hi: 10 }]);
        const s2: Segmentation = [{ lo: 1, hi: 5 }, { lo: 5, hi: 10 }, { lo: 10, hi: 15 }, { lo: 15, hi: 20 }, { lo: 20, hi: 25 }, { lo: 25, hi: 30 }, { lo: 31, hi: 35 }];
        expect(Segmentation.mergeContiguousConnected(s2)).toEqual([{ lo: 1, hi: 30 }, { lo: 31, hi: 35 }]);
    });

    it('should merge overlapping segments', () => {
        const s1: Segmentation = [{ lo: 1, hi: 7 }, { lo: 5, hi: 10 }];
        expect(Segmentation.mergeContiguousConnected(s1)).toEqual([{ lo: 1, hi: 10 }]);
        const s2: Segmentation = [{ lo: 1, hi: 7 }, { lo: 5, hi: 10 }, { lo: 12, hi: 13 }];
        expect(Segmentation.mergeContiguousConnected(s2)).toEqual([{ lo: 1, hi: 10 }, { lo: 12, hi: 13 }]);
        const s3: Segmentation = [{ lo: 2, hi: 7 }, { lo: 2, hi: 5 }, { lo: 12, hi: 13 }];
        expect(Segmentation.mergeContiguousConnected(s3)).toEqual([{ lo: 2, hi: 7 }, { lo: 12, hi: 13 }]);
    });

    it('should merge multiple overlapping and contiguous segments', () => {
        const segs: Segmentation = [
            { lo: 1, hi: 5 },
            { lo: 4, hi: 8 },
            { lo: 7, hi: 12 },
            { lo: 15, hi: 20 },
            { lo: 19, hi: 22 }
        ];
        expect(Segmentation.mergeContiguousConnected(segs)).toEqual([{ lo: 1, hi: 12 }, { lo: 15, hi: 22 }]);
    });

    it('should handle segments fully contained within another (after potential prior merge)', () => {
        const segs: Segmentation = [{ lo: 1, hi: 10 }, { lo: 3, hi: 7 }];
        expect(Segmentation.mergeContiguousConnected(segs)).toEqual([{ lo: 1, hi: 10 }]);
    });

    it('should handle three segments merging into one', () => {
        const segs: Segmentation = [{ lo: 1, hi: 5 }, { lo: 3, hi: 7 }, { lo: 6, hi: 10 }];
        expect(Segmentation.mergeContiguousConnected(segs)).toEqual([{ lo: 1, hi: 10 }]);
    });
}); 