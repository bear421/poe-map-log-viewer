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

    const utcMs = Date.UTC(yr, mo - 1, day, hh, mm, ss);
    const epochMs = utcMs + getOffsetMs(yr, mo, day);
    return epochMs;
}

function parseTsUnchecked(line: string): number {
    const d = (i: number) => line.charCodeAt(i) - 0x30;
    const yr  = d(0)*1000 + d(1)*100 + d(2)*10 + d(3);
    const mo  = d(5)*10 + d(6);
    const day = d(8)*10 + d(9);
    const hh  = d(11)*10 + d(12);
    const mm  = d(14)*10 + d(15);
    const ss  = d(17)*10 + d(18);

    const utcMs = Date.UTC(yr, mo - 1, day, hh, mm, ss);
    return utcMs + getOffsetMs(yr, mo, day);
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

export { parseTs, parseTsUnchecked, parseTsSlow, clearOffsetCache };
