const SHIFT = 5; // 2^5 = 32
const MASK = 31; // 32 − 1
const MAX_VALUE = 0xFFFFFFFF

export class BitSet {
    private readonly words: Uint32Array;
    readonly size: number;

    constructor(size: number, words: Uint32Array = new Uint32Array(Math.ceil(size / 32))) {
        this.size = size;
        this.words = words;
    }

    public fill(bit: 0 | 1): void {
        this.words.fill(bit === 1 ? MAX_VALUE : 0);
        const remainder = this.size % 32;
        if (remainder > 0) {
            const mask = (1 << remainder) - 1;
            this.words[this.words.length - 1] &= mask;
        }
    }

    public set(index: number): void {
        this.checkIndexBounds(index);
        this.words[index >>> SHIFT] |= (1 << (index & MASK));
    }

    public get(index: number): boolean {
        return ((this.words[index >>> SHIFT] >>> (index & MASK)) & 1) !== 0;
    }
    
    public clear(index: number): void {
        this.checkIndexBounds(index);
        this.words[index >>> SHIFT] &= ~(1 << (index & MASK));
    }

    private checkIndexBounds(index: number): void {
        if (index < 0) throw new Error(`Index out of bounds: ${index} must be non-negative`);

        if (index >= this.size) throw new Error(`Index out of bounds: ${index} must be less than size (${this.size})`);
    }

    public cardinality(): number {
        let count = 0;
        for (let i = 0; i < this.words.length; i++) {
            let word = this.words[i];
            while (word !== 0) {
                word &= (word - 1);
                count++;
            }
        }
        return count;
    }

    public density(): number {
        let count = 0;
        for (let i = 0; i < this.words.length; i++) {
            count += this.words[i] !== 0 ? 1 : 0;
        }
        return count / this.words.length;
    }

    public tryShrink(): BitSet {
        let maxWordIndex = -1;
        for (let i = this.words.length - 1; i >= 0; i--) {
            if (this.words[i] !== 0) {
                maxWordIndex = i;
                break;
            }
        }
        if (maxWordIndex === -1) return new BitSet(0);

        if (maxWordIndex >= this.words.length - 1) return this;

        const newSize = (maxWordIndex + 1) * 32;
        const newWords = this.words.subarray(0, maxWordIndex + 1);
        return new BitSet(newSize, newWords);
    }

    public and(other: BitSet): BitSet {
        if (this.size > other.size) return other.and(this); // result BitSet may shrink

        const result = new BitSet(this.size);
        for (let i = 0; i < this.words.length; i++) {
            result.words[i] = this.words[i] & other.words[i];
        }
        return result;
    }

    public or(other: BitSet): BitSet {
        if (this.size < other.size) return other.or(this); // result BitSet may grow

        const result = new BitSet(this.size);
        for (let i = 0; i < this.words.length; i++) {
            result.words[i] = this.words[i] | other.words[i];
        }
        return result;
    }

    public clone(): BitSet {
        const newBitSet = new BitSet(this.size);
        newBitSet.words.set(this.words);
        return newBitSet;
    }

    public static andAll(...bitSets: (BitSet | undefined)[]): BitSet | undefined {
        const sizeOrder = bitSets.filter(b => b !== undefined).toSorted((a, b) => a.size - b.size);
        if (sizeOrder.length === 0) return undefined;

        let res = sizeOrder[0];
        for (let i = 1; i < sizeOrder.length; i++) {
            res = res.and(sizeOrder[i]);
        }
        return res;
    }

    public static orAll(...bitSets: (BitSet | undefined)[]): BitSet | undefined {
        if (bitSets.length === 0) return undefined;

        let res = bitSets[0];
        for (let i = 1; i < bitSets.length; i++) {
            const bitSet = bitSets[i];
            if (!res) {
                res = bitSet;
            } else if (bitSet) {
                res = res.or(bitSet);
            }
        }
        return res;
    }

    public static equals(a: BitSet | undefined, b: BitSet | undefined): boolean {
        if (a === b) return true;

        if (!a || !b) return false;

        if (a.size < b.size) {
            [a, b] = [b, a];
        }

        if (a.size > b.size) {
            // test if a was shrunk and b wasn't
            for (let i = b.words.length; i < a.words.length; i++) {
                if (a.words[i] !== 0) return false;
            }
        }

        for (let i = 0; i < b.words.length; i++) {
            if (a.words[i] !== b.words[i]) return false;
        }
        return true;
    }

    public static fromIndices(size: number, indices: number[]): BitSet {
        const bitset = new BitSet(size);
        for (const index of indices) {
            bitset.set(index);
        }
        return bitset;
    }
} 