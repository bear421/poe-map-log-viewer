import { BitSet } from '../bitset';
import { BaseComponent } from './base-component';
import { createElementFromHTML } from '../util';
import { Facet } from './facet';

export class FacetFilterComponent extends BaseComponent {
    private facets: Facet<any>[];
    private prevSelectedOptions: Map<Facet<any>, Set<any>> | undefined = undefined;

    constructor(container: HTMLElement, facets: Facet<any>[], private readonly onFilterChanged: ((combinedBitSet: BitSet | undefined, filteredFacets: Facet<any>[]) => Promise<void>)) {
        if (facets.length === 0) throw new Error('facets must be non-empty');

        super(container, container);
        this.facets = facets;
    }

    public async reset(): Promise<void> {
        for (const facet of this.facets) {
            facet.selectedOptions.clear();
        }
        this.element.querySelectorAll('input.form-check-input').forEach(e => (e as HTMLInputElement).checked = false);
        this.element.querySelectorAll('.overlay-filter-options.active').forEach(e => e.classList.remove('active'));
        await this.applyFilters(true);
    }

    protected async init(): Promise<void> {
        this.renderFilterUI();
        await this.render();
    }

    protected async render(): Promise<void> {
        await this.applyFilters();
    }

    private renderFilterUI(): void {
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
            const countSpanId = `${filterId}-c`;
            const isChecked = facet.selectedOptions.has(option.value);
            const element = createElementFromHTML(`
                <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="${filterId}" value="${option.value}" ${isChecked ? 'checked' : ''}>
                    <label class="form-check-label" for="${filterId}">
                        <span class="facet-label-content">
                            ${option.icon ? `<i class="${option.icon} ${option.color ?? ''}"></i>` : ''}
                            ${option.name}
                        </span>
                        <span class="facet-count-container"><span class="facet-count" id="${countSpanId}">0</span></span>
                    </label>
                </div>
            `);
            optionsContainer.appendChild(element);
        }

        const toggleButton = facetContainer.querySelector('.facet-filter-toggle') as HTMLButtonElement;
        
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

    public async applyFilters(force: boolean = false): Promise<void> {
        const prevSelectedOptions = this.prevSelectedOptions;
        let changed = force;
        if (prevSelectedOptions === undefined) {
            changed = true;
        } else {
            for (const facet of this.facets) {
                const selection = facet.selectedOptions;
                const prevSelection = prevSelectedOptions.get(facet)!;
                if (selection.size !== prevSelection.size) {
                    changed = true;
                    break;
                }
                // unnecessary with current implementation, kept for future correctness
                for (const value of selection) {
                    if (!prevSelection.has(value)) {
                        changed = true;
                        break;
                    }
                }
            }
        }
        const selectedFacetBitSets: (BitSet | undefined)[] = this.facets.map(f => this.getCombinedBitsetForFacet(f, f.selectedOptions));
        // could technically store and simply narrow the prior bitset(s) IF the selected facet is a narrowing operation (additive OR / subtractive AND)
        // however, performance is good enough for now and this is simpler
        const combinedBitSet = BitSet.andAll(...selectedFacetBitSets);
        this.updateCounts(combinedBitSet, selectedFacetBitSets);
        if (changed) {
            this.prevSelectedOptions = new Map(this.facets.map(f => [f, new Set(f.selectedOptions)]));
            // not ideal because this attributes the perf took of the callback to this render
            await this.onFilterChanged(combinedBitSet, this.facets);
        }
    }
    
    private updateCounts(selection: BitSet | undefined, selectedFacetBitSets: (BitSet | undefined)[]): void {
        // selection = BitSet.andAll(selection, this.data!.mapsBitSet);
        const prefixAnds = this.buildAccumulatingBitsets(selectedFacetBitSets);
        const suffixAnds = this.buildAccumulatingBitsets(selectedFacetBitSets.toReversed());
        const n = this.facets.length;
        for (let i = 0; i < n; i++) {
            const facet = this.facets[i];
            const prefix = i > 0 ? prefixAnds[i - 1] : undefined;
            const suffix = i < n - 1 ? suffixAnds[n - i - 2] : undefined;
            const otherFacetsCombinedBitSet = BitSet.andAll(prefix, suffix);
            const selectedFacetBitSet = selectedFacetBitSets[i];
            for (const option of facet.options) {
                const isSelected = facet.selectedOptions.has(option.value);
                let countBitSet: BitSet | undefined;
                
                if (isSelected) {
                    countBitSet = selection;
                } else {
                    const optionBitSet = facet.getBitsetIndex().get(option.value)!;
                    const onSelectBitSet = (facet.operator === 'AND' ? BitSet.andAll : BitSet.orAll)(selectedFacetBitSet, optionBitSet);
                    countBitSet = BitSet.andAll(onSelectBitSet, otherFacetsCombinedBitSet);
                }

                // console.log("trying to reduce countBitSet", countBitSet, this.data!.mapsBitSet, countBitSet?.cardinality(), '=>', BitSet.andAll(countBitSet, this.data!.mapsBitSet)?.cardinality());
                const count = BitSet.andAll(countBitSet, this.data!.mapsBitSet)?.cardinality() ?? 0;
                // using querySelector here is ~10x slower than getElementById, causing significant slowdown for facets with many options
                const countSpan = document.getElementById(`${facet.id}-${option.value}-c`);
                if (countSpan) {
                    countSpan.textContent = count.toString();
                    if (count === 0 && !isSelected) {
                        countSpan.classList.add('text-muted');
                    } else {
                        countSpan.classList.remove('text-muted');
                    }
                }
            }

            const selectedCountSpan = this.element.querySelector(`[data-facet-id="${facet.id}"] .selected-count`);
            if (selectedCountSpan) {
                selectedCountSpan.textContent = facet.selectedOptions.size > 0 ? `(${facet.selectedOptions.size})` : "";
            }
        }
    }

    private getCombinedBitsetForFacet(facet: Facet<any>, selected: Set<any>): BitSet | undefined {
        if (selected.size === 0) return undefined;

        const bitsets = Array.from(selected).map(value => facet.getBitsetIndex().get(value)!);
        return (facet.operator === 'AND' ? BitSet.andAll : BitSet.orAll)(...bitsets);
    }

    /**
     * builds an array of bitsets, where the i-th element is the AND of all bitsets up to index i.
     * 
     * e.g. [a, b, c] -> [
     *   a, 
     *   a AND b, 
     *   a AND b AND c
     * ]
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