export function createElementFromHTML(html: string): HTMLElement {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    return template.content.firstElementChild as HTMLElement;
}

export function deepFreeze<T extends Record<PropertyKey, any>>(obj: T): Readonly<T> {
    const then = performance.now();
    freeze0(obj);
    logTook("deepFreeze", then);
    return obj;
}

function freeze0<T extends Record<PropertyKey, any>>(obj: T): Readonly<T> {
    (Reflect.ownKeys(obj) as (keyof T)[]).forEach(key => {
        const value = obj[key];
        if (value && typeof value === "object") {
            deepFreeze(value);
        }
    });
    return Object.freeze(obj) as Readonly<T>;
}


declare const scheduler: any;

class FrameBarrierImpl {
    private static readonly MIN_CHECK_FREQUENCY = 10;
    private static readonly MAX_CHECK_FREQUENCY = 10_000_000;
    private static rafTook: number = 0;
    private static readonly yieldFn = async () => {
        const then = performance.now();
        if (typeof scheduler === "object" && typeof scheduler.yield === "function") {
            await scheduler.yield();
        } else {
            await new Promise<void>(r => requestAnimationFrame(() => r()));
        }
        FrameBarrierImpl.rafTook += performance.now() - then;
    };
    private then: number;
    private step: number;
    private checkFrequency: number;
    constructor(initialCheckFrequency: number = 1024 * 128, private msThreshold: number = 5) {
        this.then = performance.now();
        this.step = 0;
        this.checkFrequency = initialCheckFrequency;
    }

    public shouldYield(): boolean {
        if (++this.step < this.checkFrequency) return false;
        
        const took = performance.now() - this.then;
        if (took > this.msThreshold) {
            if (took > this.msThreshold * 3) {
                this.checkFrequency = Math.max(this.checkFrequency / 2, FrameBarrierImpl.MIN_CHECK_FREQUENCY);
            }
            this.then = performance.now();
            this.step = 0;
            return true;
        } else if (took < this.msThreshold / 3) {
            this.checkFrequency = Math.min(this.checkFrequency * 2, FrameBarrierImpl.MAX_CHECK_FREQUENCY);
        }
        return false;
    }

    public yield(): Promise<void> {
        return FrameBarrierImpl.yieldFn();
    }

    public static rafTotalMillis(): number {
        return FrameBarrierImpl.rafTook;
    }
}

class NoopFrameBarrier {
    public shouldYield(): boolean {
        return false;
    }

    public yield(): Promise<void> {
        return undefined as any;
    }
}

const HAS_RAF = typeof self !== 'undefined' && typeof (self as any).requestAnimationFrame === 'function';
export const FrameBarrier = HAS_RAF ? FrameBarrierImpl : NoopFrameBarrier;

export class Measurement {
    private then: number;
    private thenRafTook: number;
    constructor() {
        this.then = performance.now();
        this.thenRafTook = FrameBarrierImpl.rafTotalMillis();
    }

    public logTook(name: string, logThresholdMs: number = 10): number {
        const took = performance.now() - this.then;
        if (took < logThresholdMs) return took;

        let msg = name + " took " + (Math.ceil(took * 100) / 100) + " ms";
        const rafTook = FrameBarrierImpl.rafTotalMillis() - this.thenRafTook;
        const rafTookRounded = (Math.ceil(rafTook * 100) / 100);
        if (rafTookRounded > 0) {
            msg += ", (of which) RAF took " + rafTookRounded + " ms";
        }
        console.warn(msg);
        return took;
    }
}

export function freezeIntermediate<T extends Record<PropertyKey, any>>(obj: T): Readonly<T> {
    const then = performance.now();
    (Reflect.ownKeys(obj) as (keyof T)[]).forEach(key => {
        const value = obj[key];
        if (value && typeof value === "object") {
            Object.freeze(value);
        }
    });
    const frozen = Object.freeze(obj) as Readonly<T>;
    logTook("freezeIntermediate", then);
    return frozen;
}

export function logTook(name: string, then: number, logThresholdMs: number = 10): number {
    const took = performance.now() - then;
    if (took > logThresholdMs) {
        console.warn(name + " took " + (Math.ceil(took * 100) / 100) + " ms");
    }
    return took;
}


export class ContiguousArray<T extends {ts: number}> extends Array<T> {
    push(...items: T[]) {
        if (items.length) {
            checkContiguous(items);
            if (this.length > 0) {
                const tail = this[this.length - 1];
                const itemHead = items[0];
                if (itemHead.ts < tail.ts) {
                    throw new Error(`new element precedes prior element: ${itemHead.ts} < ${tail.ts}`);
                }
            }
        }
        return super.push(...items);
    }

    unshift(...items: T[]) {
        if (items.length) {
            checkContiguous(items);
            if (this.length) {
                const head = this[0];
                const itemTail = items[items.length - 1];
                if (itemTail.ts > head.ts) {
                    throw new Error(`new tail[${items.length - 1}] succeeds current head[0]: ${itemTail.ts} > ${head.ts}`);
                }
            }
        }
        return super.unshift(...items);
    }

