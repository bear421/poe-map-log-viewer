const SHIFT = 5; // 2^5 = 32
const MASK = 31; // 32 − 1
const SPARSE_DENSITY_THRESHOLD = 0.1;

export interface BitSet {
    readonly maxIndex: number;
    readonly sizeHint: number;
    set(index: number): void;
    get(index: number): boolean;
    clear(index: number): void;
    forEach(callback: (index: number) => void): void;
    cardinality(): number;
    and(other: BitSet): BitSet;
    or(other: BitSet): BitSet;
    except(other: BitSet): BitSet;
    not(): BitSet;
    tryOptimize(): BitSet;
    clone(): BitSet;
}

export class DenseBitSet implements BitSet {
    readonly maxIndex: number;
    readonly words: Uint32Array;

    constructor(maxIndex: number, words: Uint32Array = new Uint32Array(Math.ceil((maxIndex + 1) / 32))) {
        this.maxIndex = maxIndex;
        this.words = words;
    }

    toString(): string {
        return `DenseBitSet(cardinality=${this.cardinality()}, maxIndex=${this.maxIndex}, density=${this.density()})`;
    }

    get sizeHint(): number {
        return this.maxIndex;
    }

    set(index: number): void {
        this.checkIndexBounds(index);
        this.words[index >>> SHIFT] |= (1 << (index & MASK));
    }

    get(index: number): boolean {
        return ((this.words[index >>> SHIFT] >>> (index & MASK)) & 1) !== 0;
    }
    
    clear(index: number): void {
        this.checkIndexBounds(index);
        this.words[index >>> SHIFT] &= ~(1 << (index & MASK));
    }

    forEach(callback: (index: number) => void): void {
        for (let i = 0; i < this.words.length; i++) {
            const word = this.words[i];
            if (word === 0) continue;

            for (let j = 0; j < 32; j++) {
                if ((word & (1 << j)) !== 0) {
                    const index = (i * 32) + j;
                    if (index <= this.maxIndex) {
                        callback(index);
                    }
                }
            }
        }
    }

    private checkIndexBounds(index: number): void {
        if (index < 0) throw new Error(`Index out of bounds: ${index} must be non-negative`);

        if (index > this.maxIndex) throw new Error(`Index out of bounds: ${index} must not exceed maxIndex (${this.maxIndex})`);
    }

    cardinality(): number {
        const w = this.words;
        let sum = 0;
    
        // unroll eight 32-bit words per trip
        const n = w.length & ~7; // floor to multiple of 8
        for (let i = 0; i < n; i += 8) {
            sum += this.pop32(w[i  ]) + this.pop32(w[i+1]) +
                   this.pop32(w[i+2]) + this.pop32(w[i+3]) +
                   this.pop32(w[i+4]) + this.pop32(w[i+5]) +
                   this.pop32(w[i+6]) + this.pop32(w[i+7]);
        }
        for (let i = n; i < w.length; ++i) {
            sum += this.pop32(w[i]);
        }
        return sum;
    }

    private pop32(v: number): number {
        v -= (v >>> 1) & 0x55555555;
        v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
        v = (v + (v >>> 4)) & 0x0f0f0f0f;
        return (v * 0x01010101) >>> 24;
    }

    density(): number {
        let count = 0;
        for (let i = 0; i < this.words.length; i++) {
            count += this.words[i] !== 0 ? 1 : 0;
        }
        return count / this.words.length;
    }

    tryOptimize(sparseThreshold: number = SPARSE_DENSITY_THRESHOLD): BitSet {
        if (sparseThreshold < 0 || sparseThreshold > 1) throw new Error(`sparse threshold must be between 0 and 1: ${sparseThreshold}`);

        if (this.density() < sparseThreshold) return new SparseBitSet(this.indices());
        
        let maxWordIndex = -1;
        for (let i = this.words.length - 1; i >= 0; i--) {
            if (this.words[i] !== 0) {
                maxWordIndex = i;
                break;
            }
        }
        if (maxWordIndex === -1) return BitSet.empty();

        if (maxWordIndex >= this.words.length - 1) return this;

        const newSize = (maxWordIndex) * 32;
        const newWords = this.words.subarray(0, maxWordIndex + 1);
        return BitSet.of(newSize, newWords);
    }

    public indices(): number[] {
        const res: number[] = [];
        for (let i = 0; i < this.words.length; i++) {
            const word = this.words[i];
            if (word === 0) continue;

            for (let j = 0; j < 32; j++) {
                if ((word & (1 << j)) !== 0) {
                    const index = (i * 32) + j;
                    if (index <= this.maxIndex) {
                        res.push(index);
                    }
                }
            }
        }
        return res;
    }

