import { binarySearchFindLast } from "../binary-search";

export enum Feature {
    ZoneGeneration
}

// months are 0-indexed; 0 = January
export const VERSIONS: LogVersion[] = [{
    ts: Date.UTC(2022, 1, 8),
    logSupport: {
        [Feature.ZoneGeneration]: true
    },
    patchURL: "https://www.pathofexile.com/forum/view-thread/3232434" // might be a different patch
}];

export interface LogVersion {
    logSupport: {
        [key in Feature]?: boolean;
    }
    ts: number;
    patchURL?: string;
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