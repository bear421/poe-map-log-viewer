import { App } from "../app";
import { LogAggregation } from "../aggregation";
import { Measurement } from "../util";

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

    public updateData(newData: TData): Promise<void> | void {
        this.data = newData;
        this.isDataChanged = true;
        return this.tryRender();
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

    private async tryRender(): Promise<void> {
        if (!this.isVisible || !this.isDataChanged) return;

        if (!this.isInitialized) {
            this.init();
            this.isInitialized = true;
        }
        const m = new Measurement();
        const promise = this.render();
        await promise;
        m.logTook(this.constructor.name + ".render " + (promise instanceof Promise ? "(async)" : ""));
        this.isDataChanged = false;
    }

    protected init() {}

    protected abstract render(): Promise<void> | void;
} 