    and(other: BitSet): BitSet {
        if (other instanceof DenseBitSet) {
            const res = new DenseBitSet(Math.min(this.maxIndex, other.maxIndex));
            const maxWord = Math.min(this.words.length, other.words.length);
            for (let i = 0; i < maxWord; i++) {
                res.words[i] = this.words[i] & other.words[i];
            }
            return res;
        } else {
            return other.and(this);
        }
    }

    or(other: BitSet): BitSet {
        if (this.sizeHint < other.sizeHint) return other.or(this); // result BitSet may grow

        if (other instanceof DenseBitSet) {
            const res = new DenseBitSet(this.maxIndex);
            for (let i = 0; i < this.words.length; i++) {
                res.words[i] = this.words[i] | other.words[i];
            }
            return res;
        } else {
            return other.or(this);
        }
    }

    except(other: BitSet): BitSet {
        if (other instanceof DenseBitSet) {
            const resWords = this.words.slice();
            const n = Math.min(this.words.length, other.words.length);
            for (let i = 0; i < n; ++i) {
                const mask = other.words[i];
                if (mask !== 0) resWords[i] &= ~mask;
            }
            return new DenseBitSet(this.maxIndex, resWords);
        } else if (other instanceof SparseBitSet) {
            const resWords = this.words.slice();
            for (const idx of other.indices) {
                if (idx <= this.maxIndex) {
                    resWords[idx >>> SHIFT] &= ~(1 << (idx & MASK));
                }
            }
            return new DenseBitSet(this.maxIndex, resWords);
        } else if (other instanceof NotBitSet) {
            return this.and(other.not());
        } else {
            return other.except(this);
        }
    }

    not(): BitSet {
        return new NotBitSet(this);
    }

    clone(): BitSet {
        return new DenseBitSet(this.maxIndex, this.words.slice());
    }
} 

export class SparseBitSet implements BitSet {
    indices: number[];

    constructor(indices: number[] = []) {
        this.indices = indices;
    }

    toString(): string {
        return `SparseBitSet(cardinality=${this.cardinality()}, maxIndex=${this.maxIndex}, density=${this.density()})`;
    }

    get sizeHint(): number {
        return this.indices.length;
    }

    get maxIndex(): number {
        return this.indices.length > 0 ? this.indices[this.indices.length - 1] : -1;
    }

    set(index: number): void {
        const insertionPoint = this.binarySearch(index);
        if (insertionPoint < 0) {
            this.indices.splice(~insertionPoint, 0, index);
        }
    }

    get(index: number): boolean {
        return this.binarySearch(index) >= 0;
    }

    forEach(callback: (index: number) => void): void {
        for (const index of this.indices) {
            callback(index);
        }
    }

    clear(index: number): void {
        const insertionPoint = this.binarySearch(index);
        if (insertionPoint >= 0) {
            this.indices.splice(insertionPoint, 1);
        }
    }

    cardinality(): number {
        return this.indices.length;
    }

    density(): number {
        // TODO maybe calculate density as if this was a DenseBitSet
        return 1;
    }

    tryOptimize(): BitSet {
        // TODO maybe convert to DenseBitSet if density is high enough (useful when starting off as a SparseBitSet)
        return this;
    }

    and(other: BitSet): BitSet {
        if (other instanceof SparseBitSet) {
            const newIndices: number[] = [];
            let i = 0, j = 0;
            while (i < this.indices.length && j < other.indices.length) {
                if (this.indices[i] < other.indices[j]) {
                    i++;
                } else if (this.indices[i] > other.indices[j]) {
                    j++;
                } else {
                    newIndices.push(this.indices[i]);
                    i++;
                    j++;
                }
            }
            return new SparseBitSet(newIndices);
        } else {
            const resIndices = this.indices.filter(index => other.get(index));
            return new SparseBitSet(resIndices);
        }
    }

    or(other: BitSet): BitSet {
        if (other instanceof SparseBitSet) {
            const newIndices: number[] = [];
            let i = 0, j = 0;
            while (i < this.indices.length || j < other.indices.length) {
                if (i < this.indices.length && (j >= other.indices.length || this.indices[i] < other.indices[j])) {
                    newIndices.push(this.indices[i]);
                    i++;
                } else if (j < other.indices.length && (i >= this.indices.length || other.indices[j] < this.indices[i])) {
                    newIndices.push(other.indices[j]);
                    j++;
                } else if (i < this.indices.length && j < other.indices.length) { // they are equal
                    newIndices.push(this.indices[i]);
                    i++;
                    j++;
                }
            }
            return new SparseBitSet(newIndices);
        } else if (other instanceof DenseBitSet) {
            const res = new DenseBitSet(Math.max(this.maxIndex, other.maxIndex));
            res.words.set(other.words);
            for (const index of this.indices) {
                res.set(index);
            }
            return res;
        } else {
            return other.or(this);
        }
    }

