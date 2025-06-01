const tzHourCache = new Map<number, number>();

function getOffsetMillisForHour(year: number, month: number, day: number, hour: number): number {
    const key = year * 1_000_000 + (month * 10_000) + (day * 100) + hour;
    let offsetMillis = tzHourCache.get(key);
    if (offsetMillis === undefined) {
        offsetMillis = new Date(year, month - 1, day, hour).getTimezoneOffset() * 60_000;
        tzHourCache.set(key, offsetMillis);
    }
    return offsetMillis;
}

/**
 * optimized ts parser. the supplied timestamp is expected to be in the user's timezone.
 * @param line a log line that starts with a timestamp with the exact format YYYY/MM/DD HH:MM:SS
 * @returns epoch millis
 */
export function parseTs(line: string): number | null {
    const c0 = line.charCodeAt(0);
    if (c0 < 0x30 || c0 > 0x39) return null;

    const d = (i: number) => line.charCodeAt(i) - 0x30;

    const yr  = d(0)*1000 + d(1)*100 + d(2)*10 + d(3);
    const mo  = d(5)*10 + d(6);
    const day = d(8)*10 + d(9);
    const hh  = d(11)*10 + d(12);
    const mm  = d(14)*10 + d(15);
    const ss  = d(17)*10 + d(18);

    const offsetMillis = getOffsetMillisForHour(yr, mo, day, hh);
    return Date.UTC(yr, mo - 1, day, hh, mm, ss) - offsetMillis;
}

const TS_REGEX_STRICT = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/;

export function parseTsStrict(line: string): number | null {
    const m = TS_REGEX_STRICT.exec(line);
    if (!m) return null;

    const yr  = parseInt(m[1]);
    if (isNaN(yr)) return null;
    const mo  = parseInt(m[2]);
    if (isNaN(mo)) return null;
    const day = parseInt(m[3]);
    if (isNaN(day)) return null;
    const hh  = parseInt(m[4]);
    if (isNaN(hh)) return null;
    const mm  = parseInt(m[5]);
    if (isNaN(mm)) return null;
    const ss  = parseInt(m[6]);
    if (isNaN(ss)) return null;

    const offsetMillis = getOffsetMillisForHour(yr, mo, day, hh);
    return Date.UTC(yr, mo - 1, day, hh, mm, ss) - offsetMillis;
}

export function parseUptimeMillis(line: string): number {
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

export function parseTsSlow(line: string): number | null {
    const tsMatch = TS_REGEX.exec(line);
    if (!tsMatch) return null;

    return new Date(tsMatch[1].replace(/\//g, '-')).getTime();
}

export function clearOffsetCache(): void {
    tzHourCache.clear();
}