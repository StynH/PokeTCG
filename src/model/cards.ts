import type { EnergyType } from "./energy";
import type { Effect, Modifier } from "./effects";

export type Supertype = "Pokemon" | "Trainer" | "Energy";
export type Stage = "Basic" | "Stage1" | "Stage2";
export type TrainerKind = "Item" | "Supporter" | "Stadium" | "Tool";

export interface AttackDef {
  name: string;
  cost: EnergyType[];
  damage?: number;
  ignoreResistance?: boolean;
  text?: string;
  effects?: Effect[];
}

export interface PowerDef {
  kind: "Poke-Power" | "Poke-Body";
  name: string;
  text: string;
  usable?: boolean;
  oncePerTurn?: boolean;
  requiresActive?: boolean;
  trigger?: "onPlayFromHand" | "onAttachBasicEnergy" | "onDamagedByAttack" | "onOpponentActiveEnergyAttach";
  triggerBasicEnergyType?: EnergyType;
  triggerBasicEnergyTypes?: EnergyType[];
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
  isGoldStar?: boolean;
  isCrystal?: boolean;
  isDelta?: boolean;
  playableAsEnergy?: boolean;
  weakness?: EnergyType;
  resistance?: EnergyType | EnergyType[];
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
  text?: string;
  attachRequiresEvolved?: boolean;
  attachExcludesEx?: boolean;
  damageRider?: number;
  damageRiderType?: EnergyType;
  damageRiderTarget?: "active";
  scramble?: boolean;
  deltaOnly?: boolean;
  modifiers?: Modifier[];
  onAttachEffects?: Effect[];
  onAttachExcludesEx?: boolean;
}

export type CardDef = PokemonCardDef | TrainerCardDef | EnergyCardDef;

export interface CardInstance {
  uid: number;
  def: CardDef;
  provideOverride?: { types: EnergyType[]; untilTurn: number };
}

export type CardLibrary = Record<string, CardDef>;

export function resistancesOf(def: PokemonCardDef): EnergyType[] {
  if (!def.resistance) return [];
  return Array.isArray(def.resistance) ? def.resistance : [def.resistance];
}

export function isPokemon(def: CardDef): def is PokemonCardDef {
  return def.supertype === "Pokemon";
}

export function isTrainer(def: CardDef): def is TrainerCardDef {
  return def.supertype === "Trainer";
}

export function isEnergy(def: CardDef): def is EnergyCardDef {
  return def.supertype === "Energy";
}
