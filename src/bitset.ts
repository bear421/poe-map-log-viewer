export class BitSet {
    private readonly words: Uint32Array;
    readonly size: number;
    private static readonly MAX_VALUE = 0xFFFFFFFF;

    constructor(size: number) {
        this.size = size;
        const wordCount = Math.ceil(size / 32);
        this.words = new Uint32Array(wordCount);
    }

    public fill(bit: 0 | 1): void {
        this.words.fill(bit === 1 ? BitSet.MAX_VALUE : 0);
        const remainder = this.size % 32;
        if (remainder > 0) {
            const mask = (1 << remainder) - 1;
            this.words[this.words.length - 1] &= mask;
        }
    }

    public set(index: number): void {
        this.checkIndexBounds(index);
        const wordIndex = Math.floor(index / 32);
        const bitIndex = index % 32;
        this.words[wordIndex] |= (1 << bitIndex);
    }

    public get(index: number): boolean {
        this.checkIndexBounds(index);
        const wordIndex = Math.floor(index / 32);
        const bitIndex = index % 32;
        return (this.words[wordIndex] & (1 << bitIndex)) !== 0;
    }
    
    public clear(index: number): void {
        this.checkIndexBounds(index);
        const wordIndex = Math.floor(index / 32);
        const bitIndex = index % 32;
        this.words[wordIndex] &= ~(1 << bitIndex);
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

    public and(other: BitSet): BitSet {
        if (this.size !== other.size) throw new Error(`BitSets must be of the same size: ${this.size} !== ${other.size}`);

        const result = new BitSet(this.size);
        for (let i = 0; i < this.words.length; i++) {
            result.words[i] = this.words[i] & other.words[i];
        }
        return result;
    }

    public clone(): BitSet {
        const newBitSet = new BitSet(this.size);
        newBitSet.words.set(this.words);
        return newBitSet;
    }

    public static fromIndices(size: number, indices: number[]): BitSet {
        const bitset = new BitSet(size);
        for (const index of indices) {
            bitset.set(index);
        }
        return bitset;
    }
} 