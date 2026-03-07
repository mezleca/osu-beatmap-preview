export type LruEvictReason = "evict" | "delete" | "clear" | "replace";

export type LruEvictCallback<K, V> = (key: K, value: V, reason: LruEvictReason) => void;

/**
 * simple lru cache backed by map insertion order.
 * newest items stay at the end, oldest items are evicted first.
 */
export class LruCache<K, V> {
    private items = new Map<K, V>();
    private max_entries: number;
    private on_evict?: LruEvictCallback<K, V>;

    constructor(max_entries: number, on_evict?: LruEvictCallback<K, V>) {
        this.max_entries = Math.max(1, Math.floor(max_entries));
        this.on_evict = on_evict;
    }

    get size(): number {
        return this.items.size;
    }

    has(key: K): boolean {
        return this.items.has(key);
    }

    /** gets the value and marks it as recently used. */
    get(key: K): V | undefined {
        const value = this.items.get(key);
        if (value === undefined) {
            return undefined;
        }

        this.items.delete(key);
        this.items.set(key, value);
        return value;
    }

    /** inserts or replaces a value and enforces capacity. */
    set(key: K, value: V): void {
        if (this.items.has(key)) {
            const previous = this.items.get(key) as V;
            this.items.delete(key);
            this.emit_evict(key, previous, "replace");
        }

        this.items.set(key, value);
        this.enforce_capacity();
    }

    /** marks an existing key as recently used. */
    touch(key: K): boolean {
        const value = this.items.get(key);
        if (value === undefined) {
            return false;
        }

        this.items.delete(key);
        this.items.set(key, value);
        return true;
    }

    /** removes one key and triggers the eviction callback. */
    delete(key: K): boolean {
        const value = this.items.get(key);
        if (value === undefined) {
            return false;
        }

        this.items.delete(key);
        this.emit_evict(key, value, "delete");
        return true;
    }

    /** clears all keys and triggers the eviction callback for each item. */
    clear(): void {
        if (this.items.size === 0) {
            return;
        }

        const entries = Array.from(this.items.entries());
        this.items.clear();
        for (let i = 0; i < entries.length; i++) {
            this.emit_evict(entries[i][0], entries[i][1], "clear");
        }
    }

    /** updates capacity and evicts old entries if needed. */
    set_capacity(max_entries: number): void {
        this.max_entries = Math.max(1, Math.floor(max_entries));
        this.enforce_capacity();
    }

    /** evicts one oldest item, returns true when something was evicted. */
    evict_oldest(): boolean {
        const iterator = this.items.entries().next();
        if (iterator.done) {
            return false;
        }

        const [key, value] = iterator.value;
        this.items.delete(key);
        this.emit_evict(key, value, "evict");
        return true;
    }

    entries(): IterableIterator<[K, V]> {
        return this.items.entries();
    }

    private enforce_capacity(): void {
        while (this.items.size > this.max_entries) {
            this.evict_oldest();
        }
    }

    private emit_evict(key: K, value: V, reason: LruEvictReason): void {
        if (this.on_evict) {
            this.on_evict(key, value, reason);
        }
    }
}
