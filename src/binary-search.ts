export enum BinarySearchMode {
    EXACT = 'exact',
    FIRST = 'first',
    LAST = 'last'
}

export function binarySearch<T>(
    array: T[],
    target: number,
    propertyExtractor: (element: T) => number,
    mode: BinarySearchMode = BinarySearchMode.EXACT,
    initialLeft: number = 0,
    initialRight: number = array.length - 1
): number {
    if (array.length === 0) return -1;
    
    if (initialLeft > initialRight) {
        throw new Error(`initialLeft must be less than or equal to initialRight: ${initialLeft} > ${initialRight}`);
    }
    if (initialLeft < 0) {
        throw new Error(`initialLeft must be greater than or equal to 0: ${initialLeft}`);
    }
    if (initialRight < 0) {
        throw new Error(`initialRight must be greater than or equal to 0: ${initialRight}`);
    }
    let low = initialLeft;
    let high = initialRight;
    let res = -1;
    
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const midValue = propertyExtractor(array[mid]);
        const cmp = midValue < target ? -1 : (midValue > target ? 1 : 0);
        switch (mode) {
            case BinarySearchMode.EXACT:
                if (cmp === 0) {
                    return mid;
                } else if (cmp < 0) {
                    low = mid + 1;
                } else {
                    high = mid - 1;
                }
                break;
            case BinarySearchMode.FIRST:
                // Find first element where comparator >= 0
                if (cmp >= 0) {  
                    res = mid;
                    high = mid - 1; // Continue searching left
                } else {
                    low = mid + 1;
                }
                break;
            case BinarySearchMode.LAST:
                // Find last element where comparator <= 0
                if (cmp <= 0) {
                    res = mid;
                    low = mid + 1; // Continue searching right
                } else {
                    high = mid - 1;
                }
                break;
        }
    }
    return res;
}