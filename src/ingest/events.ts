import { getZoneInfo } from "../data/zone_table";
import { MapInstance, XPSnapshot } from "./log-tracker";

export interface LogEventBase {
    name: string;
    ts: number;
    detail?: any; // FIXME should be of type object, but annoying to use with eventMeta
}

interface VirtualEvent {}

export interface LogEventMeta<T extends LogEvent = LogEvent, Args extends any[] = any[]> {
    icon: string;
    color: string;
    of: (...args: Args) => T;
}

export interface LogFileOpenEvent extends LogEventBase {
    name: "logFileOpen";
}
export namespace LogFileOpenEvent {
    export function of(ts: number): LogFileOpenEvent {
        return { name: "logFileOpen", ts };
    }
    export const name = 'Log file opened';
    export const icon = 'bi-file-earmark-text-fill';
    export const color = 'text-secondary';
    export function label(_: LogFileOpenEvent): string {
        return `Log file opened`;
    }
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
        return { name: "areaPostLoad", detail: { delta, uptimeMillis }, ts };
    }
    export const name = 'Area loaded';
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
        return { name: "death", detail: { character, areaLevel }, ts };
    }
    export const name = 'Death';
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
        return { name: "joinedArea", detail: { character }, ts };
    }
    export const name = 'Area joined';
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
        return { name: "leftArea", detail: { character }, ts };
    }
    export const name = 'Area left';
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
        return { name: "levelUp", detail: { character, ascendancy, level }, ts };
    }
    export const name = 'Level up';
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
        ascendancy: string;
        level: number;
    };
}
export namespace SetCharacterEvent {
    export function of(ts: number, character: string, ascendancy: string, level: number): SetCharacterEvent {
        return { name: "setCharacter", detail: { character, ascendancy, level }, ts };
    }
    export function ofEvent(ts: number, event: LevelUpEvent | SetCharacterEvent): SetCharacterEvent {
        return of(ts, event.detail.character, event.detail.ascendancy, event.detail.level);
    }
    export const name = 'Set character (internal)';
    export const icon = 'bi-person-fill';
    export const color = 'text-secondary';
    export function label(event: SetCharacterEvent): string {
        return `${event.detail.character} set to level ${event.detail.level} (internal)`;
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
        return { name: "msgFrom", detail: { character, msg }, ts };
    }
    export const name = 'Whisper sent';
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
        return { name: "msgTo", detail: { character, msg }, ts };
    }
    export const name = 'Whisper received';
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
        return { name: "msgParty", detail: { character, msg }, ts };
    }
    export const name = 'Party message';
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
        return { name: "msgGuild", detail: { character, msg }, ts };
    }
    export const name = 'Guild message';
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
        return { name: "msgLocal", detail: { character, msg }, ts };
    }
    export const name = 'Local message';
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
        return { name: "bossKill", detail: { bossName, msg, areaLevel }, ts };
    }
    export const name = 'Boss kill';
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
        return { name: "passiveGained", detail: { count }, ts };
    }
    export const name = 'Passive gained';
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
        return { name: "passiveAllocated", detail: { id, name }, ts };
    }
    export const name = 'Passive allocated';
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
        return { name: "bonusGained", detail: { character: effectiveCharacter, bonus }, ts };
    }
    export const name = 'Bonus gained';
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
        return { name: "passiveUnallocated", detail: { id, name }, ts };
    }
    export const name = 'Passive unallocated';
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
    export const name = 'Trade accepted';
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
        return { name: "itemsIdentified", detail: { count }, ts };
    }
    export const name = 'Items identified';
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
        return { name: "hideoutEntered", detail: { areaName }, ts };
    }
    export const name = 'Hideout entered';
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
    export const name = 'Hideout exited';
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
    export const name = 'Map reentered';
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
    export const name = 'Map entered';
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
        return { name: "mapCompleted", detail: { map }, ts };
    }
    export const name = 'Map completed';
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
        return { name: "xpSnapshot", detail: { snapshot }, ts };
    }
    export const name = 'XP snapshot';
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
    logFileOpen: LogFileOpenEvent,
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