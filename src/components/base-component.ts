import { App } from "../app";
import { LogAggregationCube } from "../aggregate/aggregation";
import { Measurement } from "../util";

export abstract class BaseComponent<
    TElement extends HTMLElement = HTMLElement,
    TData = LogAggregationCube,
    TContainerElement extends HTMLElement = HTMLElement
> {
    protected readonly element: TElement;
    protected readonly containerElement: TContainerElement;
    protected readonly children: BaseComponent<any, TData, any>[] = [];
    protected parentComponent?: BaseComponent<any, TData, any>;
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

    public async setParentComponent(parentComponent: BaseComponent<any, TData, any>): Promise<void> {
        if (this.parentComponent) throw new Error("component already has a parent: " + parentComponent.constructor.name);

        this.parentComponent = parentComponent;
        await parentComponent.addChildComponent(this);
    }

    protected async addChildComponent(component: BaseComponent<any, TData, any>): Promise<void> {
        this.children.push(component);
        if (this.data) {
            await component.updateData(this.data);
        }
        await component.setVisible(this.isVisible);
    }

    public async updateData(newData: TData): Promise<void> {
        this.data = newData;
        this.isDataChanged = true;
        for (const child of this.children) {
            await child.updateData(newData);
        }
        await this.tryRender();
    }

    public async setVisible(visible: boolean): Promise<void> {
        const visibilityChanged = this.isVisible !== visible;
        this.isVisible = visible;
        if (visibilityChanged) {
            await this.tryRender();
            visible ? this.element.classList.remove('d-none') : this.element.classList.add('d-none');
        }
    }
    
    public setApp(app: App): void {
        this.app = app;
    }

    private async tryRender(): Promise<void> {
        if (!this.isVisible || !this.isDataChanged) return;

        if (!this.isInitialized) {
            const promise = this.init();
            promise && await promise;
            this.isInitialized = true;
        }
        const m = new Measurement();
        const promise = this.render();
        promise && await promise;
        m.logTook(this.constructor.name + ".render " + (promise instanceof Promise ? "(async)" : ""));
        this.isDataChanged = false;
    }

    protected init(): Promise<void> | void {
        return;
    }

    protected abstract render(): Promise<void> | void;
} 