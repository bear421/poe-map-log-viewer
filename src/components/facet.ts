
import { BitSet } from '../bitset';

export interface FacetOption<T> {
    value: T;
    name: string;
    icon?: string;
    color?: string;
}

export type CombinationOp = 'OR' | 'AND';

export interface Facet<T> {
    id: string;
    name: string;
    options: FacetOption<T>[];
    getBitsetIndex: () => Map<T, BitSet>;
    combinationLogic: CombinationOp;
    selectedOptions: Set<T>;
} 