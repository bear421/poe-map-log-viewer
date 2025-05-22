import { MapInstance, XPSnapshot } from "./instance-tracker";

export interface LogEventBase {
    name: string;
    ts: number;
    detail?: any;
}

export interface AreaPostLoadEvent extends LogEventBase {
    name: "areaPostLoad";
    detail: {
        delta: number;
        uptimeMillis: number;
    };
}
export namespace AreaPostLoadEvent {
    export function of(ts: number, delta: number, uptimeMillis: number): AreaPostLoadEvent {
        return { name: "areaPostLoad", ts, detail: { delta, uptimeMillis } };
    }
}

export interface CharacterEvent extends LogEventBase {
    detail: {
        character: string;
    };
}

export interface MsgEvent extends CharacterEvent {
    detail: {
        character: string;
        msg: string;
    };
}

export interface MsgFromEvent extends MsgEvent {
    name: "msgFrom";
}
export namespace MsgFromEvent {
    export function of(ts: number, character: string, msg: string): MsgFromEvent {
        return { name: "msgFrom", ts, detail: { character, msg } };
    }
}

export interface MsgToEvent extends MsgEvent {
    name: "msgTo";
}
export namespace MsgToEvent {
    export function of(ts: number, character: string, msg: string): MsgToEvent {
        return { name: "msgTo", ts, detail: { character, msg } };
    }
}

export interface MsgPartyEvent extends MsgEvent {
    name: "msgParty";
}
export namespace MsgPartyEvent {
    export function of(ts: number, character: string, msg: string): MsgPartyEvent {
        return { name: "msgParty", ts, detail: { character, msg } };
    }
}

export interface MsgLocalEvent extends MsgEvent {
    name: "msgLocal";
}
export namespace MsgLocalEvent {
    export function of(ts: number, character: string, msg: string): MsgLocalEvent {
        return { name: "msgLocal", ts, detail: { character, msg } };
    }
}

export interface BossKillEvent extends LogEventBase {
    name: "bossKill";
    detail: {
        bossName: string;
        msg: string;
        areaLevel: number;
    };
}
export namespace BossKillEvent {
    export function of(ts: number, bossName: string, msg: string, areaLevel: number): BossKillEvent {
        return { name: "bossKill", ts, detail: { bossName, msg, areaLevel } };
    }
}

export interface DeathEvent extends CharacterEvent {
    name: "death";
    detail: {
        character: string;
        areaLevel: number;
    };
}
export namespace DeathEvent {
    export function of(ts: number, character: string, areaLevel: number): DeathEvent {
        return { name: "death", ts, detail: { character, areaLevel } };
    }
}

export interface JoinedAreaEvent extends CharacterEvent {
    name: "joinedArea";
}
export namespace JoinedAreaEvent {
    export function of(ts: number, character: string): JoinedAreaEvent {
        return { name: "joinedArea", ts, detail: { character } };
    }
}

export interface LeftAreaEvent extends CharacterEvent {
    name: "leftArea";
}
export namespace LeftAreaEvent {
    export function of(ts: number, character: string): LeftAreaEvent {
        return { name: "leftArea", ts, detail: { character } };
    }
}

export interface LevelUpEvent extends LogEventBase {
    name: "levelUp";
    detail: {
        character: string;
        ascendancy: string;
        level: string;
    };
}
export namespace LevelUpEvent {
    export function of(ts: number, character: string, ascendancy: string, level: string): LevelUpEvent {
        return { name: "levelUp", ts, detail: { character, ascendancy, level } };
    }
}

export interface PassiveGainedEvent extends LogEventBase {
    name: "passiveGained";
    detail: {
        count: number;
    };
}
export namespace PassiveGainedEvent {
    export function of(ts: number, count: number): PassiveGainedEvent {
        return { name: "passiveGained", ts, detail: { count } };
    }
}

export interface TradeAcceptedEvent extends LogEventBase {
    name: "tradeAccepted";
}
export namespace TradeAcceptedEvent {
    export function of(ts: number): TradeAcceptedEvent {
        return { name: "tradeAccepted", ts };
    }
}

export interface ItemsIdentifiedEvent extends LogEventBase {
    name: "itemsIdentified";
    detail: {
        count: number;
    };
}
export namespace ItemsIdentifiedEvent {
    export function of(ts: number, count: number): ItemsIdentifiedEvent {
        return { name: "itemsIdentified", ts, detail: { count } };
    }
}

export interface HideoutEnteredEvent extends LogEventBase {
    name: "hideoutEntered";
}
export namespace HideoutEnteredEvent {
    export function of(ts: number): HideoutEnteredEvent {
        return { name: "hideoutEntered", ts };
    }
}

export interface HideoutExitedEvent extends LogEventBase {
    name: "hideoutExited";
}
export namespace HideoutExitedEvent {
    export function of(ts: number): HideoutExitedEvent {
        return { name: "hideoutExited", ts };
    }
}

export interface MapReenteredEvent extends LogEventBase {
    name: "mapReentered";
}
export namespace MapReenteredEvent {
    export function of(ts: number): MapReenteredEvent {
        return { name: "mapReentered", ts };
    }
}

export interface MapEnteredEvent extends LogEventBase {
    name: "mapEntered";
}
export namespace MapEnteredEvent {
    export function of(ts: number): MapEnteredEvent {
        return { name: "mapEntered", ts };
    }
}

export interface MapCompletedEvent extends LogEventBase {
    name: "mapCompleted";
    detail: {
        map: MapInstance;
    };
}
export namespace MapCompletedEvent {
    export function of(ts: number, map: MapInstance): MapCompletedEvent {
        return { name: "mapCompleted", ts, detail: { map } };
    }
}

export interface XPSnapshotEvent extends LogEventBase {
    name: "xpSnapshot";
    detail: {
        snapshot: XPSnapshot;
    };
}
export namespace XPSnapshotEvent {
    export function of(ts: number, snapshot: XPSnapshot): XPSnapshotEvent {
        return { name: "xpSnapshot", ts, detail: { snapshot } };
    }
}

export type LogEvent =
    | AreaPostLoadEvent
    | MsgFromEvent
    | MsgToEvent
    | MsgPartyEvent
    | MsgLocalEvent
    | BossKillEvent
    | DeathEvent
    | JoinedAreaEvent
    | LeftAreaEvent
    | LevelUpEvent
    | PassiveGainedEvent
    | TradeAcceptedEvent
    | ItemsIdentifiedEvent
    | HideoutEnteredEvent
    | HideoutExitedEvent
    | MapReenteredEvent
    | MapEnteredEvent
    | MapCompletedEvent
    | XPSnapshotEvent