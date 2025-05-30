import { getZoneInfo } from "./data/zone_table";
import { MapInstance, XPSnapshot } from "./log-tracker";

export interface LogEventBase {
    name: string;
    ts: number;
    detail?: any;
}

interface VirtualEvent {}

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
    export function label(event: AreaPostLoadEvent): string {
        return `Area loaded in ${(event.detail.delta / 1000).toFixed(1)} seconds`;
    }
}

export type AnyCharacterEvent = Extract<LogEvent, CharacterEvent>;

interface CharacterEvent extends LogEventBase {
    detail: {
        character: string;
    };
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
    export function label(event: DeathEvent): string {
        return `${event.detail.character} has been slain`;
    }
}

export interface JoinedAreaEvent extends CharacterEvent {
    name: "joinedArea";
}
export namespace JoinedAreaEvent {
    export function of(ts: number, character: string): JoinedAreaEvent {
        return { name: "joinedArea", ts, detail: { character } };
    }
    export const icon = 'bi-person-fill-add';
    export const color = 'text-secondary';
    export function label(event: JoinedAreaEvent): string {
        return `${event.detail.character} joined`;
    }
}

export interface LeftAreaEvent extends CharacterEvent {
    name: "leftArea";
}
export namespace LeftAreaEvent {
    export function of(ts: number, character: string): LeftAreaEvent {
        return { name: "leftArea", ts, detail: { character } };
    }
    export const icon = 'bi-person-fill-dash';
    export const color = 'text-secondary';
    export function label(event: LeftAreaEvent): string {
        return `${event.detail.character} left`;
    }
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
    export function label(event: LevelUpEvent): string {
        return `${event.detail.character} is now level ${event.detail.level}`;
    }
}

export interface SetCharacterEvent extends CharacterEvent, VirtualEvent {
    name: "setCharacter";
    detail: {
        character: string;
        level: number;
    };
}
export namespace SetCharacterEvent {
    export function of(ts: number, character: string, level: number): SetCharacterEvent {
        return { name: "setCharacter", ts, detail: { character, level } };
    }
    export const icon = 'bi-person-fill';
    export const color = 'text-secondary';
    export function label(event: SetCharacterEvent): string {
        return `${event.detail.character} set as current (internal)`;
    }
}

export type AnyMsgEvent = Extract<LogEvent, MsgEvent>;

interface MsgEvent extends CharacterEvent {
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
    export const color = 'text-secondary';
    export function label(event: MsgFromEvent): string {
        return `From @${event.detail.character}: ${event.detail.msg}`;
    }
}

export interface MsgToEvent extends MsgEvent {
    name: "msgTo";
}
export namespace MsgToEvent {
    export function of(ts: number, character: string, msg: string): MsgToEvent {
        return { name: "msgTo", ts, detail: { character, msg } };
    }
    export const icon = 'bi-chat-fill';
    export const color = 'text-secondary';
    export function label(event: MsgToEvent): string {
        return `To @${event.detail.character}: ${event.detail.msg}`;
    }
}

export interface MsgPartyEvent extends MsgEvent {
    name: "msgParty";
}
export namespace MsgPartyEvent {
    export function of(ts: number, character: string, msg: string): MsgPartyEvent {
        return { name: "msgParty", ts, detail: { character, msg } };
    }
    export const icon = 'bi-chat-fill';
    export const color = 'text-secondary';
    export function label(event: MsgPartyEvent): string {
        return `%${event.detail.character}: ${event.detail.msg}`;
    }
}

export interface MsgGuildEvent extends MsgEvent {
    name: "msgGuild";
}
export namespace MsgGuildEvent {
    export function of(ts: number, character: string, msg: string): MsgGuildEvent {
        return { name: "msgGuild", ts, detail: { character, msg } };
    }
    export const icon = 'bi-chat-fill';
    export const color = 'text-secondary';
    export function label(event: MsgGuildEvent): string {
        return `&${event.detail.character}: ${event.detail.msg}`;
    }
}

