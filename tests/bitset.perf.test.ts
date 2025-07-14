import { BitSet, DenseBitSet, SparseBitSet } from '../src/bitset';

describe('BitSet Performance', () => {
    const ITERATIONS = 1_000;

    let leftBitSets: BitSet[] = [];
    let rightBitSet: BitSet;

    beforeAll(() => {
        for (let i = 0; i < ITERATIONS; i++) {
            const bitSet = BitSet.of(i);
            for (let j = 0; j < ITERATIONS % 27; j++) {
                bitSet.set(j);
            }
            leftBitSets.push(bitSet.tryOptimize());
        }
        let denseCount = 0;
        let sparseCount = 0;
        leftBitSets.forEach(bitSet => {
            if (bitSet instanceof DenseBitSet) {
                denseCount++;
            } else if (bitSet instanceof SparseBitSet) {
                sparseCount++;
            }
        });
        console.log(`left bitsets distribution - dense: ${denseCount}, sparse: ${sparseCount}`);
        const maxIndex = 60_000;
        rightBitSet = BitSet.of(maxIndex);
        for (let i = 0; i < maxIndex; i++) {
            if (maxIndex % 777 !== 0) {
                rightBitSet.set(i);
            }
        }
    });

    test('BitSet and / cardinality perf test', () => {
        console.time('BitSet and / cardinality perf test');
        let totalCardinality = 0;
        for (let i = 0; i < ITERATIONS; i++) {
            const leftBitSet = leftBitSets[i];
            totalCardinality += BitSet.andAll(leftBitSet, rightBitSet)?.cardinality() ?? 0;
        }
        console.log(`total cardinality: ${totalCardinality}`);
        console.timeEnd('BitSet and / cardinality perf test');
    });

    test('BitSet or / cardinality perf test using NOT', () => {
        const leftBitSetsNot = leftBitSets.map(bitSet => bitSet.not());
        console.time('BitSet or / cardinality perf test using NOT');
        let totalCardinality = 0;
        for (let i = 0; i < ITERATIONS; i++) {
            const leftBitSet = leftBitSetsNot[i];
            totalCardinality += BitSet.andAll(leftBitSet, rightBitSet)?.cardinality() ?? 0;
        }
        console.log(`total cardinality: ${totalCardinality}`);
        console.timeEnd('BitSet or / cardinality perf test using NOT');
    });

    test('BitSet or / cardinality perf test using NOT detailed', async () => {
        const leftBitSetsNot = leftBitSets.map(bitSet => bitSet.not());
        let totalCardinality = 0;
        let tookAnd = 0, tookCardinality = 0;
        for (let i = 0; i < ITERATIONS; i++) {
            const leftBitSet = leftBitSetsNot[i];
            const thenAnd = performance.now();
            const combined = BitSet.andAll(leftBitSet, rightBitSet);
            const thenCardinality = performance.now();
            tookAnd += thenCardinality - thenAnd;
            totalCardinality += combined?.cardinality() ?? 0;
            tookCardinality += performance.now() - thenCardinality;
        }
        console.log(`total cardinality: ${totalCardinality}`);
        console.log(`tookAnd: ${tookAnd}, tookCardinality: ${tookCardinality}, tookTotal: ${tookAnd + tookCardinality}`);
    });
}); 