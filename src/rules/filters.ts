import { isPokemon, isEnergy } from "../model/cards";
import type { CardDef } from "../model/cards";
import type { CardFilter } from "../model/effects";

export function matchesFilter(def: CardDef, filter: CardFilter): boolean {
  if (filter.supertype && def.supertype !== filter.supertype) return false;
  if (filter.stage && (!isPokemon(def) || def.stage !== filter.stage)) return false;
  if (filter.excludeEx && isPokemon(def) && def.isEx) return false;
  if (filter.basicEnergy && (!isEnergy(def) || !def.isBasic)) return false;
  if (filter.nameContains && !def.name.includes(filter.nameContains)) return false;
  if (filter.maxHp !== undefined && (!isPokemon(def) || def.hp > filter.maxHp)) return false;
  if (filter.deltaOnly && (!isPokemon(def) || !def.isDelta)) return false;
  if (filter.notTrainer && def.supertype === "Trainer") return false;
  if (filter.providesType && (!isEnergy(def) || !def.provides.includes(filter.providesType))) return false;
  if (filter.providesAnyType && (!isEnergy(def) || !filter.providesAnyType.some((t) => def.provides.includes(t)))) return false;
  if (filter.trainerKind && (def.supertype !== "Trainer" || def.kind !== filter.trainerKind)) return false;
  if (filter.trainerKindExclude && def.supertype === "Trainer" && filter.trainerKindExclude.includes(def.kind)) return false;
  if (filter.evolution && (!isPokemon(def) || def.stage === "Basic")) return false;
  return true;
}
