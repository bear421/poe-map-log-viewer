import { MapInstance, XPSnapshot } from "./log-tracker";

export interface LogEventBase {
    name: string;
    ts: number;
    detail?: any;
}

export interface LogEventMeta<T extends LogEvent = LogEvent, Args extends any[] = any[]> {
    icon: string;
    color: string;
    of: (...args: Args) => T;
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
    export const icon = 'bi-stopwatch';
    export const color = 'text-dark';
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
    export const icon = 'bi-chat-fill';
    export const color = 'text-primary';
}

export interface MsgToEvent extends MsgEvent {
    name: "msgTo";
}
export namespace MsgToEvent {
    export function of(ts: number, character: string, msg: string): MsgToEvent {
        return { name: "msgTo", ts, detail: { character, msg } };
    }
    export const icon = 'bi-chat-fill';
    export const color = 'text-primary';
}

export interface MsgPartyEvent extends MsgEvent {
    name: "msgParty";
}
export namespace MsgPartyEvent {
    export function of(ts: number, character: string, msg: string): MsgPartyEvent {
        return { name: "msgParty", ts, detail: { character, msg } };
    }
    export const icon = 'bi-chat-fill';
    export const color = 'text-primary';
}

export interface MsgGuildEvent extends MsgEvent {
    name: "msgGuild";
}
export namespace MsgGuildEvent {
    export function of(ts: number, character: string, msg: string): MsgGuildEvent {
        return { name: "msgGuild", ts, detail: { character, msg } };
    }
    export const icon = 'bi-chat-fill';
    export const color = 'text-primary';
}

export interface MsgLocalEvent extends MsgEvent {
    name: "msgLocal";
}
export namespace MsgLocalEvent {
    export function of(ts: number, character: string, msg: string): MsgLocalEvent {
        return { name: "msgLocal", ts, detail: { character, msg } };
    }
    export const icon = 'bi-chat-fill';
    export const color = 'text-primary';
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
    export const icon = 'bi-trophy-fill';
    export const color = 'text-warning';
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
    export const icon = 'bi-heartbreak-fill';
    export const color = 'text-danger';
}

export interface JoinedAreaEvent extends CharacterEvent {
    name: "joinedArea";
}
export namespace JoinedAreaEvent {
    export function of(ts: number, character: string): JoinedAreaEvent {
        return { name: "joinedArea", ts, detail: { character } };
    }
    export const icon = 'bi-person-fill-add';
    export const color = 'text-primary';
}

export interface LeftAreaEvent extends CharacterEvent {
    name: "leftArea";
}
export namespace LeftAreaEvent {
    export function of(ts: number, character: string): LeftAreaEvent {
        return { name: "leftArea", ts, detail: { character } };
    }
    export const icon = 'bi-person-fill-dash';
    export const color = 'text-primary';
}

export interface LevelUpEvent extends LogEventBase {
    name: "levelUp";
    detail: {
        character: string;
        ascendancy: string;
        level: number;
    };
}
export namespace LevelUpEvent {
    export function of(ts: number, character: string, ascendancy: string, level: number): LevelUpEvent {
        return { name: "levelUp", ts, detail: { character, ascendancy, level } };
    }
    export const icon = 'bi-arrow-up-square-fill';
    export const color = 'text-success';
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
    export const icon = 'bi-plus-circle-fill';
    export const color = 'text-success';
}

export interface TradeAcceptedEvent extends LogEventBase {
    name: "tradeAccepted";
}
export namespace TradeAcceptedEvent {
    export function of(ts: number): TradeAcceptedEvent {
        return { name: "tradeAccepted", ts };
    }
    export const icon = 'bi-currency-exchange';
    export const color = 'text-warning';
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
    export const icon = 'bi-magic';
    export const color = 'text-dark';
}

export interface HideoutEnteredEvent extends LogEventBase {
    name: "hideoutEntered";
    detail: {
        areaName: string;
    };
}
export namespace HideoutEnteredEvent {
    export function of(ts: number, areaName: string): HideoutEnteredEvent {
        return { name: "hideoutEntered", ts, detail: { areaName } };
    }
    export const icon = 'bi-house-fill';
    export const color = 'text-primary';
}

export interface HideoutExitedEvent extends LogEventBase {
    name: "hideoutExited";
}
export namespace HideoutExitedEvent {
    export function of(ts: number): HideoutExitedEvent {
        return { name: "hideoutExited", ts };
    }
    export const icon = 'bi-house-fill';
    export const color = 'text-primary';
}

export interface MapReenteredEvent extends LogEventBase {
    name: "mapReentered";
}
export namespace MapReenteredEvent {
    export function of(ts: number): MapReenteredEvent {
        return { name: "mapReentered", ts };
    }
    export const icon = 'bi-repeat';
    export const color = 'text-primary';
}

export interface MapEnteredEvent extends LogEventBase {
    name: "mapEntered";
}
export namespace MapEnteredEvent {
    export function of(ts: number): MapEnteredEvent {
        return { name: "mapEntered", ts };
    }
    export const icon = 'bi-box-arrow-in-right';
    export const color = 'text-muted';
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
    export const icon = "bi-box-arrow-in-right";
    export const color = "text-success";
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
    export const icon = 'bi-camera-fill';
    export const color = 'text-info';
}

export function getEventMeta<E extends LogEvent>(event: E): typeof eventMeta[E["name"]] {
    return eventMeta[event.name as E["name"]];
}

export const eventMeta = {
    areaPostLoad: AreaPostLoadEvent,
    msgFrom: MsgFromEvent,
    msgTo: MsgToEvent,
    msgParty: MsgPartyEvent,
    msgGuild: MsgGuildEvent,
    msgLocal: MsgLocalEvent,
    bossKill: BossKillEvent,
    death: DeathEvent,
    joinedArea: JoinedAreaEvent,
    leftArea: LeftAreaEvent,
    levelUp: LevelUpEvent,
    passiveGained: PassiveGainedEvent,
    tradeAccepted: TradeAcceptedEvent,
    itemsIdentified: ItemsIdentifiedEvent,
    hideoutEntered: HideoutEnteredEvent,
    hideoutExited: HideoutExitedEvent,
    mapReentered: MapReenteredEvent,
    mapEntered: MapEnteredEvent,
    mapCompleted: MapCompletedEvent,
    xpSnapshot: XPSnapshotEvent,
} as const;

export type EventName = keyof typeof eventMeta;
type EventInstanceTypeMap = {
  [K in EventName]: ReturnType<typeof eventMeta[K]['of']>;
};
export type LogEvent = EventInstanceTypeMap[EventName];