import { checkContiguous } from "../util";
import { ContiguousArray } from "../util";
import { LogEvent, LevelUpEvent, SetCharacterEvent, AnyCharacterEvent } from "../ingest/events";
import { MapInstance } from "../ingest/log-tracker";
import { FrameBarrier } from "../util";
import { binarySearchFindLast, binarySearchFindLastIx, binarySearchRange } from "../binary-search";
import { computeIfAbsent } from "../util";
import { isFeatureSupportedAt, Feature } from "../data/log-versions";
import { Segmentation } from "./segmentation";
import { getZoneInfo } from "../data/zone_table";

export interface CharacterInfo {
    name: string;
    level: number;
    ascendancy: string;
    createdTs: number;
    campaignCompletedTs: number;
    lastPlayedTs: number;
}

export class CharacterAggregation {
    readonly characterLevelIndex: Map<string, (LevelUpEvent|SetCharacterEvent)[]>;
    readonly characterTsIndex: AnyCharacterEvent[];
    readonly characterLevelSegmentation: Map<string, Segmentation[]>;
    readonly characters: CharacterInfo[];

    constructor(characterLevelIndex: Map<string, (LevelUpEvent|SetCharacterEvent)[]>, characterTsIndex: AnyCharacterEvent[], characterLevelSegmentation: Map<string, Segmentation[]>, 
            characters: CharacterInfo[]) {
        this.characterLevelIndex = characterLevelIndex;
        this.characterTsIndex = characterTsIndex;
        this.characterLevelSegmentation = characterLevelSegmentation;
        this.characters = characters;
    }

    /**
     * @returns true if the character is likely to be owned by the owner of the log file
     */
    isOwned(character: string): boolean {
        return this.characterLevelIndex.has(character);
    }

    /**
     * @returns the level of the character that was likely active at the specified timestamp
     */
    guessLevel(ts: number): number {
        const levelEvent = this.guessLevelEvent(ts);
        if (!levelEvent) return 1;

        return levelEvent.detail.level;
    }

    /**
     * @returns the levelUp event or setCharacter event that occurred at or before the specified timestamp
     */
    guessLevelEvent(ts: number): LevelUpEvent | SetCharacterEvent | undefined {
        const anyEvent = this.guessAnyEvent(ts);
        if (!anyEvent) return undefined;

        const levelIndex = this.characterLevelIndex.get(anyEvent.detail.character);
        if (!levelIndex) throw new Error("illegal state: no level index found for character " + anyEvent.detail.character);

        return binarySearchFindLast(levelIndex, (e) => e.ts <= ts);
    }

    /**
     * @returns any character event before or at the specified timestamp, i.e. the character that was likely active at the specified timestamp
     */
    guessAnyEvent(ts: number): AnyCharacterEvent | undefined {
        return binarySearchFindLast(this.characterTsIndex, (e) => e.ts <= ts);
    }

    guessSegmentation(levelFrom?: number, levelTo?: number, character?: string): Segmentation | undefined {
        if (character) {
            const levelIndex = this.characterLevelSegmentation.get(character);
            if (!levelIndex) throw new Error("illegal state: no level index found for character " + character);

            return this.guessSegmentationFor(levelIndex, levelFrom, levelTo);
        } else if (levelFrom || levelTo) {
            const segmentation: Segmentation = [];
            for (const levelIndex of this.characterLevelSegmentation.values()) {
                const characterSegmentation = this.guessSegmentationFor(levelIndex, levelFrom, levelTo);
                if (characterSegmentation) {
                    segmentation.push(...characterSegmentation);
                }
            }
            if (!segmentation.length) return undefined;

            segmentation.sort((a, b) => a.lo - b.lo);
            return Segmentation.mergeContiguousConnected(segmentation);
        }
        return [];
    }

    private guessSegmentationFor(levelIndex: Segmentation[], levelFrom?: number, levelTo?: number): Segmentation | undefined {
        const segmentation: Segmentation = [];
        const limit = Math.min((levelTo ?? 100), levelIndex.length);
        for (let i = (levelFrom ?? 1) - 1; i < limit; i++) {
            const levelSegmentation = levelIndex[i];
            levelSegmentation && segmentation.push(...levelSegmentation);
        }
        return segmentation.length ? Segmentation.mergeContiguousConnected(segmentation) : undefined;
    }

