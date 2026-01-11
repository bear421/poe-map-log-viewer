import { BaseComponent } from './base-component';
import { createElementFromHTML } from '../util';

export interface MultiSelectOption<T> {
    value: T;
    name: string;
    icon?: string;
}

export class MultiSelectComponent<T> extends BaseComponent {
    public selectedOptions: Set<T>;
    
    private options: MultiSelectOption<T>[];
    private onSelectionChanged: (selected: Set<T>) => void;
    private allOptionId: string;
    private idPrefix: string;

    constructor(
        container: HTMLElement,
        name: string,
        options: MultiSelectOption<T>[],
        initialSelection: T[],
        onSelectionChanged: (selected: Set<T>) => void
    ) {
        const element = createElementFromHTML(`
            <div class="multi-select-container fs-5"">
                <div class="position-relative">
                    <button class="btn btn-outline-dark toggle d-flex justify-content-between w-100">
                        <span>${name} <span class="selected-count"></span></span>
                        <i class="bi bi-chevron-down"></i>
                    </button>
                    <div class="overlay-options shadow-sm mt-1">
                        <div class="options-list"></div>
                    </div>
                </div>
            </div>
        `);
        super(element, container);

        this.options = options;
        this.selectedOptions = new Set(initialSelection);
        this.onSelectionChanged = onSelectionChanged;
        this.idPrefix = `ms-${this.id}`;
        this.allOptionId = `${this.idPrefix}-all`;
        this.populate();
    }

    render(): void {}

    private populate(): void {
        const optionsContainer = this.element.querySelector('.overlay-options') as HTMLDivElement;
        const toggleButton = this.element.querySelector('.toggle') as HTMLButtonElement;
        toggleButton.addEventListener('click', (e) => {
            e.stopPropagation();
            optionsContainer.classList.toggle('active');
        });
        document.addEventListener('click', () => {
            optionsContainer.classList.remove('active');
        });
        optionsContainer.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        const optionsListContainer = this.element.querySelector('.options-list') as HTMLDivElement;
        optionsListContainer.innerHTML = '';

        const allOption = this.createOptionElement({
            value: '__any__' as any,
            name: 'All',
            icon: 'bi bi-asterisk'
        }, this.allOptionId);
        optionsListContainer.appendChild(allOption);

        for (const option of this.options) {
            optionsListContainer.appendChild(this.createOptionElement(option));
        }
        
        this.updateSelectedCount();
        this.updateAllCheckboxState();

        optionsListContainer.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            if (target.type !== 'checkbox') return;
            
            if (target.id === this.allOptionId) {
                if (target.checked) {
                    this.options.forEach(o => this.selectedOptions.add(o.value));
                } else {
                    this.selectedOptions.clear();
                }
            } else {
                const option = this.options.find(o => `${this.idPrefix}-${o.value}` === target.id);
                if(option) {
                    if (target.checked) {
                        this.selectedOptions.add(option.value);
                    } else {
                        this.selectedOptions.delete(option.value);
                    }
                }
            }
            
            this.updateAllCheckboxState();
            this.updateSelectedCount();
            this.onSelectionChanged(this.selectedOptions);
        });
    }

    private updateAllCheckboxState() {
        const container = this.element.querySelector('.options-list') as HTMLElement;
        if(!container) return;

        const allOptionInput = container.querySelector(`#${this.allOptionId}`) as HTMLInputElement;
        if (!allOptionInput) return;
        
        const allChecked = this.selectedOptions.size === this.options.length;
        const someChecked = this.selectedOptions.size > 0 && !allChecked;

        allOptionInput.checked = allChecked;
        allOptionInput.indeterminate = someChecked;

        container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            if ((cb as HTMLInputElement).id === this.allOptionId) return;

            const option = this.options.find(o => `${this.idPrefix}-${o.value}` === (cb as HTMLInputElement).id);
            if (option) {
                (cb as HTMLInputElement).checked = this.selectedOptions.has(option.value);
            }
        });
    }

    private updateSelectedCount() {
        const selectedCountSpan = this.element.querySelector('.selected-count');
        if (selectedCountSpan) {
            const count = this.selectedOptions.size;
            if (count > 0 && count < this.options.length) {
                selectedCountSpan.textContent = `(${count})`;
            } else if (this.selectedOptions.size === this.options.length) {
                selectedCountSpan.textContent = ``;
            } else {
                selectedCountSpan.textContent = "";
            }
        }
    }

    private createOptionElement(option: MultiSelectOption<T>, id?: string): HTMLElement {
        const optionId = id ?? `${this.idPrefix}-${option.value}`;
        const isChecked = id === this.allOptionId ? this.selectedOptions.size === this.options.length : this.selectedOptions.has(option.value);
        
        return createElementFromHTML(`
            <div class="form-check">
                <input class="form-check-input" type="checkbox" id="${optionId}" value="${String(option.value)}" ${isChecked ? 'checked' : ''}>
                <label class="form-check-label" for="${optionId}">
                    <span class="label-content">
                        ${option.icon ? `<i class="bi ${option.icon}"></i>` : ''}
                        ${option.name}
                    </span>
                </label>
            </div>
        `);
    }
} 