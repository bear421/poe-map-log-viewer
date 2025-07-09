import { parseTs, parseTsSlow, parseTsStrict, clearOffsetCache } from "../src/ingest/ts-parser";

describe('Timestamp Parser Performance', () => {

    const logLines = [
        "2023/06/15 12:34:56 123456789 abc [INFO Client 123] ...",
        "2023/12/31 23:59:59 987654321 xyz [INFO Client 456] ...",
        "2024/01/01 00:00:00 123123123 def [INFO Client 789] ...",
        "2022/07/22 15:30:45 456789123 ghi [INFO Client 321] ...",
        "2021/03/10 08:15:22 789123456 jkl [INFO Client 654] ..."
    ];

    const iterations = 100000 / logLines.length;
    beforeEach(() => {
        clearOffsetCache();
    });

    test('parseTs performance', () => {
        const then = performance.now();
        for (let i = 0; i < iterations; i++) {
            for (const line of logLines) {
                parseTs(line);
            }
        }

        const endTime = performance.now();
        const totalTime = endTime - then;
        const timePerOperation = totalTime / iterations;
        console.log(`parseTs: ${totalTime.toFixed(2)}ms total, ${timePerOperation.toFixed(6)}ms per operation`);
    });

    test('parseTsStrict performance', () => {
        const then = performance.now();
        for (let i = 0; i < iterations; i++) {
            for (const line of logLines) {
                parseTsStrict(line);
            }
        }

        const endTime = performance.now();
        const totalTime = endTime - then;
        const timePerOperation = totalTime / iterations;
        console.log(`parseTsStrict: ${totalTime.toFixed(2)}ms total, ${timePerOperation.toFixed(6)}ms per operation`);
    });

    test('parseTsSlow performance', () => {
        const then = performance.now();
        for (let i = 0; i < iterations; i++) {
            for (const line of logLines) {
                parseTsSlow(line);
            }
        }

        const endTime = performance.now();
        const totalTime = endTime - then;
        const timePerOperation = totalTime / iterations;
        console.log(`parseTsSlow: ${totalTime.toFixed(2)}ms total, ${timePerOperation.toFixed(6)}ms per operation`);
    });

    test('correctness test', () => {
        for (const line of logLines) {
            const resultFast = parseTs(line);
            const resultStrict = parseTsStrict(line);
            const resultSlow = parseTsSlow(line);
            expect(resultFast).toEqual(resultStrict);
            expect(resultFast).toEqual(resultSlow);
        }
    });

}); 