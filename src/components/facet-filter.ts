import { BitSet } from '../bitset';
import { BaseComponent } from './base-component';
import { createElementFromHTML, FrameBarrier, memoize } from '../util';
import { Facet, FacetOption } from './facet';

export class FacetFilterComponent extends BaseComponent {
    private facets: Facet<any>[];
    private prevSelectedOptions: Map<Facet<any>, Set<any>> | undefined = undefined;
    private visibleFacets: Set<Facet<any>> = new Set();
    private currentCounts: Map<Facet<any>, () => Promise<void>> | undefined = undefined;

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
        this.element.querySelectorAll('.overlay-filter-options-list.active').forEach(e => e.classList.remove('active'));
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
                    <button class="btn btn-outline-dark facet-filter-toggle d-flex justify-content-between w-100">
                        <span>${facet.name} <span class="selected-count"></span></span>
                        <i class="bi bi-chevron-down"></i>
                    </button>
                    <div class="overlay-filter-options shadow-sm mt-1">
                        <div class="overlay-filter-options-header row mb-2">
                            <div class="col">
                                <input type="text" placeholder="filter ..." class="form-control form-control-sm facet-filter-search">
                            </div>
                            <div class="col-auto btn-group btn-group-sm">
                                ${
                                    facet.operators.map(op => `
                                        <input type="radio" class="btn-check facet-operator" name="${facet.id}-facet-operator" id="${facet.id}-operator-${op}" autocomplete="off" value="${op}">
                                        <label class="btn btn-sm btn-outline-dark facet-operator" for="${facet.id}-operator-${op}">${op}</label>
                                    `).join('\n')
                                }
                            </div>
                        </div>
                        <div class="facet-filter-options-list"></div>
                    </div>
                </div>
            </div>
        `) as HTMLDivElement;
        
        const initialOperator = facetContainer.querySelector(`.facet-operator[value="${facet.operator}"]`) as HTMLInputElement;
        if (initialOperator instanceof HTMLInputElement) {
            initialOperator.checked = true;
        } else {
            throw new Error(`Initial operator ${facet.operator} not found in facet ${facet.id}, operators: ${facet.operators.join(', ')}`);
        }
        
        facetContainer.querySelectorAll('.facet-operator').forEach(e => {
            e.addEventListener('change', (e) => {
                const target = e.target as HTMLInputElement;
                if (!target.checked) return;

                facet.operator = target.value as 'AND' | 'OR' | 'NOT';
                this.applyFilters(true);
            });
        });

        const optionsContainer = facetContainer.querySelector('.overlay-filter-options') as HTMLDivElement;
        const toggleButton = facetContainer.querySelector('.facet-filter-toggle') as HTMLButtonElement;
        toggleButton.addEventListener('click', (e) => {
            e.stopPropagation();
            const isActive = optionsContainer.classList.toggle('active');
            if (isActive) {
                this.visibleFacets.add(facet);
            } else {
                this.visibleFacets.delete(facet);
            }
            this.updateVisibleCounts();
        });
        document.addEventListener('click', () => {
            optionsContainer.classList.remove('active');
        });
        optionsContainer.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        const optionsListContainer = facetContainer.querySelector('.facet-filter-options-list') as HTMLDivElement;

        const anyOption = this.createOptionElement({
            value: FacetOption.ANY_VALUE,
            name: 'All',
            icon: 'bi bi-asterisk',
            color: 'text-dark',
        }, facet);
        const anyOptionInput = anyOption.querySelector('input') as HTMLInputElement;
        optionsListContainer.appendChild(anyOption);
        for (const option of facet.options) {
            optionsListContainer.appendChild(this.createOptionElement(option, facet));
        }
        if (facet.selectedOptions.size > 0) {
            // TODO
        } else {
            anyOptionInput.checked = true;
            anyOptionInput.disabled = true;
        }
        
        const optionRows = optionsListContainer.querySelectorAll('.form-check');
        const searchInput = facetContainer.querySelector('.facet-filter-search') as HTMLInputElement;
        searchInput.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement;
            const regex = new RegExp(target.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            facet.filter = target.value;
            for (const optionRow of optionRows) {
                const option = optionRow.querySelector('.form-check-label') as HTMLLabelElement;
                if (regex.test(option.textContent ?? '')) {
                    optionRow.classList.remove('d-none');
                } else {
                    optionRow.classList.add('d-none');
                }
            }
        });

        optionsContainer.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            if (target.type === 'checkbox') {
                if (target.value === FacetOption.ANY_VALUE) {
                    if (target.checked) {
                        optionsListContainer.querySelectorAll('.form-check-input').forEach(e => {
                            if (e !== target) {
                                (e as HTMLInputElement).checked = false;
                            }
                        });
                        facet.selectedOptions.clear();
                        anyOptionInput.disabled = true;
                    }
                } else {
                    const value = (typeof facet.options[0].value === 'number' ? parseInt(target.value) : target.value);
                    if (target.checked) {
                        facet.selectedOptions.add(value);
                        anyOptionInput.checked = false;
                        anyOptionInput.disabled = false;
                    } else {
                        facet.selectedOptions.delete(value);
                        if (facet.selectedOptions.size === 0) {
                            anyOptionInput.checked = true;
                            anyOptionInput.disabled = true;
                        }
                    }
                }
                this.applyFilters();
            }
        });

        return facetContainer;
    }

    private createOptionElement<T>(option: FacetOption<T>, facet: Facet<T>): HTMLElement {
        const filterId = `${facet.id}-${option.value}`;
        const countSpanId = `${filterId}-c`;
        const isChecked = facet.selectedOptions.has(option.value);
        return createElementFromHTML(`
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
        const selection = BitSet.andAll(...selectedFacetBitSets);
        this.currentCounts = this.updateCountsLazy(selection, selectedFacetBitSets);
        this.updateVisibleCounts();
        if (changed) {
            this.prevSelectedOptions = new Map(this.facets.map(f => [f, new Set(f.selectedOptions)]));
            // not ideal because this attributes the perf took of the callback to this render
            await this.onFilterChanged(selection, this.facets);
        }
    }

    private updateCountsLazy(selection: BitSet | undefined, selectedFacetBitSets: (BitSet | undefined)[]): Map<Facet<any>, () => Promise<void>> {
        const fb = new FrameBarrier(128);
        const getCommonContext = memoize(() => {
            const prefixAnds = this.buildAccumulatingBitsets(selectedFacetBitSets);
            const suffixAnds = this.buildAccumulatingBitsets(selectedFacetBitSets.toReversed());
            return {
                prefixAnds,
                suffixAnds,
                currentTotal: BitSet.andAll(selection, this.data!.simpleFilterMapsBitSet)?.cardinality() ?? 0,
            };
        });
        const res = new Map<Facet<any>, () => Promise<void>>();
        const n = this.facets.length;
        for (let i = 0; i < n; i++) {
            const fn = async () => {
                const context = getCommonContext();
                const facet = this.facets[i];
                const prefix = i > 0 ? context.prefixAnds[i - 1] : undefined;
                const suffix = i < n - 1 ? context.suffixAnds[n - i - 2] : undefined;
                const otherFacetsCombinedBitSet = BitSet.andAll(prefix, suffix);
                const selectedFacetBitSet = selection;
                {
                    const anyOptionCountSpan = document.getElementById(`${facet.id}-${FacetOption.ANY_VALUE}-c`) as HTMLElement | undefined;
                    if (anyOptionCountSpan) {
                        const count = BitSet.andAll(otherFacetsCombinedBitSet, this.data!.simpleFilterMapsBitSet)?.cardinality() ?? 0;
                        anyOptionCountSpan.textContent = count.toString();
                    }
                }
                for (const option of facet.options) {
                    if (fb.shouldYield()) await fb.yield();

                    const isSelected = facet.selectedOptions.has(option.value);
                    let countBitSet: BitSet | undefined;
                    
                    if (isSelected) {
                        countBitSet = selection;
                    } else {
                        const optionBitSet = facet.getBitsetIndex().get(option.value)!;
                        let onSelectBitSet: BitSet | undefined;
                        switch (facet.operator) {
                            case 'AND':
                                onSelectBitSet = BitSet.andAll(selectedFacetBitSet, optionBitSet);
                                break;
                            case 'OR':
                                // if there is no other option selected, we must AND, otherwise the OR has no effect (incorrect count)
                                onSelectBitSet = (facet.selectedOptions.size > 0 ? BitSet.orAll : BitSet.andAll)(selectedFacetBitSet, optionBitSet);
                                break;
                            case 'NOT':
                                onSelectBitSet = BitSet.andAll(selectedFacetBitSet, optionBitSet?.not());
                                break;
                        }
                        countBitSet = BitSet.andAll(onSelectBitSet, otherFacetsCombinedBitSet);
                    }

                    const onSelectTotal = BitSet.andAll(countBitSet, this.data!.simpleFilterMapsBitSet)?.cardinality() ?? 0;
                    let count: number;
                    if (facet.countStyle === 'abs') {
                        count = onSelectTotal;
                    } else if (facet.countStyle === 'delta') {
                        count = onSelectTotal - context.currentTotal;
                    } else {
                        throw new Error(`unsupported count style: ${facet.countStyle}`);
                    }
                    // using querySelector with label[for=...] here is ~10x slower than getElementById, causing significant slowdown for facets with many options
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
            };
            res.set(this.facets[i], memoize(fn));
        }
        return res;
    }
    
    private updateVisibleCounts(): void {
        for (const facet of this.visibleFacets) {
            this.currentCounts?.get(facet)?.();
        }
    }

    private getCombinedBitsetForFacet(facet: Facet<any>, selected: Set<any>): BitSet | undefined {
        if (selected.size === 0) return undefined;

        const bitsets = Array.from(selected).map(value => facet.getBitsetIndex().get(value)!);
        switch (facet.operator) {
            case 'AND':
                return BitSet.andAll(...bitsets);
            case 'OR':
                return BitSet.orAll(...bitsets);
            case 'NOT':
                return BitSet.notAll(...bitsets);
        }
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