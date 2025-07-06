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
    constructor(private msThreshold: number = 5, initialCheckFrequency: number = 1024 * 128) {
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

export function checkContiguous<T>(array: T[], extractValue: (t: T) => number): void {
    for (let i = 0; i < array.length - 1; i++) {
        const value = extractValue(array[i]);
        const nextValue = extractValue(array[i + 1]);
        if (value > nextValue) {
            console.error(`array[${i}] is not contiguous: ${value} > ${nextValue}`, array[i], array[i + 1], array);
            throw new Error(`array[${i}] is not contiguous: ${value} > ${nextValue}`);
        }
    }
}

declare const Popper: any;
export class DynamicTooltip {
    private tooltipElement: HTMLElement;
    private popperTarget: HTMLElement;
    private popperInstance: any;
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
        this.popperInstance = Popper.createPopper(virtualRef, this.tooltipElement, {
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