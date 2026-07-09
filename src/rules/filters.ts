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
  return true;
}
