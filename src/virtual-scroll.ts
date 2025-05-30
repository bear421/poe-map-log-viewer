export type VirtualScrollRenderCallback = (startIndex: number, endIndex: number) => void;

export class VirtualScroll {
    private rowHeight: number;
    private bufferRows: number;
    private renderCallback: VirtualScrollRenderCallback;

    private hostContainer: HTMLElement | null = null;
    private contentElement: HTMLElement | null = null;
    private spacerElement: HTMLElement | null = null;

    private totalItems: number = 0;
    private scrollTop: number = 0; // Effective scroll within the list, relative to hostContainer top
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

    public updateData(totalItems: number, rowHeight: number): void {
        console.log("updateData", totalItems, rowHeight);
        this.totalItems = totalItems;
        this.rowHeight = rowHeight;
        if (this.spacerElement) {
            this.spacerElement.style.height = `${Math.max(0, this.totalItems * this.rowHeight)}px`;
        }
        this.performScrollUpdate(true);
    }

    public attach(): void {
        if (!this.eventListenerAttached && this.hostContainer) {
            window.addEventListener('scroll', this.scheduleScrollUpdate, { passive: true });
            this.eventListenerAttached = true;
            // Initial calculation
            this.scheduleScrollUpdate(); 
        } else if (!this.hostContainer) {
            console.warn("VirtualScroll: Scaffolding not initialized before attaching listeners.");
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
        // The effective scroll will be recalculated on the next scroll or updateData
        // No direct window.scrollTo(0,0) here.
        if (this.contentElement) {
             this.contentElement.style.top = '0px'; // Reset visual position
        }
        // If there are items, a forced update might be good here
        if (this.totalItems > 0 && this.spacerElement && this.hostContainer) {
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

        // scrollTop is the amount of the hostContainer's content that has scrolled above the viewport's top edge.
        this.scrollTop = Math.max(0, -this.hostContainer.getBoundingClientRect().top);

        if (this.totalItems === 0) {
            this.visibleStartIndex = 0;
            this.visibleEndIndex = -1; 
            this.contentElement.style.top = '0px';
            if (forceRender || this.visibleEndIndex === -1) { // Render if forced or if it was previously empty
                this.doRender(this.visibleStartIndex, this.visibleEndIndex);
            }
            return;
        }

        const viewportHeight = window.innerHeight; 
        const visibleRowCount = Math.ceil(viewportHeight / this.rowHeight);

        const newStartIndex = Math.max(0, Math.floor(this.scrollTop / this.rowHeight) - this.bufferRows);
        const newEndIndex = Math.min(
            this.totalItems - 1,
            Math.max(0, newStartIndex + visibleRowCount + (2 * this.bufferRows) -1) // ensure at least buffer rows are rendered
        );

        const hasVisibilityChanged = newStartIndex !== this.visibleStartIndex || newEndIndex !== this.visibleEndIndex;
        const isSignificantChange = Math.abs(newStartIndex - this.visibleStartIndex) > this.bufferRows / 2;
        const isAtStart = newStartIndex === 0 && this.visibleStartIndex !== 0;
        const isAtEnd = newEndIndex === this.totalItems - 1 && this.visibleEndIndex !== this.totalItems - 1;

        if (forceRender || (hasVisibilityChanged && (isSignificantChange || isAtStart || isAtEnd))) {
            this.visibleStartIndex = newStartIndex;
            this.visibleEndIndex = newEndIndex;

            this.contentElement.style.top = `${this.visibleStartIndex * this.rowHeight}px`;
            this.doRender(this.visibleStartIndex, this.visibleEndIndex);
        }
    }

    private doRender(startIndex: number, endIndex: number): void {
        const then = performance.now();
        this.renderCallback(startIndex, endIndex);
        const tookRender = performance.now() - then;
        if (tookRender > 5) {
            console.warn(`VirtualScroll[${startIndex}-${endIndex}] render took ${tookRender}ms`);
        }
    }
} 