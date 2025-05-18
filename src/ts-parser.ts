const tzOffsetCache = new Map<number, number>();

function getOffsetMs(year: number, month: number, day: number): number {
    const key = year * 10000 + month * 100 + day;
    let off = tzOffsetCache.get(key);
    if (off === undefined) {
        off = new Date(year, month - 1, day).getTimezoneOffset() * 60_000;
        tzOffsetCache.set(key, off);
    }
    return off;
}

/**
 * optmizied ts parser that doesn't create a date object internally. the supplied timestamp is expected to be in the users timezone.
 * @param line a log line that starts with a timestamp with the exact format YYYY/MM/DD HH:MM:SS
 * @returns epoch millis
 */
function parseTs(line: string): number | null {
    const c0 = line.charCodeAt(0);
    if (c0 < 0x30 || c0 > 0x39) return null;

    const d = (i: number) => line.charCodeAt(i) - 0x30;

    const yr  = d(0)*1000 + d(1)*100 + d(2)*10 + d(3);
    const mo  = d(5)*10 + d(6);
    const day = d(8)*10 + d(9);
    const hh  = d(11)*10 + d(12);
    const mm  = d(14)*10 + d(15);
    const ss  = d(17)*10 + d(18);

    return Date.UTC(yr, mo - 1, day, hh, mm, ss) + getOffsetMs(yr, mo, day);
}

function parseUptimeMillis(line: string): number {
    let millis = 0;
    for (let i = 20; i < line.length; i++) {
        const c = line.charCodeAt(i);
        if (c < 0x30 || c > 0x39) {
            break;
        }
        millis = millis * 10 + (c - 0x30);
    }
    return millis;
}

const TS_REGEX = new RegExp("^(\\d{4}/\\d{2}/\\d{2} \\d{2}:\\d{2}:\\d{2})");

function parseTsSlow(line: string): number | null {
    const tsMatch = TS_REGEX.exec(line);
    if (!tsMatch) return null;

    return new Date(tsMatch[1].replace(/\//g, '-')).getTime();
}

function clearOffsetCache(): void {
    tzOffsetCache.clear();
}

export { parseTs, parseUptimeMillis, parseTsSlow, clearOffsetCache };
