export class RingBuffer<T> {

    private buf: Array<T>;
    private head: number = 0;
    private size: number = 0;
    
    constructor(private capacity: number) {
        if (capacity <= 0) throw new Error(`capacity must be positive: ${capacity}`);

        this.buf = new Array<T>(capacity);
    }

    push(...items: T[]): number {
        for (const item of items) {
            this.buf[this.head] = item;
            this.head = (this.head + 1) % this.capacity;
            if (this.size < this.capacity) {
                this.size++;
            }
        }
        return this.size;
    }

    get length(): number {
        return this.size;
    }

    [Symbol.iterator](): Iterator<T> {
        let current = 0;
        const start = (this.capacity + this.head - this.size) % this.capacity;
        
        return {
            next: (): IteratorResult<T> => {
                if (current >= this.size) {
                    return { done: true, value: undefined };
                }
                const index = (start + current) % this.capacity;
                current++;
                return { done: false, value: this.buf[index] };
            }
        };
    }

    toArray(): T[] {
        return [...this];   
    }

    clear(): void {
        this.head = 0;
        this.size = 0;
        this.buf = new Array<T>(this.capacity);
    }

    first(): T | undefined {
        if (this.size === 0) return undefined;

        const start = (this.capacity + this.head - this.size) % this.capacity;
        return this.buf[start];
    }

    last(): T | undefined {
        if (this.size === 0) return undefined;

        const lastIndex = (this.head - 1 + this.capacity) % this.capacity;
        return this.buf[lastIndex];
    }

} 