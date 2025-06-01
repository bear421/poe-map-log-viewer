import { App } from "../app";
import { LogAggregation } from "../aggregation";

export abstract class BaseComponent<
    TElement extends HTMLElement = HTMLElement,
    TData = LogAggregation,
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
        this.tryRender();
    }

    public setVisible(visible: boolean): this {
        const visibilityChanged = this.isVisible !== visible;
        this.isVisible = visible;
        if (visibilityChanged) {
            this.tryRender();
            visible ? this.element.classList.remove('d-none') : this.element.classList.add('d-none');
        }
        return this;
    }
    
    public setApp(app: App): void {
        this.app = app;
    }

    private tryRender(): void {
        if (!this.isVisible || !this.isDataChanged) return;

        if (!this.isInitialized) {
            this.init();
            this.isInitialized = true;
        }
        const then = performance.now();
        this.render();
        const took = performance.now() - then;
        if (took > 20) {
            console.warn(this.constructor.name + ".render took " + (Math.ceil(took * 100) / 100) + " ms");
        }
        this.isDataChanged = false;
    }

    protected init() {}

    protected abstract render(): void;
} 