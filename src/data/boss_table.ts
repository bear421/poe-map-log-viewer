export const BOSS_TABLE: Record<string, { deathCries: Set<string>, alias?: string, greetings?: Set<string> }> = {
    "Clearfell Guard": {
        "deathCries": new Set([" Well done! Please come inside."]),
        "alias": "The Bloated Miller"
    },
    "The King in the Mists": {
        "deathCries": new Set([" So long as you know me, I will always exist...", " This is not the end...", " Why do you hate us for wanting to exist?"])
    },
    "Geonor, the Putrid Wolf": {
        "deathCries": new Set([" Yes... Find her. Kill her. But first, please stop the madness."])
    },
    "Jamanra, the Abomination": {
        "deathCries": new Set([" You have accomplished... Nothing. Oriana will prevail... And the Faridun will rule the Vastiri."])
    },
    "Doryani": {
        "deathCries": new Set([" Ugh... how could this happen...? All I have done. All that I sacrificed...", " Ugh... how could this happen... all I have done. All that I sacrificed..."])
    },
    "The Trialmaster": {
        "deathCries": new Set([" Ugh... my service is finally over..."])
    },
    "Zarokh, the Temporal": {
        "deathCries": new Set([" The sands shift, Taljari...", " My sand... runs out..."])
    },
    "Xesht, We That Are One": {
        "deathCries": new Set([" Ugh...! We That Failed..."])
    },
    "The Arbiter of Ash": {
        "deathCries": new Set([" The Mothersoul... Must prevail..."])
    },
    "Strange Voice": {
        "deathCries": new Set([" So be it. Keep your precious sanity, my agent of chaos. You shall serve me, whether you like it or not. I'm not going anywhere..."])
    },
    "The Eater of Worlds": {
        "greetings": new Set([" This is not a battle you can win, hatchling."]),
        "deathCries": new Set([" You deny us... escape from pain..."])
    },
    "The Searing Exarch": {
        "deathCries": new Set([" Improbable...!"])
    },
    "Zana, Master Cartographer": {
        "deathCries": new Set([" To me, exile! Quickly!"]),
        "alias": "The Elder"
    },
    "The Shaper": {
        "deathCries": new Set([" Irrelevant!"])
    },
    // uber elder is unsupported - no indicator of success
    "Venarius": {
        "deathCries": new Set([" This isn't over. This will never be over! I will unify humanity!"])
    },
    "Sirus, Awakener of Worlds": {
        "deathCries": new Set([" At least I felt something..."])
    },
    "The Maven": {
        "deathCries": new Set([" I am being hurt!"])
    },
    "Incarnation of Neglect": {
        "deathCries": new Set([" Madness... consumes..."])
    },
    "Incarnation of Fear": {
        "deathCries": new Set([" Forgive me... I was not myself..."])
    },
    "Incarnation of Dread": {
        "deathCries": new Set([" Her dread... shall not be erased so easily..."])
    },
    "Nightmare of Uhtred": {
        "deathCries": new Set([" Death is... no escape..."])
    },
    "Nightmare of Lycia": {
        "deathCries": new Set([" You are only delaying the inevitable."])
    },
};