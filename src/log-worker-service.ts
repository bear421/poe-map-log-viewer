import { Filter, Progress } from './log-tracker';
import { IngestRequest, SearchRequest, IngestResponse, SearchResponse, ErrorResponse, AnyResponse } from './worker';


interface PendingRequest {
    resolve: (value: any) => void;
    reject: (reason: ErrorResponse) => void;
    onProgress?: (progress: Progress) => void;
}

export class LogWorkerService {
    private worker: Worker;
    private pendingRequests: Map<string, PendingRequest> = new Map();
    private requestIdCounter: number = 0;

    constructor() {
        this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = this.handleWorkerMessage.bind(this);
        this.worker.onerror = this.handleWorkerError.bind(this);
    }

    private nextRequestId(): string {
        return (++this.requestIdCounter).toString();
    }

    private handleWorkerMessage(event: MessageEvent): void {
        const response = event.data as AnyResponse;
        const requestId = response.requestId;
        const request = this.pendingRequests.get(requestId);
        if (!request) {
            console.error('Received worker message for unknown requestId', response);
            return;
        }
        switch (response.type) {
            case 'progress':
                if (request.onProgress) {
                    request.onProgress(response.payload); 
                }
                break;
            case 'ingest':
            case 'search':
                request.resolve(response.payload);
                this.pendingRequests.delete(requestId);
                break;
            case 'error':
                request.reject(response);
                this.pendingRequests.delete(requestId);
                break;
        }
    }
    
    private handleWorkerError(error: ErrorEvent): void {
        console.error('Generic Web Worker error:', error.message, error);
    }

    public ingestLog(file: File, onProgress?: (progress: Progress) => void): Promise<IngestResponse['payload']> {
        return new Promise((resolve, reject) => {
            const requestId = this.nextRequestId();
            this.pendingRequests.set(requestId, { resolve, reject, onProgress });
            this.worker.postMessage({
                type: 'ingest',
                requestId,
                file
            } as IngestRequest);
        });
    }

    public searchLog(pattern: RegExp, limit: number, file: File, filter?: Filter, onProgress?: (progress: Progress) => void): Promise<SearchResponse['payload']> {
        return new Promise((resolve, reject) => {
            const requestId = this.nextRequestId();
            this.pendingRequests.set(requestId, { resolve, reject, onProgress });
            this.worker.postMessage({
                type: 'search',
                requestId,
                file,
                pattern,
                limit,
                filter
            } as SearchRequest);
        });
    }
}

export const logWorkerService = new LogWorkerService(); 