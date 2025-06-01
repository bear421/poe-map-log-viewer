import { binarySearchFindLast } from "../binary-search";

export enum Feature {
    ZoneGeneration
}

// months are 0-indexed; 0 = January
export const VERSIONS: LogVersion[] = [{
    ts: Date.UTC(2022, 1, 1), // TODO not entirely accurate
    logSupport: {
        [Feature.ZoneGeneration]: true
    }
}];

export interface LogVersion {
    logSupport: {
        [Feature.ZoneGeneration]: boolean;
    }
    ts: number;
}

/**
 * @returns true if the feature is supported at the given timestamp or the specified ts succeeds the latest version
 */
export function isFeatureSupportedAt(feature: Feature, ts: number): boolean {
    return getLogVersionAt(ts)?.logSupport[feature] ?? false;
}

export function getLogVersionAt(ts: number): LogVersion | undefined {
    return binarySearchFindLast(VERSIONS, v => ts >= v.ts);
}