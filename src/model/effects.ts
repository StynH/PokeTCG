import type { EnergyType } from "./energy";

export type Condition = "asleep" | "confused" | "paralyzed";

export type EffectTarget =
  | "defending"
  | "self"
  | "selfBenchChoice"
  | "anySelfChoice"
  | "anySelfChoiceExceptSelf"
  | "opponentBenchChoice"
  | "anyOpponentChoice"
  | "eachOpponentBench";

export type ModifierScope = "self" | "yourPokemon" | "opponentPokemon" | "allPokemon";

export type ScalePer =
  | "attackerEnergy"
  | "defenderEnergy"
  | "defenderDamageCounters"
  | "selfDamageCounters"
  | "yourBench"
  | "oppBench"
  | "selfDistinctBasicEnergyTypes";

export type Modifier =
  | { kind: "damagePlus"; amount: number; scope: ModifierScope; requiresHolderType?: EnergyType; requiresNamedInPlay?: string[] }
  | { kind: "damageMinus"; amount: number; scope: ModifierScope; requiresHolderType?: EnergyType; requiresEnergyType?: EnergyType; attackerBasicOnly?: boolean; sourceRequiresActive?: boolean; targetRequiresType?: EnergyType; targetBenchedOnly?: boolean; requiresAttackerEx?: boolean; requiresAttackerEvolved?: boolean; requiresAttackerSpecialEnergy?: boolean; requiresHolderAsleep?: boolean }
  | { kind: "noWeakness"; scope: ModifierScope; requiresEnergyType?: EnergyType }
  | { kind: "preventConditions"; scope: ModifierScope }
  | { kind: "retreatDelta"; amount: number; scope: ModifierScope; requiresEnergyType?: EnergyType; sourceRequiresActive?: boolean; targetRequiresType?: EnergyType; requiresStadium?: boolean; targetNameOneOf?: string[] }
  | { kind: "surviveKO"; scope: ModifierScope; energyCost: number; remainingHp: number }
  | { kind: "hpPlus"; amount: number; scope: ModifierScope }
  | { kind: "blockOpponentStadium"; scope: ModifierScope }
  | { kind: "blockOpponentSupporter"; scope: ModifierScope }
  | { kind: "burnDamage"; amount: number; scope: ModifierScope; sourceRequiresActive?: boolean }
  | { kind: "sleepCheckCoins"; amount: number; scope: ModifierScope; sourceRequiresActive?: boolean }
  | { kind: "preventAttackEffects"; scope: ModifierScope; requiresNoStadium?: boolean }
  | { kind: "retreatPerStadiumInDiscard"; scope: ModifierScope; sourceRequiresActive?: boolean }
  | { kind: "extraPrizeOnPoisonKO"; scope: ModifierScope }
  | { kind: "energyProvidesExtra"; scope: ModifierScope; fromType: EnergyType; addType: EnergyType; basicOnly?: boolean; requiresHolderType?: EnergyType }
  | { kind: "discardProvidesCost"; scope: ModifierScope; energyType: EnergyType; max: number }
  | { kind: "borrowAttacks"; scope: ModifierScope; nameContains: string }
  | { kind: "borrowUnderneathAttacks"; scope: ModifierScope; excludeEx?: boolean }
  | { kind: "disablePowersBelowHp"; scope: ModifierScope; hp: number }
  | { kind: "disableBodies"; scope: ModifierScope; basicOnly?: boolean; excludeEx?: boolean; excludeOwnerName?: boolean };

export interface CardFilter {
  supertype?: "Pokemon" | "Trainer" | "Energy";
  stage?: "Basic" | "Stage1" | "Stage2";
  trainerKindExclude?: ("Item" | "Supporter" | "Stadium" | "Tool")[];
  excludeEx?: boolean;
  basicEnergy?: boolean;
  nameContains?: string;
  maxHp?: number;
  deltaOnly?: boolean;
  notTrainer?: boolean;
  providesType?: EnergyType;
  providesAnyType?: EnergyType[];
  trainerKind?: "Item" | "Supporter" | "Stadium" | "Tool";
  evolution?: boolean;
}

export type Predicate =
  | { kind: "defenderStatus"; status: "asleep" | "confused" | "paralyzed" | "poisoned" | "burned" }
  | { kind: "defenderAnyStatus" }
  | { kind: "defenderEnergyAtLeast"; n: number }
  | { kind: "selfHasEnergyTypes"; types: EnergyType[] }
  | { kind: "namedPokemonInPlay"; names: string[] }
  | { kind: "stadiumInPlay" }
  | { kind: "opponentFewerPrizes" }
  | { kind: "defenderWasBenchedStartOfTurn" }
  | { kind: "selfInPlayTurns"; turns: number }
  | { kind: "defenderKnockedOut" }
  | { kind: "selfDistinctBasicEnergyAtLeast"; n: number }
  | { kind: "selfDamageCountersExactly"; n: number }
  | { kind: "activeDamageCountersAtLeast"; n: number }
  | { kind: "defenderRetreatCostAtLeast"; n: number }
  | { kind: "not"; of: Predicate };

