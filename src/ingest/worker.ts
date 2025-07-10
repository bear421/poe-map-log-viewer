import { LogTracker, MapInstance, Progress, LogLine } from './log-tracker';
import { Filter } from "../aggregate/filter";
import { LogEvent } from './events';

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

const RMT_SCUM_REGEX = new RegExp(atob('RGlzY29yZDogXGQrcnNnYW1lclxkKiQ='));

self.onmessage = async (e: MessageEvent<IngestRequest | SearchRequest>) => {
    const { type, requestId, file } = e.data;
    const tracker: LogTracker = new LogTracker();

    try {
        if (type === 'ingest') {
            const onProgressCallback = (progress: { totalBytes: number, bytesRead: number }) => {
                self.postMessage({
                    requestId,
                    type: 'progress',
                    payload: progress
                } as ProgressResponse);
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
            
            self.postMessage({
                requestId,
                type: 'ingest',
                payload: { maps, events }
            } as IngestResponse);
        } else if (type === 'search') {
            const { pattern, limit, filter } = e.data;
            const onSearchProgress = (progress: Progress) => {
                self.postMessage({
                    requestId,
                    type: 'progress',
                    payload: progress
                } as ProgressResponse);
            }

            const tsFilter = filter?.userTsBounds && filter.userTsBounds.length > 0 ? 
                { lo: filter.userTsBounds[0].lo, hi: filter.userTsBounds[filter.userTsBounds.length - 1].hi } : 
                undefined;
            
            const lines = await tracker.searchLogFile(pattern, limit, file, onSearchProgress, tsFilter);
            self.postMessage({
                requestId,
                type: 'search',
                payload: { lines }
            } as SearchResponse);
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