import type { EnergyType } from "./energy";

export type Condition = "asleep" | "confused" | "paralyzed";

export type EffectTarget =
  | "defending"
  | "self"
  | "selfBenchChoice"
  | "anySelfChoice"
  | "opponentBenchChoice"
  | "anyOpponentChoice"
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
  | { kind: "damagePlus"; amount: number; scope: ModifierScope; requiresHolderType?: EnergyType }
  | { kind: "damageMinus"; amount: number; scope: ModifierScope; requiresHolderType?: EnergyType }
  | { kind: "preventConditions"; scope: ModifierScope }
  | { kind: "retreatDelta"; amount: number; scope: ModifierScope }
  | { kind: "hpPlus"; amount: number; scope: ModifierScope }
  | { kind: "blockOpponentStadium"; scope: ModifierScope }
  | { kind: "burnDamage"; amount: number; scope: ModifierScope; sourceRequiresActive?: boolean };

export interface CardFilter {
  supertype?: "Pokemon" | "Trainer" | "Energy";
  stage?: "Basic" | "Stage1" | "Stage2";
  excludeEx?: boolean;
  basicEnergy?: boolean;
  nameContains?: string;
  maxHp?: number;
  deltaOnly?: boolean;
  notTrainer?: boolean;
}

export type Effect =
  | { op: "damage"; amount: number; target: EffectTarget; applyWR?: boolean; ignoreResistance?: boolean; ignoreDefenderEffects?: boolean }
  | { op: "damageScaled"; base: number; amount: number; per: ScalePer; energyType?: EnergyType }
  | { op: "recoil"; amount: number }
  | { op: "protectNextTurn"; mode: "preventAll" | "reduce"; amount?: number }
  | { op: "lockDefending"; what: "attack" | "retreat" }
  | { op: "discardOpponentEnergy"; count: number; target?: "active" | "any" }
  | { op: "shuffleHandDraw"; who: "self" | "opponent" | "both"; count: number | "opponentHand" | "ownPrizes" }
  | { op: "scoopUp" }
  | { op: "warpPoint" }
  | { op: "moveEnergy"; count: number; energyType?: EnergyType; basicOnly?: boolean }
  | { op: "moveDamageCounters"; count: number }
  | { op: "devolveDefending" }
  | { op: "damageCounters"; count: number; target: EffectTarget }
  | { op: "heal"; amount: number; target: EffectTarget }
  | { op: "draw"; count: number }
  | { op: "drawPerOpponentPokemon" }
  | { op: "discardFromHand"; count: number; energyType?: EnergyType }
  | { op: "discardSelfEnergy"; count: number | "all"; energyType?: EnergyType }
  | { op: "applyCondition"; condition: Condition; target: "defending" }
  | { op: "applyPoison"; target: "defending"; counters?: number }
  | { op: "applyBurn"; target: "defending" }
  | { op: "flip"; heads: Effect[]; tails: Effect[] }
  | { op: "damagePerHeads"; flips: number; amount: number; target: EffectTarget; recoilIfNoHeads?: number }
  | { op: "searchDeck"; filter: CardFilter; count: number }
  | { op: "switchSelf"; optional?: boolean }
  | { op: "gustOpponent" }
  | { op: "attachEnergyFromDiscard"; energyType: EnergyType; target: "selfBenchChoice" | "anySelfChoice" }
  | { op: "attachEnergyFromHand"; energyType?: EnergyType; target: "anySelfChoice" | "self" }
  | { op: "attachEnergyFromDeck"; energyType: EnergyType; basicOnly?: boolean; targetType?: EnergyType }
  | { op: "rareCandy" }
  | { op: "nextAttackBonus"; amount: number; attackName?: string }
  | { op: "damageIfStatus"; bonus: number; status: "burned" | "poisoned" | Condition }
  | { op: "damageIfDefenderNoEnergy"; bonus: number }
  | { op: "damageIfDefenderSpecialEnergy"; bonus: number }
  | { op: "damageIfDefenderResistance"; resistanceType: EnergyType; bonus: number }
  | { op: "damagePerFlipsPerEnergy"; base: number; amount: number; energyType?: EnergyType }
  | { op: "discardEnergyForDamage"; damagePerEnergy: number; energyType?: EnergyType }
  | { op: "discardOpponentHand"; count: number }
  | { op: "drawToHandSize"; size: number }
  | { op: "peekTopDeck"; count: number; filter?: CardFilter }
  | { op: "energyRestoreFlips"; flips: number };
