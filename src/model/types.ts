export type EnergyType =
  | "Grass"
  | "Fire"
  | "Water"
  | "Lightning"
  | "Psychic"
  | "Fighting"
  | "Darkness"
  | "Metal"
  | "Colorless";

export type Supertype = "Pokemon" | "Trainer" | "Energy";
export type Stage = "Basic" | "Stage1" | "Stage2";
export type TrainerKind = "Item" | "Supporter" | "Stadium" | "Tool";
export type Condition = "asleep" | "confused" | "paralyzed";

export type EffectTarget =
  | "defending"
  | "self"
  | "selfBenchChoice"
  | "anySelfChoice"
  | "opponentBenchChoice"
  | "eachOpponentBench";

export interface CardFilter {
  supertype?: Supertype;
  stage?: Stage;
  excludeEx?: boolean;
  basicEnergy?: boolean;
  nameContains?: string;
  maxHp?: number;
  deltaOnly?: boolean;
}

export type ModifierScope = "self" | "yourPokemon" | "allPokemon";

export type Modifier =
  | { kind: "damagePlus"; amount: number; scope: ModifierScope }
  | { kind: "damageMinus"; amount: number; scope: ModifierScope }
  | { kind: "preventConditions"; scope: ModifierScope }
  | { kind: "retreatDelta"; amount: number; scope: ModifierScope }
  | { kind: "hpPlus"; amount: number; scope: ModifierScope };

export type ScalePer =
  | "attackerEnergy"
  | "defenderEnergy"
  | "defenderDamageCounters"
  | "selfDamageCounters"
  | "yourBench"
  | "oppBench";

export type Effect =
  | { op: "damage"; amount: number; target: EffectTarget; applyWR?: boolean }
  | { op: "damageScaled"; base: number; amount: number; per: ScalePer }
  | { op: "recoil"; amount: number }
  | { op: "protectNextTurn"; mode: "preventAll" | "reduce"; amount?: number }
  | { op: "lockDefending"; what: "attack" | "retreat" }
  | { op: "discardOpponentEnergy"; count: number }
  | { op: "shuffleHandDraw"; who: "self" | "opponent" | "both"; count: number | "opponentHand" | "ownPrizes" }
  | { op: "scoopUp" }
  | { op: "warpPoint" }
  | { op: "moveEnergy"; count: number; energyType?: EnergyType }
  | { op: "moveDamageCounters"; count: number }
  | { op: "devolveDefending" }
  | { op: "damageCounters"; count: number; target: EffectTarget }
  | { op: "heal"; amount: number; target: EffectTarget }
  | { op: "draw"; count: number }
  | { op: "drawPerOpponentPokemon" }
  | { op: "discardFromHand"; count: number }
  | { op: "discardSelfEnergy"; count: number; energyType?: EnergyType }
  | { op: "applyCondition"; condition: Condition; target: "defending" }
  | { op: "applyPoison"; target: "defending"; counters?: number }
  | { op: "applyBurn"; target: "defending" }
  | { op: "flip"; heads: Effect[]; tails: Effect[] }
  | { op: "damagePerHeads"; flips: number; amount: number; target: EffectTarget }
  | { op: "searchDeck"; filter: CardFilter; count: number }
  | { op: "switchSelf" }
  | { op: "gustOpponent" }
  | { op: "attachEnergyFromDiscard"; energyType: EnergyType; target: "selfBenchChoice" | "anySelfChoice" }
  | { op: "attachEnergyFromHand"; energyType: EnergyType; target: "anySelfChoice" }
  | { op: "rareCandy" }
  | { op: "nextAttackBonus"; amount: number }
  | { op: "damageIfStatus"; bonus: number; status: "burned" | "poisoned" | Condition }
  | { op: "damageIfDefenderNoEnergy"; bonus: number }
  | { op: "damageIfDefenderSpecialEnergy"; bonus: number }
  | { op: "damageIfDefenderResistance"; resistanceType: EnergyType; bonus: number }
  | { op: "damagePerFlipsPerEnergy"; base: number; amount: number; energyType?: EnergyType }
  | { op: "discardEnergyForDamage"; damagePerEnergy: number; energyType?: EnergyType }
  | { op: "discardOpponentHand"; count: number };

export interface AttackDef {
  name: string;
  cost: EnergyType[];
  damage?: number;
  text?: string;
  effects?: Effect[];
}

export interface PowerDef {
  kind: "Poke-Power" | "Poke-Body";
  name: string;
  text: string;
  usable?: boolean;
  oncePerTurn?: boolean;
  trigger?: "onPlayFromHand";
  effects?: Effect[];
  modifiers?: Modifier[];
}

export interface TrainerRestriction {
  maxHandSize?: number;
  behindOnPrizes?: boolean;
}

export interface PokemonCardDef {
  id: string;
  name: string;
  image?: string;
  supertype: "Pokemon";
  stage: Stage;
  evolvesFrom?: string;
  hp: number;
  types: EnergyType[];
  isEx?: boolean;
  isDelta?: boolean;
  playableAsEnergy?: boolean;
  weakness?: EnergyType;
  resistance?: EnergyType;
  retreatCost: number;
  attacks: AttackDef[];
  power?: PowerDef;
}

export interface TrainerCardDef {
  id: string;
  name: string;
  image?: string;
  supertype: "Trainer";
  kind: TrainerKind;
  text: string;
  effects: Effect[];
  modifiers?: Modifier[];
  restriction?: TrainerRestriction;
}

export interface EnergyCardDef {
  id: string;
  name: string;
  image?: string;
  supertype: "Energy";
  provides: EnergyType[];
  isBasic: boolean;
  provideCount?: number;
  damageRider?: number;
  scramble?: boolean;
  deltaOnly?: boolean;
  modifiers?: Modifier[];
}

export type CardDef = PokemonCardDef | TrainerCardDef | EnergyCardDef;

export function isPokemon(def: CardDef): def is PokemonCardDef {
  return def.supertype === "Pokemon";
}

export function isTrainer(def: CardDef): def is TrainerCardDef {
  return def.supertype === "Trainer";
}

export function isEnergy(def: CardDef): def is EnergyCardDef {
  return def.supertype === "Energy";
}

export interface CardInstance {
  uid: number;
  def: CardDef;
}

export type CardLibrary = Record<string, CardDef>;
