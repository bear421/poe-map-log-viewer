class WeakValueLRUMap<K, V extends WeakKey> {
    private readonly map: Map<K, WeakRef<V>>;
    private readonly finalizer = new FinalizationRegistry((key: K) => {
        this.map.delete(key);
    });

    constructor() {
        this.map = new Map<K, WeakRef<V>>();
    }

    get size(): number {
        return this.map.size;
    }

    has(key: K): boolean {
        return this.map.has(key);
    }

    get(key: K): V | undefined {
        const ref = this.map.get(key);
        if (!ref) return undefined;

        // enforce LRU behavior by moving fresh entry to the end
        this.map.delete(key);
        this.map.set(key, ref);
        return ref.deref();
    }

    set(key: K, value: V): V | undefined {
        // enforce LRU behavior by moving fresh entry to the end
        const oldValue = this.delete(key);
        this.map.set(key, new WeakRef(value));
        this.finalizer.register(value, key, value);
        return oldValue;
    }

    delete(key: K): V | undefined {
        const ref = this.map.get(key);
        this.map.delete(key);
        const value = ref?.deref();
        value && this.finalizer.unregister(value);
        return value;
    }

    deleteDereferenced(): number {
        let count = 0;
        for (const [key, ref] of this.map) {
            if (!ref.deref()) {
                this.map.delete(key);
                count++;
            }
        }
        return count;
    }

    deleteOldest(): V | undefined {
        const oldestKey = this.map.keys().next().value;
        return oldestKey && this.delete(oldestKey);
    }

    clear(): void {
        for (const ref of this.map.values()) {
            const value = ref.deref();
            value && this.finalizer.unregister(value);
        }
        this.map.clear();
    }

}

/**
 * simple double-backed LRU cache that uses pseudo soft-values
 */
export class SplitCache<K, V extends WeakKey> {
    // realistically, weak values don't add much;
    // the GC is quite aggressive and will collect values almost immediately after being removed from strongReferences
    private readonly fastCache: WeakValueLRUMap<K, V>;
    private readonly slowCache: WeakValueLRUMap<K, V>;
    private readonly strongReferences: Set<V>;
    private readonly fastCapacity: number;
    private readonly slowCapacity: number;
    private readonly softDurationMillis: number;

    /**
     * @param fastCapacity - the capacity of the fast cache, must be at least 1
     * @param slowCapacity - the capacity of the slow cache, must be at least 1
     * @param softDurationMillis - the duration of the soft value. past this duration the gc is likely to collect the value
     */
    constructor(fastCapacity: number, slowCapacity: number = Math.max(1, fastCapacity / 2), softDurationMillis: number = 30 * 1000) {
        if (fastCapacity < 1) throw new Error("fastCapacity must be at least 1");

        if (slowCapacity < 1) throw new Error("slowCapacity must be at least 1");

        if (softDurationMillis < 1000) throw new Error("softDurationMillis must be at least 1000ms");

        this.fastCache = new WeakValueLRUMap<K, V>();
        this.slowCache = new WeakValueLRUMap<K, V>();
        this.strongReferences = new Set<V>();
        this.fastCapacity = fastCapacity;
        this.slowCapacity = slowCapacity;
        this.softDurationMillis = softDurationMillis;
    }

    has(key: K): boolean {
        return this.fastCache.has(key) || this.slowCache.has(key);
    }

    get(key: K): V | undefined {
        return this.fastCache.get(key) ?? this.slowCache.get(key);
    }

    set(key: K, value: V, fast: boolean): void {
        const targetCache = fast ? this.fastCache : this.slowCache;
        const otherCache = fast ? this.slowCache : this.fastCache;
        
        const deletedValue = otherCache.delete(key);
        deletedValue && this.strongReferences.delete(deletedValue);
        targetCache.set(key, value);
        this.strongReferences.add(value);
        window.setTimeout(() => this.strongReferences.delete(value), this.softDurationMillis);

        const capacity = fast ? this.fastCapacity : this.slowCapacity;
        if (targetCache.size > capacity && !targetCache.deleteDereferenced()) {
            const deletedValue = targetCache.deleteOldest();
            deletedValue && this.strongReferences.delete(deletedValue);
        }
    }

    clear(): void {
        this.fastCache.clear();
        this.slowCache.clear();
        this.strongReferences.clear();
    }
} 