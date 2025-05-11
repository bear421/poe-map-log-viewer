import { InstanceTracker, MapInstance, Filter } from './instance-tracker';

interface WorkerMessage {
    type: string;
    file: File;
    pattern?: RegExp;
    limit?: number;
    filter?: Filter;
}

interface ProgressMessage {
    type: 'progress';
    data: {
        progress: number;
    };
}

interface CompleteMessage {
    type: 'complete';
    data: {
        maps: MapInstance[];
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

type WorkerResponse = ProgressMessage | CompleteMessage | ErrorMessage;

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
    const { type, file } = e.data;
    const then = performance.now();
    const tracker: InstanceTracker = new InstanceTracker();
    const filter = e.data.filter;
    try {
        if (type === 'process') {
            const maps: MapInstance[] = [];
            // instance-tracker currently only filters by ts
            const filterFn = filter ? (m: MapInstance) => {
                if (filter!.fromAreaLevel && m.areaLevel < filter!.fromAreaLevel) return false;

                if (filter!.toAreaLevel && m.areaLevel > filter!.toAreaLevel) return false;

                return true;
            } : () => true;
            tracker.addEventListener('mapCompleted', ((event: CustomEvent) => {
                filterFn(event.detail.map) && maps.push(event.detail.map);
            }) as EventListener);

            await tracker.processLogFile(file, filter);
            const tookSeconds = ((performance.now() - then) / 1000).toFixed(2);
            self.postMessage({
                type: 'complete',
                data: { maps }
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