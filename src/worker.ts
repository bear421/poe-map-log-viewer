import { LogTracker, MapInstance, Filter, Segmentation, Progress, LogLine } from './log-tracker';
import { LogEvent } from './log-events';
import { binarySearchFindFirst, binarySearchFindLast } from "./binary-search";

interface RequestMessage {
    requestId: string;
    type: string;
}

export interface IngestRequest extends RequestMessage {
    type: 'ingest';
    file: File;
}

export interface SearchRequest extends RequestMessage {
    type: 'search';
    file: File;
    pattern: RegExp;
    limit: number;
    filter?: Filter;
}

interface ReponseMessage {
    requestId: string;
    type: string;
    payload?: any;
}

export interface ProgressResponse extends ReponseMessage {
    type: 'progress';
    payload: Progress;
}

export interface IngestResponse extends ReponseMessage {
    type: 'ingest';
    payload: {
        maps: MapInstance[];
        events: LogEvent[];
    };
}

export interface SearchResponse extends ReponseMessage {
    type: 'search';
    payload: {
        lines: LogLine[];
    };
}

export interface ErrorResponse extends ReponseMessage {
    type: 'error';
    payload: {
        error: any; 
    };
}

export type AnyResponse = IngestResponse | SearchResponse | ProgressResponse | ErrorResponse;

type BytesTsIndex = {ts: number, bytes: number}[];
const TS_BYTES_CACHE = new Map<string, BytesTsIndex>();
const RMT_SCUM_REGEX = new RegExp(atob('RGlzY29yZDogXGQrcnNnYW1lclxkKiQ='));

function getFileCacheKey(file: File): string {
    return `${file.name}-${file.size}-${file.lastModified}`;
}

self.onmessage = async (e: MessageEvent<IngestRequest | SearchRequest>) => {
    const { type, requestId, file } = e.data;
    const then = performance.now();
    const tracker: LogTracker = new LogTracker();

    try {
        if (type === 'ingest') {
            let totalBytesValue = 0;
            let bytesReadThreshold: number | null = null;
            let nextIndexEntry: { eventIndex: number, bytesRead: number } | null = null;
            const bytesTsIndex: BytesTsIndex = [];
            
            const onProgressCallback = (progress: { totalBytes: number, bytesRead: number }) => {
                self.postMessage({
                    requestId,
                    type: 'progress',
                    payload: progress
                } as ProgressResponse);
                if (!bytesReadThreshold) {
                    totalBytesValue = progress.totalBytes;
                    bytesReadThreshold = totalBytesValue * 0.03;
                } else if (progress.bytesRead > bytesReadThreshold) {
                    if (nextIndexEntry && nextIndexEntry.eventIndex < events.length) {
                        bytesTsIndex.push({ts: events[nextIndexEntry.eventIndex].ts, bytes: nextIndexEntry.bytesRead});
                        bytesReadThreshold += totalBytesValue * 0.03;
                        nextIndexEntry = null;
                    } else {
                        nextIndexEntry = { eventIndex: events.length, bytesRead: progress.bytesRead };
                    }
                }
            }

            const maps: MapInstance[] = [];
            const events: LogEvent[] = [];
            tracker.eventDispatcher.onAll((event: LogEvent) => {
                switch (event.name) {
                    case 'mapCompleted':
                        maps.push(event.detail.map);
                        break;
                    case "hideoutExited":
                        break;
                    case "msgFrom":
                        if (RMT_SCUM_REGEX.test(event.detail.msg)) {
                            return;
                        }
                    default:
                        events.push(event);
                        break;
                }
            });

            await tracker.ingestLogFile(file, onProgressCallback);
            TS_BYTES_CACHE.set(getFileCacheKey(file), bytesTsIndex);
            const tookSeconds = ((performance.now() - then) / 1000).toFixed(2);
            
            self.postMessage({
                requestId,
                type: 'ingest',
                payload: { maps, events }
            } as IngestResponse);

            const totalMiB = totalBytesValue / 1024 / 1024;
            console.info(`Processed ${maps.length} maps (${(totalMiB).toFixed(1)} MiB of logs) in ${tookSeconds} seconds`);
            console.info(`Average processing rate: ${(maps.length / parseFloat(tookSeconds)).toFixed(2)} maps/s (${(totalMiB / parseFloat(tookSeconds)).toFixed(1)} MiB/s)`);
        
        } else if (type === 'search') {
            const { pattern, limit, filter } = e.data;

            const onSearchProgress = (progress: { totalBytes: number, bytesRead: number }) => {
                self.postMessage({
                    requestId,
                    type: 'progress',
                    payload: progress
                } as ProgressResponse);
            }

            let offsetFile = file;
            let tsFilter = Segmentation.toBoundingInterval(filter?.tsBounds ?? [])[0];
            if (tsFilter) {
                const fileKey = getFileCacheKey(file);
                const bytesTsIndex = TS_BYTES_CACHE.get(fileKey);
                if (bytesTsIndex && bytesTsIndex.length > 0) {
                    const indexEntryLo = binarySearchFindLast(bytesTsIndex, x => x.ts < tsFilter.lo);
                    const indexEntryHi = binarySearchFindFirst(bytesTsIndex, x => x.ts > tsFilter.hi);
                    let bytesOffsetLo = indexEntryLo?.bytes ?? 0;
                    let bytesOffsetHi = indexEntryHi?.bytes ?? file.size;
                    if (bytesOffsetLo) {
                        offsetFile = new File([file.slice(bytesOffsetLo, bytesOffsetHi)], file.name, { type: file.type });
                    }
                }
            }
            const lines = await tracker.searchLogFile(pattern, limit, offsetFile, onSearchProgress, tsFilter);
            self.postMessage({
                requestId,
                type: 'search',
                payload: { lines }
            } as SearchResponse);
            console.log(`search took ${((performance.now() - then) / 1000).toFixed(2)} seconds`, filter);
        }
    } catch (error: any) {
        console.error(`Worker error for requestId ${requestId}:`, error);
        self.postMessage({
            requestId,
            type: 'error',
            payload: { error }
        } as ErrorResponse);
    }
}; 