    except(other: BitSet): BitSet {
        const newIndices = this.indices.filter(index => !other.get(index));
        return new SparseBitSet(newIndices);
    }

    not(): BitSet {
        return new NotBitSet(this);
    }

    clone(): BitSet {
        return new SparseBitSet(this.indices.slice());
    }

    private binarySearch(value: number): number {
        let low = 0;
        let high = this.indices.length - 1;

        while (low <= high) {
            const mid = (low + high) >>> 1;
            const midVal = this.indices[mid];

            if (midVal < value) {
                low = mid + 1;
            } else if (midVal > value) {
                high = mid - 1;
            } else {
                return mid; 
            }
        }
        return ~low;
    }
}

export class NotBitSet implements BitSet {
    constructor(private readonly bitSet: BitSet) {}
    
    get maxIndex(): number {
        // not well defined, may lead to unexpected behavior
        throw new Error('NotBitSet does not support maxIndex');
    }

    get sizeHint(): number {
        return this.bitSet.sizeHint;
    }

    set(index: number): void {
        this.bitSet.clear(index);
    }

    get(index: number): boolean {
        return !this.bitSet.get(index);
    }

    forEach(_: (index: number) => void): void {
        // not well defined, may lead to unexpected behavior
        throw new Error('NotBitSet does not support forEach');
    }
    
    clear(index: number): void {
        this.bitSet.set(index);
    }

    cardinality(): number {
        // not well defined, may lead to unexpected behavior
        throw new Error('NotBitSet does not support cardinality');
    }

    and(other: BitSet): BitSet {
        // Not(A) AND Not(B) is reducing the space (i.e. expanding the internal BitSet)
        if (other instanceof NotBitSet) return this.bitSet.or(other.bitSet).not();

        return other.except(this.bitSet);
    }

    or(other: BitSet): BitSet {
        // Not(A) OR Not(B) is expanding the space (i.e. shrinking the internal BitSet)
        if (other instanceof NotBitSet) return this.bitSet.and(other.bitSet).not();

        const res = this.bitSet.clone();
        other.forEach(index => res.maxIndex >= index && res.clear(index));
        return res.not();
    }

    except(other: BitSet): BitSet {
        return this.bitSet.except(other).not();
    }

    not(): BitSet {
        return this.bitSet;
    }

    tryOptimize(): BitSet {
        return this.bitSet.tryOptimize().not();
    }

    clone(): BitSet {
        return this.bitSet.clone().not();
    }
}

export namespace BitSet {

    export function ofDense(maxIndex: number, words: Uint32Array = new Uint32Array(Math.ceil((maxIndex + 1) / 32))): BitSet {
        return new DenseBitSet(maxIndex, words);
    }

    export function ofSparse(indices: number[] = []): BitSet {
        return new SparseBitSet(indices);
    }

    export const of = ofDense;

    export function empty(): BitSet {
        return ofDense(0);
    }
    
    export function andAll(...bitSets: (BitSet | undefined)[]): BitSet | undefined {
        const sizeOrder = bitSets.filter(b => b !== undefined).toSorted((a, b) => a.sizeHint - b.sizeHint);
        if (sizeOrder.length === 0) return undefined;

        let res = sizeOrder[0];
        for (let i = 1; i < sizeOrder.length; i++) {
            res = res.and(sizeOrder[i]);
        }
        return res;
    }

    export function orAll(...bitSets: (BitSet | undefined)[]): BitSet | undefined {
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

    export function notAll(...bitSets: (BitSet | undefined)[]): BitSet | undefined {
        return orAll(...bitSets)?.not();
    }

    export function equals(a: BitSet | undefined, b: BitSet | undefined): boolean {
        if (a === b) return true;

        if (!a || !b) return false;

        if (a.sizeHint < b.sizeHint) {
            [a, b] = [b, a];
        }

        if (a instanceof DenseBitSet && b instanceof DenseBitSet) {
            if (a.sizeHint > b.sizeHint) {
                // test if a was shrunk and b wasn't
                for (let i = b.words.length; i < a.words.length; i++) {
                    if (a.words[i] !== 0) return false;
                }
            }

            for (let i = 0; i < b.words.length; i++) {
                if (a.words[i] !== b.words[i]) return false;
            }
        } else {
            if (a.cardinality() !== b.cardinality()) return false;
            
            let sparse: SparseBitSet;
            let other: BitSet;
            if (a instanceof SparseBitSet) {
                sparse = a;
                other = b;
            } else if (b instanceof SparseBitSet) {
                sparse = b;
                other = a;
            } else {
                throw new Error("illegal state: expected a sparse bitset.");
            }

            for (const index of sparse.indices) {
                if (!other.get(index)) return false;
            }
        }
        return true;
    }
}