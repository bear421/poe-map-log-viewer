import areas1 from "./gen/1/areas.json";
import areas2 from "./gen/2/areas.json";

class ZoneInfo {

    constructor(
        readonly label: string, 
        readonly act: number, 
        readonly areaLevel: number, 
        readonly isMapArea: boolean = false,
        readonly isTown: boolean = false,
        readonly isHideout: boolean = false,
        readonly isUnique: boolean = false,
        readonly campaignCompletionIndicator: boolean = false,
    ) {}

    get url(): string {
        return `https://poe2db.tw/us/${this.label.replace(/ /g, "_")}`;
    }
}


function parseAreas(areas: any[]): Record<string, ZoneInfo> {
    return Object.fromEntries(areas.map((o) => [
        o.Id,
        new ZoneInfo(o.Name, o.Act, o.AreaLevel, o.IsTown, o.IsHideout, o.IsUnique, o.Id == "Karui Shores" || o.Id == "The Ziggurat Refuge")
    ]));
}

const AREAS_1 = parseAreas(areas1);
const AREAS_2 = parseAreas(areas2);

const SANCTUM_A2 = new ZoneInfo("Trial of the Sekhemas (A2)", 2, 22);
const SANCTUM_A4 = new ZoneInfo("Trial of the Sekhemas (A4)", 4, 40);

export function getZoneInfo(areaName: string, areaLevel?: number): ZoneInfo | undefined {
    const zi = AREAS_2[areaName] || AREAS_1[areaName];
    if (zi) return zi;

    if (areaLevel && areaName.startsWith("Sanctum_")) {
        if (areaLevel <= 22) {
            return SANCTUM_A2;
        } else if (areaLevel <= 40) {
            return SANCTUM_A4;
        }
    }
    return undefined;
}

export function getGameVersion(areaName: string): 1 | 2 | undefined {
    if (AREAS_2[areaName]) return 2;

    if (AREAS_1[areaName]) return 1;

    return undefined;
}
