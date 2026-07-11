import { SeededRng, shuffle } from "../core/rng";
import { clonePlayer } from "../core/state";
import type { PokemonInPlay } from "../core/state";
import type { GameSnapshot, InformationState } from "../engine/game";
import type { CardInstance, CardLibrary } from "../model/cards";

function visibleCards(pokemon: PokemonInPlay): CardInstance[] {
  return [
    pokemon.card,
    ...pokemon.underneath,
    ...pokemon.energy,
    ...(pokemon.tool ? [pokemon.tool] : []),
  ];
}

function removeKnown(pool: string[], cardId: string): void {
  const index = pool.indexOf(cardId);
  if (index < 0) throw new Error(`Impossible information state: unexpected public card ${cardId}`);
  pool.splice(index, 1);
}

function assignDefinitions(
  cards: CardInstance[],
  ids: string[],
  library: CardLibrary,
  cursor: { value: number }
): CardInstance[] {
  return cards.map((card) => {
    const id = ids[cursor.value++];
    const def = library[id];
    if (!def) throw new Error(`Unknown card in determinization: ${id}`);
    return { uid: card.uid, def };
  });
}

function assignHandDefinitions(
  cards: CardInstance[],
  known: Record<number, string>,
  ids: string[],
  library: CardLibrary,
  cursor: { value: number }
): CardInstance[] {
  return cards.map((card) => {
    const id = known[card.uid] ?? ids[cursor.value++];
    const def = library[id];
    if (!def) throw new Error(`Unknown card in determinization: ${id}`);
    return { uid: card.uid, def };
  });
}

export function determinize(
  information: InformationState,
  library: CardLibrary,
  seed: number
): GameSnapshot {
  const source = information.snapshot;
  const snapshot: GameSnapshot = {
    ...source,
    players: [clonePlayer(source.players[0]), clonePlayer(source.players[1])],
    initialDeckIds: [[...source.initialDeckIds[0]], [...source.initialDeckIds[1]]],
    stadium: source.stadium ? { ...source.stadium } : null,
    rngState: seed >>> 0,
  };
  const rng = new SeededRng(seed);

  for (let p = 0; p < 2; p++) {
    const player = snapshot.players[p];
    const pool = [...snapshot.initialDeckIds[p]];
    for (const card of player.discard) removeKnown(pool, card.def.id);
    if (player.active) for (const card of visibleCards(player.active)) removeKnown(pool, card.def.id);
    for (const pokemon of player.bench)
      for (const card of visibleCards(pokemon)) removeKnown(pool, card.def.id);
    if (snapshot.stadium?.owner === p) removeKnown(pool, snapshot.stadium.card.def.id);
    if (p === information.observer)
      for (const card of player.hand) removeKnown(pool, card.def.id);
    const knownHand = p === information.observer
      ? {}
      : snapshot.knownOpponentHands[information.observer];
    if (p !== information.observer)
      for (const card of player.hand) {
        const cardId = knownHand[card.uid];
        if (cardId) removeKnown(pool, cardId);
      }

    const hiddenCount =
      player.deck.length + player.prizes.length +
      (p === information.observer
        ? 0
        : player.hand.filter((card) => !knownHand[card.uid]).length);
    if (pool.length !== hiddenCount)
      throw new Error(`Impossible information state for player ${p}: ${pool.length} cards for ${hiddenCount} hidden slots`);
    shuffle(() => rng.next(), pool);
    const cursor = { value: 0 };
    if (p !== information.observer)
      player.hand = assignHandDefinitions(player.hand, knownHand, pool, library, cursor);
    player.deck = assignDefinitions(player.deck, pool, library, cursor);
    player.prizes = assignDefinitions(player.prizes, pool, library, cursor);
  }
  return snapshot;
}

