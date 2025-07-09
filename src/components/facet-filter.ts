import { BitSet } from '../bitset';
import { BaseComponent } from './base-component';
import { createElementFromHTML } from '../util';
import { Facet } from './facet';

export class FacetFilterComponent extends BaseComponent {
    private facets: Facet<any>[];

    constructor(container: HTMLElement, facets: Facet<any>[], private readonly onFilterChanged: ((combinedBitSet: BitSet | undefined, filteredFacets: Facet<any>[]) => void)) {
        if (facets.length === 0) throw new Error('facets must be non-empty');

        super(createElementFromHTML('<div class="row g-2"></div>'), container);
        this.facets = facets;
    }

    protected async render(): Promise<void> {
        this.renderFilterUI();
        this.applyFilters();
    }

    private renderFilterUI(): void {
        this.element.innerHTML = '';
        
        for (const facet of this.facets) {
            const facetContainer = this.createFacetUI(facet);
            this.element.appendChild(facetContainer);
        }
    }

    private createFacetUI(facet: Facet<any>): HTMLElement {
        const facetContainer = createElementFromHTML(`
            <div class="facet-filter-container col fs-5" data-facet-id="${facet.id}">
                <div class="position-relative">
                    <button class="btn btn-outline-primary facet-filter-toggle d-flex justify-content-between w-100">
                        <span>${facet.name} <span class="selected-count"></span></span>
                        <i class="bi bi-chevron-down"></i>
                    </button>
                    <div class="overlay-filter-options shadow-sm mt-1"></div>
                </div>
            </div>
        `) as HTMLDivElement;
        
        const optionsContainer = facetContainer.querySelector('.overlay-filter-options') as HTMLDivElement;

        for (const option of facet.options) {
            const filterId = `${facet.id}-${option.value}`;
            const isChecked = facet.selectedOptions.has(option.value);
            const element = createElementFromHTML(`
                <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="${filterId}" value="${option.value}" ${isChecked ? 'checked' : ''}>
                    <label class="form-check-label" for="${filterId}">
                        <span class="facet-label-content">
                            ${option.icon ? `<i class="${option.icon} ${option.color ?? ''}"></i>` : ''}
                            ${option.name}
                        </span>
                        <span class="facet-count-container"><span class="facet-count">0</span></span>
                    </label>
                </div>
            `);
            optionsContainer.appendChild(element);
        }

        const toggleButton = facetContainer.querySelector('.facet-filter-toggle') as HTMLButtonElement;
        
        toggleButton.addEventListener('click', (e) => {
            e.stopPropagation();
            // TODO: close other popups
            optionsContainer.classList.toggle('active');
        });

        document.addEventListener('click', () => {
            optionsContainer.classList.remove('active');
        });

        optionsContainer.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        optionsContainer.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            if (target.type === 'checkbox') {
                const value = (typeof facet.options[0].value === 'number' ? parseInt(target.value) : target.value);
                if (target.checked) {
                    facet.selectedOptions.add(value);
                } else {
                    facet.selectedOptions.delete(value);
                }
                this.applyFilters();
            }
        });

        return facetContainer;
    }

    public applyFilters(): void {
        const facetBitSets = this.facets.map(f => this.getCombinedBitsetForFacet(f, f.selectedOptions));
        const combinedBitSet = BitSet.andAll(...facetBitSets);
        
        this.updateCounts(combinedBitSet);

        if (this.onFilterChanged) {
            this.onFilterChanged(combinedBitSet, this.facets);
        }
    }

    private getCombinedBitsetForFacet(facet: Facet<any>, selected: Set<any>): BitSet | undefined {
        if (selected.size === 0) return undefined;

        const bitsets = Array.from(selected).map(value => facet.getBitsetIndex().get(value)!);
        return facet.combinationLogic === 'AND' ? BitSet.andAll(...bitsets) : BitSet.orAll(...bitsets);
    }
    
    private updateCounts(baseBitSet: BitSet | undefined): void {
        const individualFacetBitsets = this.facets.map(f => this.getCombinedBitsetForFacet(f, f.selectedOptions));
        const prefixAnds = this.buildAccumulatingBitsets(individualFacetBitsets);
        const suffixAnds = this.buildAccumulatingBitsets(individualFacetBitsets.toReversed());
        const n = this.facets.length;
        for (let i = 0; i < n; i++) {
            const facet = this.facets[i];
            const prefix = i > 0 ? prefixAnds[i - 1] : undefined;
            const suffix = i < n - 1 ? suffixAnds[i + 1] : undefined;
            const otherFacetsCombinedBitSet = BitSet.andAll(prefix, suffix);

            for (const option of facet.options) {
                const isSelected = facet.selectedOptions.has(option.value);
                let countBitSet: BitSet | undefined;
                
                if (isSelected) {
                    countBitSet = baseBitSet;
                } else {
                    const tempSelected = new Set(facet.selectedOptions);
                    tempSelected.add(option.value);
                    const thisFacetBitSet = this.getCombinedBitsetForFacet(facet, tempSelected);
                    countBitSet = BitSet.andAll(thisFacetBitSet, otherFacetsCombinedBitSet);
                }

                const count = countBitSet ? countBitSet.cardinality() : 0;
                const facetContainer = this.element.querySelector(`[data-facet-id="${facet.id}"]`);
                const countSpan = facetContainer?.querySelector(`label[for="${facet.id}-${option.value}"] .facet-count`);
                if (countSpan) {
                    countSpan.textContent = count.toString();
                    countSpan.classList.remove('text-muted');
                    if (count === 0 && !isSelected) {
                        countSpan.classList.add('text-muted');
                    }
                }
            }

            const selectedCountSpan = this.element.querySelector(`[data-facet-id="${facet.id}"] .selected-count`);
            if (selectedCountSpan) {
                selectedCountSpan.textContent = facet.selectedOptions.size > 0 ? `(${facet.selectedOptions.size})` : "";
            }
        }
    }

    /**
     * builds an array of bitsets, where the i-th element is the AND of all bitsets up to index i
     */
    private buildAccumulatingBitsets(bitsets: (BitSet | undefined)[]): (BitSet | undefined)[] {
        const n = bitsets.length;
        const res: (BitSet | undefined)[] = new Array(n);
        res[0] = bitsets[0];
        for (let i = 1; i < n; i++) {
            res[i] = BitSet.andAll(res[i - 1], bitsets[i]);
        }
        return res;
    }
} 