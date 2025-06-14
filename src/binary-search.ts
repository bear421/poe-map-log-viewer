export enum BinarySearchMode {
    EXACT = 'exact',
    FIRST = 'first',
    LAST = 'last'
}

export function binarySearchFindFirst<T>(array: T[], predicate: (element: T) => boolean, left = 0, right = array.length - 1): T | undefined {
    const index = binarySearchFindFirstIx(array, predicate, left, right);
    return index === -1 ? undefined : array[index];
}

export function binarySearchFindLast<T>(array: T[], predicate: (element: T) => boolean, left = 0, right = array.length - 1): T | undefined {
    const index = binarySearchFindLastIx(array, predicate, left, right);
    return index === -1 ? undefined : array[index];
}

export function binarySearchFindFirstIx<T>(array: T[], predicate: (element: T) => boolean, left = 0, right = array.length - 1): number {
    let res = -1;
    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        if (predicate(array[mid])) {
            // Found a match, store it and continue searching left
            res = mid;
            right = mid - 1;
        } else {
            // Continue searching right
            left = mid + 1;
        }
    }
    return res;
}

export function binarySearchFindLastIx<T>(array: T[], predicate: (element: T) => boolean, left = 0, right = array.length - 1): number {
    let res = -1;
    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        if (predicate(array[mid])) {
            // Found a match, store it and continue searching right
            res = mid;
            left = mid + 1;
        } else {
            // Continue searching left
            right = mid - 1;
        }
    }
    return res;
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
    if (initialRight >= array.length) {
        throw new Error(`initialRight must be less than the array length: ${initialRight} >= ${array.length}`);
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

interface NotFound {
    loIx: -1;
    hiIx: -1;
}

function notFound(): NotFound {
    return { loIx: -1, hiIx: -1 };
}

export function binarySearchRange<T>(
    array: T[],
    lo: number | undefined,
    hi: number | undefined,
    propertyExtractor: (element: T) => number,
    initialLeft: number = 0,
    initialRight: number = array.length - 1
): {loIx: number, hiIx: number} {
    const loIx = lo !== undefined ? binarySearch(array, lo, propertyExtractor, BinarySearchMode.FIRST, initialLeft, initialRight) : 0;
    if (loIx === -1) return notFound();

    const hiIx = hi !== undefined ? binarySearch(array, hi, propertyExtractor, BinarySearchMode.LAST, initialLeft, initialRight) : array.length - 1;
    if (hiIx === -1) return notFound();

    return { loIx, hiIx };
}