    checkedSet(ix: number, item: T) {
        if (ix < 0 || ix >= this.length) {
            throw new Error(`index out of bounds: ${ix} is not in range [0, ${this.length})`);
        }
        if (ix > 0) {
            const prev = this[ix - 1];
            if (item.ts < prev.ts) {
                throw new Error(`new element precedes prior element: ${item.ts} < ${prev.ts}`);
            }
        }
        if (ix < this.length - 1) {
            const next = this[ix + 1];
            if (item.ts > next.ts) {
                throw new Error(`new element succeeds next element: ${item.ts} > ${next.ts}`);
            }
        }
        super[ix] = item;
    }

    sort(): this {
        throw new Error("must not sort a contiguous array");
    }

    reverse(): this {
        throw new Error("must not reverse a contiguous array");
    }

    copyWithin(): this {
        throw new Error("unsupported");
    }

    fill(): this {
        throw new Error("unsupported");
    }

    splice(ix: number, delCount: number, ...items: T[]) {
        if (items.length) {
            checkContiguous(items);
            if (this.length) {
                if (items[0].ts < this[ix - 1].ts) {
                    throw new Error(`new head[0] precedes prior element: ${items[0].ts} < ${this[ix - 1].ts}`);
                }
                if (items[items.length - 1].ts > this[ix].ts) {
                    throw new Error(`new tail[${items.length - 1}] precedes prior element: ${items[items.length - 1].ts} > ${this[ix].ts}`);
                }
            }
        }
        return super.splice(ix, delCount, ...items);
    }
}

export function checkContiguous<T extends {ts: number}>(items: T[]) {
    for (let i = 0; i < items.length - 1; i++) {
        const prev = items[i];
        const next = items[i + 1];
        if (prev.ts > next.ts) {
            const e = new Error(`element[${i}] precedes element[${i + 1}]: ${next.ts} < ${prev.ts}`,
                { cause: { prev, next } }
            );
            console.error(e, e.cause);
            throw e;
        }
    }
}

export function computeIfAbsent<K, V>(map: Map<K, V>, key: K, compute: () => V): V {
    const value = map.get(key);
    if (value === undefined) {
        const computed = compute();
        map.set(key, computed);
        return computed;
    }
    return value;
}

export function memoize<T>(fn: () => T): () => T {
    let done = false;
    let value: T;
    return () => {
        if (!done) {
            value = fn();
            done = true;
        }
        return value;
    };
}

export function toBitFlags(flags: Iterable<number>): number {
    let res = 0;
    for (const flag of flags) {
        if (flag < 0 || flag > 31) throw new Error(`flag out of range: ${flag}`);
        
        res |= 1 << flag;
    }
    return res;
}

import { createPopper, Instance } from '@popperjs/core';

export class DynamicTooltip {
    private tooltipElement: HTMLElement;
    private popperTarget: HTMLElement;
    private popperInstance: Instance;
    private tooltipInner: HTMLElement;
    
    constructor(tooltipBody: string) {
        this.tooltipElement = createElementFromHTML(`
            <div class="tooltip map-event-tooltip bs-tooltip-auto fade hide" role="tooltip">
                <div class="tooltip-arrow"></div>
                <div class="tooltip-inner">${tooltipBody}</div>
            </div>
        `);
        this.tooltipInner = this.tooltipElement.querySelector('.tooltip-inner') as HTMLElement;
        document.body.appendChild(this.tooltipElement);
        this.popperTarget = document.body;
        const virtualRef = { 
            getBoundingClientRect: () => this.popperTarget.getBoundingClientRect()
        };
        this.popperInstance = createPopper(virtualRef, this.tooltipElement, {
            placement: 'top',
            modifiers: [
                {
                    name: 'offset',
                    options: {
                        offset: [0, 8],
                    },
                },
                {
                    name: 'arrow', 
                    options: {
                        element: this.tooltipElement.querySelector('.tooltip-arrow'),
                        padding: 4,
                    }
                },
                {
                    name: 'preventOverflow',
                    options: { padding: 8 },
                },
                {
                    name: 'flip',
                    options: { fallbackPlacements: ['bottom', 'left', 'right'] },
                }
            ],
        });

    }

    public getTooltipElement(): HTMLElement {
        return this.tooltipElement;
    }

    public hook(target: HTMLElement, render: (inner: HTMLElement, e: MouseEvent) => HTMLElement | undefined): void {
        target.addEventListener('mouseover', (e) => {
            const target = render(this.tooltipInner, e);
            if (target) {
                this.update(target);
                this.show();
            }
        });
        target.addEventListener('mouseout', () => {
            this.hide();
        });
    }

    public update(target: HTMLElement): void {
        this.popperTarget = target;
        this.popperInstance.update();
    }

    public show(): void {
        this.tooltipElement.classList.add('show');
    }

    public hide(): void {
        this.tooltipElement.classList.remove('show');
    }

    public destroy(): void {
        this.popperInstance.destroy();
        this.tooltipElement.remove();
    }
}

export function formatDuration(milliseconds: number): string {
    if (milliseconds < 0) {
        return "0s";
    }

    let totalSeconds = Math.floor(milliseconds / 1000);

    const hours = Math.floor(totalSeconds / 3600);
    totalSeconds %= 3600;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    const parts: string[] = [];
    if (hours > 0) {
        parts.push(`${hours}h`);
    }
    if (minutes > 0) {
        parts.push(`${minutes}m`);
    }
    if (seconds > 0 || parts.length === 0) {
        parts.push(`${seconds}s`);
    }

    return parts.join(' ');
}

export function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}