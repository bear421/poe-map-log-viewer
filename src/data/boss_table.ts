export const BOSS_TABLE: Record<string, { deathCries: Set<string>, alias?: string }> = {
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
    "Sirus, Awakener of Worlds": {
        "deathCries": new Set([" At least I felt something..."])
    }
};