    guessSegmentations(levelFrom?: number, levelTo?: number, characters?: string[]): Map<string, Segmentation> {
        if (!characters) {
            characters = Array.from(this.characterLevelSegmentation.keys());
        }
        const segmentations = new Map<string, Segmentation>();
        for (const character of characters) {
            const segmentation = this.guessSegmentation(levelFrom, levelTo, character);
            if (segmentation) {
                segmentations.set(character, segmentation);
            }
        }
        return segmentations;
    }
}

export async function buildCharacterAggregation(_: MapInstance[], events: LogEvent[]): Promise<CharacterAggregation> {
    const fb = new FrameBarrier();
    checkContiguous(events);
    const foreignCharacters = determineForeignCharacters(events);
    const characterLevelIndex = new Map<string, ContiguousArray<LevelUpEvent|SetCharacterEvent>>();
    const characterTsIndex = new ContiguousArray<AnyCharacterEvent>();
    const zoneCompletionTsIndex = new Map<string, number>();
    // expands the supplied and prior's character's adjacent character level range by appending a setCharacter event to both
    const handleCharacterSwitch = (ts: number, character: string, ascendancy: string, level: number, eventLoopIndex: number) => {
        // expand the range of the prior character, unless this is the first character
        for (let i = characterTsIndex.length - 1; i >= 0; i--) {
            const prev = characterTsIndex[i];
            const index = characterLevelIndex.get(prev.detail.character);
            if (!index) {
                if (prev.detail.character === character) {
                    throw new Error("illegal state: expected prior event to be of another character " + character);
                }
                // prev is definitely an event of a foreign character
                continue;
            }
            const levelLikePrev = index[index.length - 1];
            if (!levelLikePrev) {
                // not sure how this corner-case is possible, but it is (at least for PoE 1 logs)
                break;
            }
            // backtrack to ANY prior event. if we take ts both character would share an event / map (WRONG!)
            // it is unusual, perhaps even impossible for prevTs to not be found, but just in case:
            // ts - 1 is fair enough and prevents character from including the initial breach event
            const prevTs = binarySearchFindLast(events, (e) => e.ts < ts, 0, eventLoopIndex)?.ts ?? ts - 1;
            if (prevTs < levelLikePrev.ts) {
                throw new Error(`illegal state: prevTs < levelLikePrev.ts for character ${character} at ts ${ts}`);
            }
            if (levelLikePrev.detail.character === character) {
                throw new Error(`illegal state: prevCharacter === character: ${levelLikePrev.detail.character} === ${character} at ts ${ts}`);
            }
            if (prev.ts > prevTs) {
                // prior character event is after supplied threshold ts, should only be possible for a fresh character after it's levelUp(2) event
                // in the case of death or msg events AFTER character creation but BEFORE the levelUp(2) event
                const ix = binarySearchFindLastIx(characterTsIndex, (e) => e.ts < prevTs);
                if (ix === -1) throw new Error(`illegal state: no prior event found for character ${character} at ts ${prevTs}`);

                const prevCharacterEvent = SetCharacterEvent.ofEvent(prevTs, levelLikePrev);
                index.push(prevCharacterEvent);
                // also handle next character with special offset 
                const nextCharacterEvent = SetCharacterEvent.of(ts, character, ascendancy, level);
                characterTsIndex.splice(ix, 0, prevCharacterEvent, nextCharacterEvent);
                // const nextIndex = characterLevelIndex.get(character);
                computeIfAbsent(characterLevelIndex, character, () => new ContiguousArray()).push(nextCharacterEvent);
                /*
                if (!nextIndex) {
                    throw new Error(`illegal state: no next index found for character ${character} at ts ${ts}`);
                }
                const nextCharacterIx = binarySearchFindLastIx(nextIndex, (e) => e.ts < prevTs);
                if (nextCharacterIx === -1) {
                    console.error(nextIndex);
                    throw new Error(`invariant: character index (${character}) has no preceding event at ${prevTs}`);
                }
                nextIndex.splice(nextCharacterIx, 0, nextCharacter);*/
                return;
            } else {
                const prevCharacterEvent = SetCharacterEvent.ofEvent(prevTs, levelLikePrev);
                index.push(prevCharacterEvent);
                characterTsIndex.push(prevCharacterEvent);
            }
            break;
        }
        const nextCharacter = SetCharacterEvent.of(ts, character, ascendancy, level);
        characterTsIndex.push(nextCharacter);
        computeIfAbsent(characterLevelIndex, character, () => new ContiguousArray()).push(nextCharacter);
    };
    const handleCharacterEvent = (event: AnyCharacterEvent, eventLoopIndex: number) => {
        const character = event.detail.character;
        if (event.name == "levelUp" && event.detail.level === 2) {
            // must be in 1st zone (beach / riverbank)
            // note that this will not find the earliest possible beach event (for this character)
            // this is desirable if a player is resetting the 1st area for speedruns or what have you
            let beachEvent: LogEvent | undefined = undefined;
            // cannot use binary search for non-monotonic predicate
            for (let i = eventLoopIndex; i > 0; i--) {
                const e = events[i];
                if (e.name == "mapEntered" && e.ts < event.ts) {
                    beachEvent = e;
                    break;
                }
            }
            let ts;
            if (beachEvent) {
                ts = beachEvent.ts;
            } else {
                // possible if log is incomplete, or very old log format (?)
                if (isFeatureSupportedAt(Feature.ZoneGeneration, event.ts)) {
                    console.warn("log incomplete? failed to find beach event for level 2 character", event.detail.character, event.ts);
                } else {
                    // legacy log format, silently discard for now
                    return;
                }
                ts = event.ts - 1;
            }
            if (characterLevelIndex.has(character)) {
                // FIXME handle character name reuse, maybe with an alias
                console.warn("duplicate characters not supported yet, discarding prior character data", character);
            }
            const index = new ContiguousArray<LevelUpEvent|SetCharacterEvent>();
            characterLevelIndex.set(character, index);
            handleCharacterSwitch(ts, character, event.detail.ascendancy, 1, eventLoopIndex);
            characterTsIndex.push(event);
            index.push(event);
        } else if (characterTsIndex.length > 0 && characterTsIndex[characterTsIndex.length - 1].detail.character === character) {
            // characterTsIndex.checkedSet(characterTsIndex.length - 1, event);
            characterTsIndex.push(event);
            if (event.name == "levelUp") {
                computeIfAbsent(characterLevelIndex, character, () => new ContiguousArray()).push(event);
            }
        } else {
            if (characterTsIndex.length > 1) {
                /*
                    backtrack to find likeliest time when character logged in. it is guaranteed that the character event follows the login event.

                    why is this needed? the only true identifying character events are death and levelUp.
                    thus, when either of those events occured, there is NECESSARILY a prior event which matches a character
                    UNLESS the player switched between characters which are both already in a campaign instance 
                    (does that ever happen? - requires switched to character to still have the server instance up)
                    because normally, when a character switch happens, the switched to character will need to join a town or the hideout first
                    
                    keep in mind that this is still highly inaccurate, especially during endgame where identifying character events may not fire
                    for a long time. and a player may choose to alternate characters often.
                    for example, assume character events [A1, B1]: it is possible that between A1 and B1 character C and D were logged in but
                    never fired a character event.
                */
                const prevCharacterEvent = characterTsIndex[characterTsIndex.length - 1];
                const threshold = prevCharacterEvent.ts;
                let originCandidate: LogEvent | null = null;
                for (let y = eventLoopIndex - 1; y >= 0; y--) {
                    const event = events[y];
                    if (event.ts <= threshold) break;

                    switch (event.name) {
                        // TODO check other events
                        case "hideoutEntered":
                            originCandidate = event;
                            break;
                        case "mapEntered":
                            if (originCandidate) break;

                            originCandidate = event;
                    }
                }
                if (originCandidate) {  
                    const levelIndex = characterLevelIndex.get(character);
                    if (levelIndex) {
                        const lastLevelEvent = levelIndex[levelIndex.length - 1];
                        const ascendancy = lastLevelEvent.detail.ascendancy;
                        const level = lastLevelEvent.detail.level;
                        handleCharacterSwitch(originCandidate.ts, character, ascendancy, level, eventLoopIndex);
                    } else if (event.name === 'levelUp') {
                        // TODO check if this is fully correct?
                        const ascendancy = event.detail.ascendancy;
                        const level = event.detail.level - 1;
                        handleCharacterSwitch(originCandidate.ts, character, ascendancy, level, eventLoopIndex);
                    }
                } else {
                    if (isFeatureSupportedAt(Feature.ZoneGeneration, event.ts)) {
                        throw new Error(`unable to determine origin candidate for character ${character} at ts ${event.ts}`);
                    }
                }
            }
            characterTsIndex.push(event);
            if (event.name == "levelUp") {
                computeIfAbsent(characterLevelIndex, character, () => new ContiguousArray()).push(event);
            }
        }
    }
    for (let i = 0; i < events.length; i++) {
        if (fb.shouldYield()) await fb.yield();

        const event = events[i];
        switch (event.name) {
            case "msgLocal":
            case "msgParty":
            case "msgGuild":
            case "levelUp":
            case "death":
            // it is possible that there's a false positive despite this check;
            // when playing with a guild mate for at least one level, but they always join the area first
            if (foreignCharacters.has(event.detail.character)) continue;
            
            handleCharacterEvent(event, i);
            break;
            case "hideoutEntered":
                const zoneInfo = getZoneInfo(event.detail.areaName);
                if (zoneInfo?.campaignCompletionIndicator) {
                    const characterEvent = characterTsIndex[characterTsIndex.length - 1];
                    if (characterEvent) {
                        computeIfAbsent(zoneCompletionTsIndex, characterEvent.detail.character, () => event.ts);
                    }
                    break;
                }
                break;
        }
    }
    // create tail event for last active character, otherwise, there is a gap at the end
    const lastCharacterEvent = characterTsIndex[characterTsIndex.length - 1];
    if (lastCharacterEvent) {
        const levelIndex = characterLevelIndex.get(lastCharacterEvent.detail.character)!;
        const lastLevelEvent = levelIndex[levelIndex.length - 1];
        const tailCharacterEvent = SetCharacterEvent.ofEvent(events[events.length - 1].ts, lastLevelEvent);
        characterTsIndex.push(tailCharacterEvent);
    }

    foreignCharacters.forEach(character => {
        characterLevelIndex.delete(character);
    });

    const ownedCharacterTsIndex = characterTsIndex;
    const characterLevelSegmentation = new Map<string, Segmentation[]>();
    for (let i = 0; i < ownedCharacterTsIndex.length - 1; i++) {
        const event = ownedCharacterTsIndex[i];
        const character = event.detail.character;
        let level: number | undefined;
        levelPrev: for (let j = i; j >= 0; j--) {
            // also checks current event
            const prevEvent = ownedCharacterTsIndex[j];
            if (prevEvent.detail.character !== character) {
                break;
            }
            switch (prevEvent.name) {
                case "levelUp":
                case "setCharacter":
                    level = prevEvent.detail.level;
                    break levelPrev;
            }
        }
        if (!level) {
            // corner case, incomplete log file
            levelNext: for (let j = i + 1; j < ownedCharacterTsIndex.length; j++) {
                const nextEvent = ownedCharacterTsIndex[j];
                if (nextEvent.detail.character !== character) {
                    break;
                }
                switch (nextEvent.name) {
                    case "levelUp":
                    case "setCharacter":
                        level = nextEvent.detail.level - 1;
                        break levelNext;
                }
            }
        }
        if (!level) {
            // TODO probably just discard this character
            throw new Error(`no levelUp event found for character ${character} at ts ${event.ts}`);
        }
        const levelIndex: Segmentation[] = computeIfAbsent(characterLevelSegmentation, character, () => new Array(100));
        let prevEvent, nextEvent;
        while (i + 1 < ownedCharacterTsIndex.length) {
            const nextNextEvent = ownedCharacterTsIndex[i + 1];
            const nextNextLevel = (nextNextEvent.detail as {level?: number}).level;
            const characterMismatch = nextNextEvent.detail.character !== character;
            const levelMismatch = typeof nextNextLevel === "number" && nextNextLevel !== level;
            if (characterMismatch || levelMismatch || i + 2 === ownedCharacterTsIndex.length) {
                let segmentation = levelIndex[level - 1];
                if (!segmentation) {
                    segmentation = levelIndex[level - 1] = [];
                }
                if (characterMismatch) {
                    if (!nextEvent) {
                        throw new Error(`expected boundary setCharacter events for character ${character} at level ${level} at ts ${event.ts}`);
                    }
                    const lo = event.ts;
                    const hi = nextEvent.ts;
                    segmentation.push({lo, hi});
                } else {
                    // create an adjacent segmentation for inter-character events
                    const lo = prevEvent?.ts ?? event.ts;
                    const hi = nextNextEvent.ts;
                    segmentation.push({lo, hi});
                }
                break;
            } else {
                i++;
                nextEvent = nextNextEvent;
                prevEvent = event;
            }
        }
    }
    {
        for (const character of characterLevelSegmentation.keys()) {
            const s = characterLevelSegmentation.get(character)!;
            for (let i = 0; i < s.length - 1; i++) {
                if (s[i] === undefined) {
                    let firstEmptySlot = i;
                    while (++i < s.length) {
                        if (s[i] !== undefined) {
                            console.error(`invariant, segmentation has gaps for levels: ${character} ${firstEmptySlot + 1} .. ${i}`, s);
                            break;
                        }
                    }
                }
            }
        }
        for (const event of characterTsIndex) {
            if (event.name === "levelUp" && !foreignCharacters.has(event.detail.character)) {
                const levelIndex = characterLevelSegmentation.get(event.detail.character);
                const s = levelIndex![event.detail.level - 1];
                if (!s) {
                    console.error(`invariant, level index is missing for character ${event.detail.character} at level ${event.detail.level}`, event, levelIndex);
                }
                let found = false;
                for (const range of s) {
                    if (range.lo <= event.ts && range.hi >= event.ts) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    console.error(`invariant, level index did not populate levelUp event for character ${event.detail.character} at level ${event.detail.level}`, event);
                }
            }
        }
    }
    const characters: CharacterInfo[] = [];
    for (const charName of characterLevelIndex.keys()) {
        const levelIndex = characterLevelIndex.get(charName)!;
        if (levelIndex.length === 0) continue;
    
        const lastLevelEvent = levelIndex[levelIndex.length - 1];
        const level = lastLevelEvent.detail.level;
        const ascendancy = lastLevelEvent.detail.ascendancy;
        const campaignCompletedTs = zoneCompletionTsIndex.get(charName) ?? -1;
        const lastPlayedTs = characterTsIndex.findLast(e => e.detail.character === charName)!.ts;
        characters.push({
            name: charName,
            level,
            ascendancy,
            createdTs: levelIndex[0].ts,
            campaignCompletedTs,
            lastPlayedTs,
        });
    }
    const sortedCharacters = characters.sort((a, b) => a.lastPlayedTs - b.lastPlayedTs);
    return new CharacterAggregation(characterLevelIndex, ownedCharacterTsIndex, characterLevelSegmentation, sortedCharacters);
}

