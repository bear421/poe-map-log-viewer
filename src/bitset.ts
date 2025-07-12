const SHIFT = 5; // 2^5 = 32
const MASK = 31; // 32 − 1
const MAX_VALUE = 0xFFFFFFFF
const SPARSE_DENSITY_THRESHOLD = 0.5;

export interface BitSet {
    readonly maxIndex: number;
    readonly sizeHint: number;
    set(index: number): void;
    get(index: number): boolean;
    clear(index: number): void;
    cardinality(): number;
    and(other: BitSet): BitSet;
    or(other: BitSet): BitSet;
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

        if (index > this.maxIndex) throw new Error(`Index out of bounds: ${index} must not exceed maxIndex (${this.maxIndex})`);
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

    public tryOptimize(sparseThreshold: number = SPARSE_DENSITY_THRESHOLD): BitSet {
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

        const newSize = (maxWordIndex + 1) * 32;
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

    public and(other: BitSet): BitSet {
        if (this.sizeHint > other.sizeHint) return other.and(this); // result BitSet may shrink

        if (other instanceof DenseBitSet) {
            const res = new DenseBitSet(this.maxIndex);
            for (let i = 0; i < this.words.length; i++) {
                res.words[i] = this.words[i] & other.words[i];
            }
            return res;
        } else {
            return other.and(this);
        }
    }

    public or(other: BitSet): BitSet {
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

    public clone(): BitSet {
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
            const newIndices = this.indices.filter(index => index < other.maxIndex && other.get(index));
            return new SparseBitSet(newIndices);
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
        }
        throw new Error(`unsupported BitSet impl: ${other.constructor.name}`);
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