export interface MsgLocalEvent extends MsgEvent {
    name: "msgLocal";
}
export namespace MsgLocalEvent {
    export function of(ts: number, character: string, msg: string): MsgLocalEvent {
        return { name: "msgLocal", ts, detail: { character, msg } };
    }
    export const icon = 'bi-chat-fill';
    export const color = 'text-secondary';
    export function label(event: MsgLocalEvent): string {
        return `${event.detail.character}: ${event.detail.msg}`;
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
    export const icon = 'bi-trophy-fill';
    export const color = 'text-warning';
    export function label(event: BossKillEvent): string {
        return `Boss ${event.detail.bossName} has been slain`;
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
    export const icon = 'bi-plus-circle-fill';
    export const color = 'text-success';
    export function label(event: PassiveGainedEvent): string {
        return `${event.detail.count} Passive points gained`;
    }
}

export interface PassiveAllocatedEvent extends LogEventBase {
    name: "passiveAllocated";
    detail: {
        id: string;
        name: string;
    };
}
export namespace PassiveAllocatedEvent {
    export function of(ts: number, id: string, name: string): PassiveAllocatedEvent {
        return { name: "passiveAllocated", ts, detail: { id, name } };
    }
    export const icon = 'bi-node-plus-fill';
    export const color = 'text-success';
    export function label(event: PassiveAllocatedEvent): string {
        // TODO integrate with passive tree data
        return `Passive skill ${event.detail.name} allocated`;
    }
}

export interface BonusGainedEvent extends LogEventBase {
    name: "bonusGained";
    detail: {
        character?: string;
        bonus: string;
    };
}
export namespace BonusGainedEvent {
    export function of(ts: number, bonus: string, character?: string): BonusGainedEvent {
        const effectiveCharacter = character === 'You' ? undefined : character;
        return { name: "bonusGained", ts, detail: { character: effectiveCharacter, bonus } };
    }
    export const icon = 'bi-patch-plus-fill';
    export const color = 'text-success';
    export function label(event: BonusGainedEvent): string {
        return `${event.detail.character ?? "You"} received ${event.detail.bonus}`;
    }
}

export interface PassiveUnallocatedEvent extends LogEventBase {
    name: "passiveUnallocated";
    detail: {
        id: string;
        name: string;
    };
}
export namespace PassiveUnallocatedEvent {
    export function of(ts: number, id: string, name: string): PassiveUnallocatedEvent {
        return { name: "passiveUnallocated", ts, detail: { id, name } };
    }
    export const icon = 'bi-node-minus-fill';
    export const color = 'text-danger';
    export function label(event: PassiveUnallocatedEvent): string {
        // TODO integrate with passive tree data
        return `Passive skill ${event.detail.name} unallocated`;
    }
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
    export function label(): string {
        return `Trade accepted`;
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
    export const icon = 'bi-magic';
    export const color = 'text-dark';
    export function label(event: ItemsIdentifiedEvent): string {
        return `${event.detail.count} items identified`;
    }
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
    export function label(event: HideoutEnteredEvent): string {
        if (event.detail.areaName.startsWith("Hideout")) {
            return `Hideout entered: ${getZoneInfo(event.detail.areaName)?.label ?? event.detail.areaName.replace(/^Hideout/, "")}`;
        } else {
            return `Town entered: ${getZoneInfo(event.detail.areaName)?.label ?? event.detail.areaName}`;
        }
    }
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
    export function label(): string {
        return `Hideout exited`;
    }
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
    export function label(): string {
        return `Map reentered`;
    }
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
    export function label(): string {
        return `Map entered`;
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
    export const icon = "bi-box-arrow-in-right";
    export const color = "text-success";
    export function label(): string {
        return `Map completed`;
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
    export const icon = 'bi-camera-fill';
    export const color = 'text-info';
    export function label(): string {
        return `XP snapshot`;
    }
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
    setCharacter: SetCharacterEvent,
    passiveGained: PassiveGainedEvent,
    passiveAllocated: PassiveAllocatedEvent,
    passiveUnallocated: PassiveUnallocatedEvent,
    bonusGained: BonusGainedEvent,
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