/**
 * @events must be sorted by ts, ascending
 * @returns all characters contained in events that are not owned by the owner of the log
 */
export function determineForeignCharacters(events: LogEvent[]): Set<string> {
    const legacyCharacters = new Set<string>();
    const maybeOwnedCharacters = new Set<string>();
    const maybeForeignCharacters = new Set<string>();
    const foreignCharacters = new Set<string>();
    // use this double-pass approach for now, because unapplying foreign characters gets really complicated
    for (let i = 0; i < events.length; i++) {
        const e = events[i];
        switch (e.name) {
            case "levelUp":
                const character = e.detail.character;
                if (isFeatureSupportedAt(Feature.ZoneGeneration, e.ts)) {
                    if (!maybeOwnedCharacters.has(character) && !foreignCharacters.has(character)) {
                        const level = e.detail.level;
                        if (level <= 2) {
                            maybeOwnedCharacters.add(character);
                        } else {
                            let currentLevel = level;
                            for (let y = i; y < events.length; y++) {
                                const nextEvent = events[y];
                                if (nextEvent.detail.character === character) {
                                    if (nextEvent.name === "levelUp") {
                                        if (nextEvent.detail.level !== currentLevel + 1) {
                                            // found non-contiguous levelUp event, it is likely that this character is foreign. 
                                            // note that this is already uncommon, because it requires the foreign character to never trigger a joinedArea event
                                            foreignCharacters.add(character);
                                            break;
                                        } else if (currentLevel - level >= 2) {
                                            // found two subsequent levelUp events, it is likely that this character is owned and the log is incomplete (i.e. missing the creation of the character)
                                            maybeOwnedCharacters.add(character);
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                } else {
                    legacyCharacters.add(character);
                }
                break;
            case "msgLocal":
            case "msgParty":
            case "msgGuild":
            case "death":
                maybeForeignCharacters.add(e.detail.character);
                break;
            case "joinedArea":
                // joinedArea is never fired for the player's own character from the perspective of the player's log
                foreignCharacters.add(e.detail.character);
                break;
        }
    }
    for (const character of maybeForeignCharacters) {
        if (!maybeOwnedCharacters.has(character)) {
            // super common scenario, e.g. whispers from other players that never fire a joinedArea event
            // could make this check more loose (e.g. require level2 levelUp event and / or contiguous & complete levelUp events)
            // to mark incomplete (possibly owned) characters as foreign
            foreignCharacters.add(character);
        }
    }
    for (const character of legacyCharacters) {
        foreignCharacters.add(character);
        if (maybeOwnedCharacters.has(character)) {
            console.warn(`marking character ${character} as foreign because it was created before zone generation was introduced`);
        }
    }
    return foreignCharacters;
}