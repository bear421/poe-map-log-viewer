import bosses1 from "./gen/1/bosses.json";
import bosses2 from "./gen/2/bosses.json";

function parseBosses(bosses: Record<string, { deathCries: string[], alias?: string }>): Record<string, { deathCries: Set<string>, alias?: string, greetings?: Set<string> }> {
    return Object.fromEntries(
        Object.entries(bosses).map(([name, o]) => [
            name,
            { deathCries: new Set(o.deathCries.map(dc => " " + dc)), alias: (o as { alias?: string }).alias }
        ])
    );
}

export const BOSSES_1: Record<string, { deathCries: Set<string>, alias?: string, greetings?: Set<string> }> = parseBosses(bosses1);
export const BOSSES_2: Record<string, { deathCries: Set<string>, alias?: string, greetings?: Set<string> }> = parseBosses(bosses2);
export const BOSSES = { ...BOSSES_1, ...BOSSES_2 };