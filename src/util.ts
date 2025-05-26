export function createElementFromHTML(html: string): HTMLElement {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    return template.content.firstElementChild as HTMLElement;
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
            <div class="tooltip journey-event-tooltip bs-tooltip-auto fade hide" role="tooltip">
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