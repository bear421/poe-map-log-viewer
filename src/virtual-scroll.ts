import { createElementFromHTML } from "./util";

export type VirtualScrollRenderCallback = (startIndex: number, endIndex: number) => void;

export class VirtualScroll {
    private rowHeight: number;
    private bufferRows: number;
    private renderCallback: VirtualScrollRenderCallback;

    private hostContainer: HTMLElement | null = null;
    private contentElement: HTMLElement | null = null;
    private spacerElement: HTMLElement | null = null;

    private totalItems: number = 0;
    private scrollTop: number = 0;
    public visibleStartIndex: number = 0;
    public visibleEndIndex: number = 0;

    private eventListenerAttached: boolean = false;
    private currentRAFId: number | null = null;

    constructor(
        rowHeight: number,
        bufferRows: number,
        renderCallback: VirtualScrollRenderCallback
    ) {
        this.rowHeight = rowHeight;
        this.bufferRows = bufferRows;
        this.renderCallback = renderCallback;
    }

    public initialize(
        hostContainer: HTMLElement,
        contentElement: HTMLElement,
        spacerElement: HTMLElement
    ): void {
        this.hostContainer = hostContainer;
        this.contentElement = contentElement;
        this.spacerElement = spacerElement;
    }

    public updateData(totalItems: number): void {
        this.totalItems = totalItems;
        if (this.spacerElement) {
            this.spacerElement.style.height = `${Math.max(0, this.totalItems * this.rowHeight)}px`;
        }
        this.performScrollUpdate(true);
    }

    public attach(): void {
        if (!this.eventListenerAttached && this.hostContainer) {
            window.addEventListener('scroll', this.scheduleScrollUpdate, { passive: true });
            this.eventListenerAttached = true;
            this.scheduleScrollUpdate(); 
        }
    }

    public detach(): void {
        if (this.eventListenerAttached) {
            window.removeEventListener('scroll', this.scheduleScrollUpdate);
            this.eventListenerAttached = false;
            if (this.currentRAFId !== null) {
                cancelAnimationFrame(this.currentRAFId);
                this.currentRAFId = null;
            }
        }
    }

    public reset(): void {
        this.scrollTop = 0;
        this.visibleStartIndex = 0;
        this.visibleEndIndex = 0; 
        if (this.contentElement) {
            this.contentElement.style.transform = 'translateY(0px)';
        }
        if (this.totalItems > 0) {
            this.performScrollUpdate(true); 
        }
    }
    
    private scheduleScrollUpdate = (): void => {
        if (this.currentRAFId !== null) {
            cancelAnimationFrame(this.currentRAFId);
        }
        this.currentRAFId = requestAnimationFrame(() => {
            this.performScrollUpdate();
            this.currentRAFId = null;
        });
    };

    private performScrollUpdate(forceRender: boolean = false): void {
        if (!this.hostContainer || !this.contentElement || !this.spacerElement) return;

        const rect = this.hostContainer.getBoundingClientRect();

        // If the container is completely off-screen, do nothing.
        if (rect.bottom < 0 || rect.top > window.innerHeight) {
            return;
        }

        this.scrollTop = Math.max(0, -rect.top);
        
        if (this.totalItems === 0) {
            this.visibleStartIndex = 0;
            this.visibleEndIndex = -1; 
            this.contentElement.style.transform = 'translateY(0px)';
            if (forceRender) {
                this.doRender(this.visibleStartIndex, this.visibleEndIndex);
            }
            return;
        }

        // Calculate the actual visible height of the container
        const visibleHeight = window.innerHeight - Math.max(0, rect.top);
        const visibleRowCount = Math.ceil(visibleHeight / this.rowHeight);

        const newStartIndex = Math.max(0, Math.floor(this.scrollTop / this.rowHeight) - this.bufferRows);
        const newEndIndex = Math.min(
            this.totalItems - 1,
            newStartIndex + visibleRowCount + (2 * this.bufferRows)
        );

        const hasVisibilityChanged = newStartIndex !== this.visibleStartIndex || newEndIndex !== this.visibleEndIndex;

        if (forceRender || hasVisibilityChanged) {
            this.visibleStartIndex = newStartIndex;
            this.visibleEndIndex = newEndIndex;

            this.contentElement.style.transform = `translateY(${this.visibleStartIndex * this.rowHeight}px)`;
            this.doRender(this.visibleStartIndex, this.visibleEndIndex);
        }
    }

    private doRender(startIndex: number, endIndex: number): void {
        this.renderCallback(startIndex, endIndex);
    }
} 