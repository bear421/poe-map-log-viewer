import { LogEvent } from './log-events';

export class EventDispatcher {

    private listeners: Set<(event: LogEvent) => void> = new Set();


    onAll(listener: (event: LogEvent) => void): (event: LogEvent) => void {
      this.listeners.add(listener);
      return listener;
    }

    on(name: string, listener: (event: LogEvent) => void): (event: LogEvent) => void {
        const listenerWrapper = (event: LogEvent) => {
            if (event.name === name) {
                listener(event);
            }
        };
        return this.onAll(listenerWrapper);
    }

    off(listener: (event: LogEvent) => void): void {
        this.listeners.delete(listener);
    }

    emit(event: LogEvent): void {
        for (const listener of this.listeners) {
            listener(event);
        }
    }

    once(name: string, listener: (event: LogEvent) => void): void {
        const onceWrapper = (event: LogEvent) => {
            if (event.name === name) {
                this.off(onceWrapper);
                listener(event);
            }
        };
        this.listeners.add(onceWrapper);
    }

}