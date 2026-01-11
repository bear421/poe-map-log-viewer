import { TSRange } from '../aggregate/segmentation';
import { parseTsStrict } from './ts-parser';

export interface ByteRange {
    lo: number;
    hi: number;
}

export interface SearchOptions {
    chunkSize?: number;
    precisionBytes?: number;
}

interface ChunkInspection {
    pos: number;
    ts: number | null;
    preciseMatch: boolean;
}

interface TimestampSearchResult {
    ts: number | null;
    byteOffset: number;
    precisionErrorBytes: number;
}

const DEFAULT_CHUNK_SIZE = 1024 * 1024;
const DEFAULT_PRECISION = 1024 * 1024;

async function findByteOffsetForTimestamp(
    file: File,
    targetTimestamp?: number,
    mode: 'start' | 'end' = 'start',
    options: SearchOptions = {}
): Promise<TimestampSearchResult> {
    // there are some micro-optimizations possible, but likely overkill (exposing str pos to caller, using the ArrayBuffer directly instead of decoding, etc.)
    // the returned offset intentionally uses the start of the chunk instead of doing hacky offset + encode(pos).bytes math
    const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    const precision = options.precisionBytes ?? DEFAULT_PRECISION;

    if (targetTimestamp === undefined || !Number.isFinite(targetTimestamp)) {
        return {
            byteOffset: mode === 'start' ? 0 : file.size,
            ts: null,
            precisionErrorBytes: 0
        };
    }

    let left = 0;
    let right = file.size;
    let prevResult: TimestampSearchResult | null = null;
    const decoder = new TextDecoder('utf-8');
    while (right - left > precision) {
        const mid = Math.floor((left + right) / 2);
        const readSize = Math.min(chunkSize, file.size - mid);
        const slice = file.slice(mid, mid + readSize);
        const buffer = await slice.arrayBuffer();
        const inspection = await inspectChunk(decoder.decode(buffer), targetTimestamp, mode);
        if (inspection.ts === null) {
            if (mode === 'start') {
                right = mid;
            } else {
                left = mid;
            }
            continue;
        }
        if (inspection.preciseMatch) return { ts: inspection.ts, byteOffset: mid, precisionErrorBytes: 0 };

        if (mode === 'start') {
            if (prevResult && prevResult.ts! < targetTimestamp && prevResult.ts! > inspection.ts) {
                const precisionErrorBytes = mid - prevResult.byteOffset;
                if (precisionErrorBytes < precision) {
                    return {
                        byteOffset: prevResult.byteOffset,
                        ts: prevResult.ts,
                        precisionErrorBytes
                    };
                }
            }
            if (inspection.ts !== null && inspection.ts > targetTimestamp) {
                right = mid;
            } else {
                left = mid;
            }
        } else {
            if (prevResult && prevResult.ts! > targetTimestamp && prevResult.ts! < inspection.ts) {
                const precisionErrorBytes = mid - prevResult.byteOffset;
                if (precisionErrorBytes < precision) {
                    return {
                        byteOffset: prevResult.byteOffset,
                        ts: prevResult.ts,
                        precisionErrorBytes
                    };
                }
            }
            if (inspection.ts !== null && inspection.ts > targetTimestamp) {
                right = mid;
            } else {
                left = mid;
            }
        }
        prevResult = {
            byteOffset: mid,
            ts: inspection.ts,
            precisionErrorBytes: -1
        };
    }
    if (prevResult) {
        return {
            byteOffset: prevResult.byteOffset,
            ts: prevResult.ts,
            precisionErrorBytes: right - left
        };
    }
    return {
        byteOffset: mode === 'start' ? 0 : file.size,
        ts: null,
        precisionErrorBytes: right - left
    };
}

async function inspectChunk(
    chunk: string,
    targetTimestamp: number,
    mode: 'start' | 'end'
): Promise<ChunkInspection> {
    // skip possibly incomplete head (anything following the start of line timestamp may violate contiguity, e.g. user message) - find first complete line
    const firstNewline = chunk.indexOf('\n');
    let pos = firstNewline !== -1 ? firstNewline + 1 : 0;
    let prevTs: number | null = null;
    let prevPos = -1;
    while (pos < chunk.length) {
        const lineEnd = chunk.indexOf('\n', pos);
        const lineEndPos = lineEnd === -1 ? chunk.length : lineEnd;
        
        if (lineEndPos > pos) {
            const line = chunk.substring(pos, lineEndPos);
            const ts = parseTsStrict(line);
            if (ts === null) {
                pos = lineEnd === -1 ? chunk.length : lineEnd + 1;
                continue;
            } else if (mode === 'start' && ts > targetTimestamp) {
                return {
                    pos,
                    ts: null,
                    preciseMatch: false
                };
            } else if (mode === 'end' && ts < targetTimestamp) {
                return {
                    pos,
                    ts: null,
                    preciseMatch: false
                };
            }

            if (prevTs !== null) {
                if (mode === 'start') {
                    if (ts >= targetTimestamp && prevTs <= targetTimestamp) {
                        return {
                            pos,
                            ts,
                            preciseMatch: true
                        };
                    }
                } else {
                    if (ts <= targetTimestamp && prevTs >= targetTimestamp) {
                        return {
                            pos,
                            ts,
                            preciseMatch: true
                        };
                    }
                }
            }

            prevTs = ts;
            prevPos = pos;
        }
        if (lineEnd === -1) break;

        pos = lineEnd + 1;
    }
    return {
        pos: prevPos,
        ts: prevTs,
        preciseMatch: false,
    };
}

/**
 * Creates a new file slice that contains (within options.precisionBytes) the bytes between the timestamps in the given range.
 * Note that this will never tigthen the range of bytes returned, but may expand it.
 * 
 * @param file - The original file to slice.
 * @param tsRange - The range of timestamps to include in the new file slice.
 * @param options - Optional search options.
 * @returns a new file slice containing approximately the bytes between the timestamps in the given range.
 */
export async function createApproximateFileSlice(
    file: File,
    tsRange: TSRange | { lo?: number, hi?: number },
    options: SearchOptions = {}
): Promise<File> {
    const range = await findOffsetRangeForTimestamps(file, tsRange, options);
    return new File([file.slice(range.lo, range.hi)], file.name, { type: file.type });
}

export async function findOffsetRangeForTimestamps(
    file: File,
    tsRange: TSRange | { lo?: number, hi?: number },
    options: SearchOptions = {}
): Promise<ByteRange> {
    const startOffset = await findByteOffsetForTimestamp(file, tsRange.lo, 'start', options);
    const endOffset = await findByteOffsetForTimestamp(file, tsRange.hi, 'end', options);
    
    return {
        lo: Math.max(0, startOffset.byteOffset),
        hi: Math.min(file.size, endOffset.byteOffset)
    };
} 