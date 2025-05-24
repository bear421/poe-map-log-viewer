class ZoneInfo {
    label: string;
    act: number;
    areaLevel: number;
    bosses: string[];

    constructor(label: string, act: number, areaLevel: number, bosses: string[]) {
        this.label = label;
        this.act = act;
        this.areaLevel = areaLevel;
        this.bosses = bosses;
    }

    get url(): string {
        return `https://poe2db.tw/us/${this.label.replace(/ /g, "_")}`;
    }
}

const ZI = (label: string, act: number, areaLevel: number, bosses: string[]) => new ZoneInfo(label, act, areaLevel, bosses);

const ZONE_TABLE: Record<string, ZoneInfo> = {
    /* Act 1 */
    "G1_1":     ZI("The Riverbank", 1, 1, ["The Bloated Miller"]),
    "G1_town":  ZI("Clearfell Encampment", 1, 15, []),
    "G1_2":     ZI("Clearfell", 1, 2, ["Beira of the Rotten Pack"]),
    "G1_3":     ZI("Mud Burrow", 1, 3, ["The Devourer"]),
    "G1_4":     ZI("The Grelwood", 1, 4, ["The Brambleghast", "Werewolf Prowler"]),
    "G1_5":     ZI("The Red Vale", 1, 5, ["The Rust King"]),
    "G1_6":     ZI("The Grim Tangle", 1, 6, ["The Rotten Druid", "Fungal Proliferator", "Fungal Artillery"]),
    "G1_7":     ZI("Cemetery of the Eternals", 1, 7, ["Lachlann of Endless Lament", "Burdened Wretch", "Undertaker"]),
    "G1_8":     ZI("Mausoleum of the Praetor", 1, 8, ["Draven, the Eternal Praetor", "Lightning Wraith", "Eternal Knight", "Courtesan", "Ghoul Commander"]),
    "G1_9":     ZI("Tomb of the Consort", 1, 8, ["Asinia, the Praetor's Consort", "Eternal Knight", "Dread Servant"]),
    "G1_10":    ZI("Root Hollow", 1, 15, ["The Rotten Druid"]),
    "G1_11":    ZI("Hunting Grounds", 1, 10, ["The Crowbell", "Venomous Crab Matriarch", "Venomous Crab Matriarch", "Bramble Hulk"]),
    "G1_12":    ZI("Freythorn", 1, 11, ["Skeleton Spriggan", "Cultist Witch", "Cultist Archer", "Ribrattle"]),
    "G1_13_1":  ZI("Ogham Farmlands", 1, 12, []),
    "G1_13_2":  ZI("Ogham Village", 1, 13, ["The Executioner"]),
    "G1_14":    ZI("The Manor Ramparts", 1, 14, []),
    "G1_15":    ZI("Ogham Manor", 1, 15, ["Count Geonor", "Candlemass, the Living Rite"]),
    /* Act 2 */
    "G2_1":     ZI("Vastiri Outskirts", 2, 16, ["Rathbreaker", "Rotting Hulk"]),
    "G2_town":  ZI("The Ardura Caravan", 2, 32, []),
    "G2_10_1":     ZI("Mawdun Quarry", 2, 17, ["Plague Harvester"]),
    "G2_10_2":     ZI("Mawdun Mine", 2, 18, ["The Deep-Dweller"]),
    "G2_2":     ZI("Traitor's Passage", 2, 19, ["Balbala, the Traitor", "Quake Golem"]),
    "G2_3":     ZI("The Halani Gates", 2, 20, ["Jamanra, the Risen King"]),
    "G2_3a":     ZI("The Halani Gates", 2, 20, []),
    "G2_4_1":   ZI("Keth", 2, 21, ["Kabala, Constrictor Queen", "Serpent Shaman", "Desiccated Lich"]),
    "G2_13":     ZI("Trial of the Sekhemas", 2, 22, []),
    "G2_4_2":     ZI("The Lost City", 2, 22, ["Risen Arbalest", "Risen Magi", "Adorned Scarab"]),
    "G2_4_3":   ZI("Buried Shrines", 2, 23, ["Azarian, the Forsaken Son", "Mar Acolyte", "Risen Arbalest"]),
    "G2_5_1":   ZI("Mastodon Badlands", 2, 21, ["Armsmaster Jadzek"]),
    "G2_5_2":   ZI("The Bone Pits", 2, 22, ["Iktab, the Deathlord", "Ekbab, Ancient Steed"]),
    "G2_6":   ZI("Valley of the Titans", 2, 21, ["Desiccated Lich", "Quake Golem"]),
    "G2_7":     ZI("The Titan Grotto", 2, 22, ["Zalmarath, the Colossus"]),
    "G2_8":     ZI("Deshar", 2, 28, ["Rasp Scavenger"]),
    "G2_9_1":   ZI("Path of Mourning", 2, 29, []),
    "G2_9_2":   ZI("The Spires of Deshar", 2, 30, ["Tor Gul, the Defiler"]),
    "G2_12_1":  ZI("The Dreadnought", 2, 31, []),
    "G2_12_2":  ZI("Dreadnought Vanguard", 2, 32, ["Jamanra, The Abomination"]),
    /* Act 3 */
    "G3_1":     ZI("Sandswept Marsh", 3, 33, ["Rootdredge", "Dredge Fiend", "Bloodthief Queen", "Orok Shaman"]),
    "G3_town":  ZI("Ziggurat Encampment", 3, 44, []),
    "G3_2_1":     ZI("Infested Barrens", 3, 35, []),
    "G3_2_2":    ZI("The Matlan Waterways", 3, 39, ["Azak Shaman", "Azak Brute"]),
    "G3_3":     ZI("Jungle Ruins", 3, 34, ["Mighty Silverfist", "Alpha Primate"]),
    "G3_4":     ZI("The Venom Crypts", 3, 35, []),
    "G3_5":     ZI("Chimeral Wetlands", 3, 36, ["Xyclucian, the Chimera"]),
    "G3_10": ZI("The Trial of Chaos", 3, 38, []),
    "G3_10_Airlock": ZI("The Temple of Chaos", 3, 38, []),
    "G3_6_1":     ZI("Jiquani's Machinarium", 3, 37, ["Blackjaw, the Remnant"]),
    "G3_6_2":     ZI("Jiquani's Sanctum", 3, 38, ["Zicoatl, Warden of the Core"]),
    "G3_7":     ZI("The Azak Bog", 3, 36, ["Ignagduk, the Bog Witch", "Azak Brute", "Azak Shaman", "Azak Mauler", "Azak Torchbearer", "Azak Stalker"]),
    "G3_8":     ZI("The Drowned City", 3, 40, ["Filthy First-born", "River Hag"]),
    "G3_9":    ZI("The Molten Vault", 3, 41, ["Mektul, the Forgemaster"]),
    "G3_11":    ZI("Apex of Filth", 3, 42, ["Queen of Filth"]),
    "G3_12":    ZI("Temple of Kopec", 3, 43, ["Ketzuli, High Priest of the Sun"]),
    "G3_14":    ZI("Utzaal", 3, 44, ["Viper Napuatzi"]),
    "G3_16":    ZI("Aggorat", 3, 44, []),
    "G3_17":    ZI("The Black Chambers", 3, 45, ["Doryani, Royal Thaumaturge"]),
     /* Act 4 (Act 1 Cruel) */
     "C_G1_1":     ZI("The Riverbank", 4, 45, ["The Bloated Miller"]),
     "C_G1_town":  ZI("Clearfell Encampment", 7, 51, []),
     "C_G1_2":     ZI("Clearfell", 4, 45, ["Beira of the Rotten Pack", "Vile Hag"]),
     "C_G1_3":     ZI("Mud Burrow", 4, 46, ["The Devourer"]),
     "C_G1_4":     ZI("The Grelwood", 4, 46, ["The Brambleghast", "Fungal Artillery", "Fungal Proliferator", "Cultivated Grove"]),
     "C_G1_5":     ZI("The Red Vale", 4, 47, ["The Rust King", "Risen Arbalest"]),
     "C_G1_6":     ZI("The Grim Tangle", 4, 47, ["The Rotten Druid", "Fungal Proliferator", "Fungal Artillery"]),
     "C_G1_7":     ZI("Cemetery of the Eternals", 4, 47, ["Lachlann of Endless Lament", "Burdened Wretch", "Undertaker"]),
     "C_G1_8":     ZI("Mausoleum of the Praetor", 4, 48, ["Draven, the Eternal Praetor", "Lightning Wraith", "Eternal Knight", "Courtesan", "Ghoul Commander"]),
     "C_G1_9":     ZI("Tomb of the Consort", 4, 48, ["Asinia, the Praetor's Consort", "Eternal Knight", "Dread Servant"]),
     "C_G1_10":    ZI("Root Hollow", 4, 51, ["The Rotten Druid"]),
     "C_G1_11":    ZI("Hunting Grounds", 4, 49, ["The Crowbell", "Venomous Crab Matriarch", "Venomous Crab Matriarch", "Bramble Hulk"]),
     "C_G1_12":    ZI("Freythorn", 4, 49, ["Skeleton Spriggan", "Cultist Witch", "Cultist Archer", "Ribrattle"]),
     "C_G1_13_1":  ZI("Ogham Farmlands", 4, 49, ["Werewolf Prowler", "Scarecrow Beast"]),
     "C_G1_13_2":  ZI("Ogham Village", 4, 50, ["The Executioner", "Blood Collector", "Decrepit Mercenary"]),
     "C_G1_14":    ZI("The Manor Ramparts", 4, 50, ["Decrepit Mercenary", "Death Knight", "Courtesan", "Iron Thaumaturgist", "Iron Spearman", "Iron Guard"]),
     "C_G1_15":    ZI("Ogham Manor", 4, 51, ["Candlemass, the Living Rite", "Count Geonor", "Courtesan", "Iron Thaumaturgist"]),
    /* Act 5 (Act 2 Cruel) */
    "C_G2_1":     ZI("Vastiri Outskirts", 5, 51, ["Rathbreaker", "Rotting Hulk"]),
    "C_G2_town":  ZI("The Ardura Caravan", 5, 57, []),
    "C_G2_2":     ZI("Traitor's Passage", 5, 52, ["Balbala, the Traitor", "Quake Golem"]),
    "C_G2_3":     ZI("The Halani Gates", 5, 53, ["Jamanra, the Risen King"]),
    "C_G2_3a":    ZI("The Halani Gates", 5, 53, []),
    "C_G2_4_1":   ZI("Keth", 5, 53, ["Kabala, Constrictor Queen", "Serpent Shaman", "Desiccated Lich"]),
    "C_G2_4_2":   ZI("The Lost City", 5, 54, ["Risen Arbalest", "Risen Magi", "Adorned Scarab"]),
    "C_G2_4_3":   ZI("Buried Shrines", 5, 54, ["Azarian, the Forsaken Son", "Mar Acolyte", "Risen Arbalest"]),
    "C_G2_5_1":   ZI("Mastodon Badlands", 5, 53, ["Lost-men Zealot", "Lost-men Necromancer"]),
    "C_G2_5_2":   ZI("The Bone Pits", 5, 54, ["Ekbab, Ancient Steed", "Lost-men Zealot", "Lost-men Necromancer", "Sun Clan Scavenger", "Drudge Osseodon"]),
    "C_G2_6":     ZI("Valley of the Titans", 5, 53, ["Desiccated Lich", "Quake Golem"]),
    "C_G2_7":     ZI("The Titan Grotto", 5, 54, ["Zalmarath, the Colossus"]),
    "C_G2_8":     ZI("Deshar", 5, 56, ["Rasp Scavenger"]),
    "C_G2_9_1":   ZI("Path of Mourning", 5, 56, ["Risen Tale-woman"]),
    "C_G2_9_2_":   ZI("The Spires of Deshar", 5, 57, ["Tor Gul, the Defiler", "Faridun Impaler"]),
    "C_G2_10_1":  ZI("Mawdun Quarry", 5, 51, ["Plague Harvester"]),
    "C_G2_10_2":  ZI("Mawdun Mine", 5, 52, ["Rudja, the Dread Engineer"]),
    "C_G2_12_1":  ZI("The Dreadnought", 5, 57, ["Faridun Plaguebringer"]),
    "C_G2_12_2":  ZI("Dreadnought Vanguard", 5, 57, ["Jamanra, the Abomination"]),
    /* Act 6 (Act 3 Cruel) */
    "C_G3_1":     ZI("Sandswept Marsh", 6, 58, ["Rootdredge", "Dredge Fiend", "Bloodthief Queen", "Orok Shaman"]),
    "C_G3_town":  ZI("Ziggurat Encampment", 6, 64, []),
    "C_G3_2_1":     ZI("Infested Barrens", 6, 59, []),
    "C_G3_2_2":    ZI("The Matlan Waterways", 6, 60, ["Azak Shaman", "Azak Brute"]),
    "C_G3_3":     ZI("Jungle Ruins", 6, 58, ["Mighty Silverfist", "Alpha Primate"]),
    "C_G3_4":     ZI("The Venom Crypts", 6, 59, []),
    "C_G3_5":     ZI("Chimeral Wetlands", 6, 59, ["Xyclucian, the Chimera"]),
    "C_G3_10_Airlock": ZI("The Temple of Chaos", 6, 60, []),
    "C_G3_6_1":     ZI("Jiquani's Machinarium", 6, 60, ["Blackjaw, the Remnant", "Vaal Skeletal Priest", "Vaal Skeletal Archer"]),
    "C_G3_6_2":     ZI("Jiquani's Sanctum", 6, 60, ["Zicoatl, Warden of the Core", "Vaal Skeletal Archer", "Vaal Skeletal Priest", "Undead Vaal Guard"]),
    "C_G3_7":     ZI("The Azak Bog", 6, 59, ["Ignagduk, the Bog Witch", "Azak Brute", "Azak Shaman", "Azak Mauler", "Azak Torchbearer", "Azak Stalker"]),
    "C_G3_8":     ZI("The Drowned City", 6, 61, ["Filthy First-born", "River Hag"]),
    "C_G3_9":    ZI("The Molten Vault", 6, 61, ["Mektul, the Forgemaster"]),
    "C_G3_11":    ZI("Apex of Filth", 6, 62, ["Queen of Filth"]),
    "C_G3_12":    ZI("Temple of Kopec", 6, 62, ["Ketzuli, High Priest of the Sun", "Bloodrite Priest"]),
    "C_G3_14":    ZI("Utzaal", 6, 62, ["Viper Napuatzi", "Loyal Jaguar", "Vaal Overseer", "Vaal Goliath"]),
    "C_G3_16_":    ZI("Aggorat", 6, 63, ["Vaal Goliath", "Bannerbearing Zealot", "Vaal Formshifter", "Blood Priest", "Blood Priestess"]),
    "C_G3_17":    ZI("The Black Chambers", 6, 64, ["Doryani, Royal Thaumaturge", "Doryani's Triumph", "Brutal Transcendent", "Surgical Experimentalist", "Goliath Transcendent", "Shielded Transcendent"]),
    /* Endgame */
    "G_Endgame_Town": ZI("The Ziggurat Refuge", 10, 65, []),
}

const SANCTUM_A2 = ZI("Trial of the Sekhemas (A2)", 2, 22, []);
const SANCTUM_A4 = ZI("Trial of the Sekhemas (A3)", 3, 40, []);

export function getZoneInfo(areaName: string, areaLevel?: number): ZoneInfo | undefined {
    const zi = ZONE_TABLE[areaName];
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

