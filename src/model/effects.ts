import type { EnergyType } from "./energy";

export type Condition = "asleep" | "confused" | "paralyzed";

export type EffectTarget =
  | "defending"
  | "self"
  | "selfBenchChoice"
  | "anySelfChoice"
  | "opponentBenchChoice"
  | "eachOpponentBench";

export type ModifierScope = "self" | "yourPokemon" | "allPokemon";

export type ScalePer =
  | "attackerEnergy"
  | "defenderEnergy"
  | "defenderDamageCounters"
  | "selfDamageCounters"
  | "yourBench"
  | "oppBench";

export type Modifier =
  | { kind: "damagePlus"; amount: number; scope: ModifierScope }
  | { kind: "damageMinus"; amount: number; scope: ModifierScope }
  | { kind: "preventConditions"; scope: ModifierScope }
  | { kind: "retreatDelta"; amount: number; scope: ModifierScope }
  | { kind: "hpPlus"; amount: number; scope: ModifierScope };

export interface CardFilter {
  supertype?: "Pokemon" | "Trainer" | "Energy";
  stage?: "Basic" | "Stage1" | "Stage2";
  excludeEx?: boolean;
  basicEnergy?: boolean;
  nameContains?: string;
  maxHp?: number;
  deltaOnly?: boolean;
}

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
