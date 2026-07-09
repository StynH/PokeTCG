import type { CardDef, CardLibrary } from "./types";
import { isEnergy } from "./types";

export function buildLibrary(cards: CardDef[]): CardLibrary {
  const library: CardLibrary = {};
  for (const card of cards) {
    if (library[card.id]) throw new Error(`Duplicate card id: ${card.id}`);
    library[card.id] = card;
  }
  return library;
}

export interface DeckValidation {
  valid: boolean;
  problems: string[];
}

export function buildDeck(deckList: Record<string, number>, library: CardLibrary): CardDef[] {
  const deck: CardDef[] = [];
  for (const [id, count] of Object.entries(deckList)) {
    const def = library[id];
    if (!def) throw new Error(`Unknown card id in deck: ${id}`);
    for (let i = 0; i < count; i++) deck.push(def);
  }
  return deck;
}

export function validateDeck(deck: CardDef[]): DeckValidation {
  const problems: string[] = [];
  if (deck.length !== 60) problems.push(`Deck has ${deck.length} cards, needs exactly 60`);
  const nameCounts = new Map<string, number>();
  for (const def of deck) {
    if (isEnergy(def) && def.isBasic) continue;
    nameCounts.set(def.name, (nameCounts.get(def.name) ?? 0) + 1);
  }
  for (const [name, count] of nameCounts) {
    if (count > 4) problems.push(`More than 4 copies of ${name} (${count})`);
  }
  return { valid: problems.length === 0, problems };
}
