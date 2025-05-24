import { App } from "../app";

export abstract class BaseComponent<
    TData,
    TElement extends HTMLElement = HTMLElement,
    TContainerElement extends HTMLElement = HTMLElement
> {
    protected readonly element: TElement;
    protected readonly containerElement: TContainerElement;
    protected data: TData | null = null;
    protected isInitialized: boolean = false;
    protected isDataChanged: boolean = false;
    protected isVisible: boolean = false;
    protected app?: App; // hacky "global" state sharing for now

    constructor(element: TElement, container: TContainerElement) {
        this.element = element;
        this.containerElement = container;
        this.containerElement.appendChild(this.element);
    }

    public updateData(newData: TData): void {
        this.data = newData;
        this.isDataChanged = true;
        if (this.isVisible) {
            if (!this.isInitialized) {
                this.init();
                this.isInitialized = true;
            }
            const then = performance.now();
            this.render();
            const took = performance.now() - then;
            if (took > 20) {
                console.warn(this.constructor.name + ".render took " + (took) + " ms");
            }
            this.isDataChanged = false;
        }
    }

    public setVisible(visible: boolean): void {
        if (this.notifyVisibility(visible)) {
            visible ? this.element.classList.remove('d-none') : this.element.classList.add('d-none');
        }
    }
    
    public setApp(app: App): void {
        this.app = app;
    }

    public notifyVisibility(isVisible: boolean): boolean {
        const visibilityChanged = this.isVisible !== isVisible;
        this.isVisible = isVisible;
        if (visibilityChanged && this.isVisible && this.isDataChanged) {
            this.render();
            this.isDataChanged = false;
        }
        return visibilityChanged;
    }

    protected init() {}

    protected abstract render(): void;
} 