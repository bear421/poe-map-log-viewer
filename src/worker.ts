import { InstanceTracker, MapInstance, Filter } from './instance-tracker';
import { LogEvent } from './event-dispatcher';

interface WorkerMessage {
    type: string;
    file: File;
    pattern?: RegExp;
    limit?: number;
    filter?: Filter;
}

interface CompleteMessage {
    type: 'complete';
    data: {
        maps: MapInstance[];
        events: LogEvent[];
    };
}

interface ErrorMessage {
    type: 'error';
    data: {
        error: string;
    };
}

interface SearchMessage {
    type: 'search';
    data: {
        lines: string[];
    };
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
    const { type, file } = e.data;
    const then = performance.now();
    const tracker: InstanceTracker = new InstanceTracker();
    const filter = e.data.filter;
    try {
        if (type === 'process') {
            const maps: MapInstance[] = [];
            const events: LogEvent[] = [];
            tracker.eventDispatcher.onAll((event: LogEvent) => {
                switch (event.name) {
                    case 'mapCompleted':
                        maps.push(event.detail.map);
                        break;
                    default:
                        events.push(event);
                        break;
                }
            });
            await tracker.processLogFile(file, filter);
            const tookSeconds = ((performance.now() - then) / 1000).toFixed(2);
            self.postMessage({
                type: 'complete',
                data: { maps, events }
            } as CompleteMessage);
            console.info(`Processed ${maps.length} maps in ${tookSeconds} seconds`);
            console.info(`Average processing rate: ${(maps.length / parseFloat(tookSeconds)).toFixed(2)} maps/s`);
        } else if (type === 'search') {
            const { pattern, limit } = e.data;
            if (!pattern) throw new Error('Pattern is required');

            if (!limit) throw new Error('Limit is required');

            const lines = await tracker.searchLogFile(pattern, limit, file, filter);
            self.postMessage({
                type: 'search',
                data: { lines }
            } as SearchMessage);
        }
    } catch (error) {
        self.postMessage({
            type: 'error',
            data: { error: error }
        } as ErrorMessage);
    }
}; 