export type Effect =
  | { op: "damage"; amount: number; target: EffectTarget; applyWR?: boolean; ignoreResistance?: boolean; ignoreDefenderEffects?: boolean; immediate?: boolean }
  | { op: "damageEachOpponent"; amount: number; bonusAmount?: number; ifSelfBenchedName?: string }
  | { op: "damageScaled"; base: number; amount: number; per: ScalePer; energyType?: EnergyType; energyTypes?: EnergyType[]; unusedCost?: number; maxBonus?: number; specialOnly?: boolean; perType?: EnergyType }
  | { op: "recoil"; amount: number }
  | { op: "protectNextTurn"; mode: "preventAll" | "reduce"; amount?: number }
  | { op: "lockDefending"; what: "attack" | "retreat" }
  | { op: "lockAttack"; target: "self" | "defending"; attackName?: string; chooseDefendingAttack?: boolean }
  | { op: "discardOpponentEnergy"; count: number; target?: "active" | "any" }
  | { op: "shuffleHandDraw"; who: "self" | "opponent" | "both"; count: number | "opponentHand" | "ownPrizes" }
  | { op: "scoopUp" }
  | { op: "warpPoint" }
  | { op: "moveEnergy"; count: number; energyType?: EnergyType; basicOnly?: boolean; fromSelf?: boolean; optional?: boolean }
  | { op: "moveDamageCounters"; count: number; ownOnly?: boolean }
  | { op: "devolveDefending" }
  | { op: "damageCounters"; count: number; target: EffectTarget }
  | { op: "heal"; amount: number; target: EffectTarget; restrictNames?: string[]; excludeEx?: boolean; clearConditions?: boolean }
  | { op: "recycleBasicEnergy" }
  | { op: "draw"; count: number }
  | { op: "drawPerOpponentPokemon" }
  | { op: "discardFromHand"; count: number; energyType?: EnergyType }
  | { op: "discardSelfEnergy"; count: number | "all"; energyType?: EnergyType; optional?: boolean; thenIfDone?: Effect[] }
  | { op: "becomeEnergyType"; untilEndOfTurn?: boolean }
  | { op: "applyCondition"; condition: Condition; target: "defending" | "self" }
  | { op: "removeCondition"; condition: Condition; target: "defending" }
  | { op: "applyPoison"; target: "defending"; counters?: number }
  | { op: "applyBurn"; target: "defending" }
  | { op: "flip"; heads: Effect[]; tails: Effect[] }
  | { op: "damagePerHeads"; flips: number; amount: number; target: EffectTarget; recoilIfNoHeads?: number }
  | { op: "searchDeck"; filter: CardFilter; count: number }
  | { op: "switchSelf"; optional?: boolean }
  | { op: "promoteSelfToActive"; moveDamageCounters?: number }
  | { op: "switchOpponent" }
  | { op: "gustOpponent"; optional?: boolean; thenIfSwitched?: Effect[] }
  | { op: "attachEnergyFromDiscard"; energyType?: EnergyType; basicOnly?: boolean; target: "selfBenchChoice" | "anySelfChoice" | "self"; thenIfDone?: Effect[] }
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
  | { op: "energyRestoreFlips"; flips: number }
  | { op: "healAllYours"; amount: number }
  | { op: "discardDefenderSpecialEnergyBonus"; bonus: number }
  | { op: "searchToBench"; count: number; filter?: CardFilter }
  | { op: "retrieveEnergyToHand"; energyType?: EnergyType; basicOnly?: boolean; count?: number; thenIfDone?: Effect[] }
  | { op: "retrieveFromDiscard"; filter: CardFilter; count?: number; thenIfDone?: Effect[] }
  | { op: "lookTopChooseToHand"; count: number }
  | { op: "reorderTopDeck"; count: number }
  | { op: "shiftEnergyToSelf"; fromNames: string[]; becomeType?: boolean }
  | { op: "rewriteEnergyType" }
  | { op: "returnSelfEnergyToHand"; count: number }
  | { op: "moveSelfEnergyToDeckTop"; basicOnly?: boolean; energyType?: EnergyType; thenIfDone?: Effect[] }
  | { op: "conditional"; cond: Predicate; then: Effect[]; else?: Effect[] }
  | { op: "revealTopDamagePerEnergy"; count: number; damagePer: number }
  | { op: "discardTopForDamage"; count: number; base: number; damagePer: number; energyType?: EnergyType }
  | { op: "discardDefenderEnergyPerHeads"; flips: number; damageIfAnyHeads?: number }
  | { op: "swapConditions" }
  | { op: "opponentDrawCard" }
  | { op: "addCharge"; count: number }
  | { op: "dischargeForDamage"; base: number; damagePer: number; mode: "all" | "choose" }
  | { op: "blockOpponentStadiumNextTurn" }
  | { op: "damageDamagedOpponent"; amount: number }
  | { op: "discardStadiumInPlay"; optional?: boolean; thenIfDone?: Effect[] }
  | { op: "endTurn" }
  | { op: "millOpponent"; count: number }
  | { op: "discardOpponentHandChosen"; count: number }
  | { op: "copyDefenderAbility" }
  | { op: "lostZoneCostEnergy"; energyType: EnergyType; costCount: number; max: number }
  | { op: "damagePerCardInDiscards"; base: number; damagePer: number; filter: CardFilter; both?: boolean };
