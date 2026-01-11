
import { BitSet } from '../bitset';

export interface FacetOption<T> {
    value: T;
    name: string;
    icon?: string;
    color?: string;
}

export namespace FacetOption {
    export const ANY_VALUE = "__any__";
}

export type CombinationOp = 'OR' | 'AND' | 'NOT';

export class Facet<T> {
    constructor(
        public readonly id: string,
        public readonly name: string,
        public readonly options: FacetOption<T>[],
        public readonly bitsetIndex: Map<T, BitSet>,
        public readonly operators: CombinationOp[] = ['OR', 'AND', 'NOT'],
        public operator: CombinationOp = operators[0],
        public countStyle: 'abs' | 'delta' = 'abs', 
        public selectedOptions: Set<T> = new Set(),
        public filter: string = '',
    ) {}

    public filterEmptyOptions(): Facet<T> {
        const options = this.options.filter(option => this.bitsetIndex.get(option.value)?.cardinality() ?? 0 > 0);
        return new Facet(this.id, this.name, options, this.bitsetIndex, this.operators, this.operator, this.countStyle, this.selectedOptions, this.filter);
    }
}