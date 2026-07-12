import { isEnergy, isTrainer } from "../../model/cards";
import type { CardFilter } from "../../model/effects";
import type { ChoiceOption } from "../../core/choice";
import type { EffectContext } from "../context";
import { defineEffect } from "../registry";
import { searchCardChoiceScore } from "../../ai/choiceScoring";

defineEffect<{ op: "draw"; count: number }>({
  op: "draw",
  run: (e, ctx) => ctx.drawCards(ctx.controller, e.count),
  canApply: (_e, ctx) => ctx.players[ctx.controller].deck.length > 0,
  aiValue: (_e, ctx) => (ctx.players[ctx.controller].hand.length <= 4 ? 72 : 44),
});

defineEffect<{ op: "drawPerOpponentPokemon" }>({
  op: "drawPerOpponentPokemon",
  run: (_e, ctx) => ctx.drawCards(ctx.controller, ctx.allInPlay(ctx.opponent).length),
  canApply: (_e, ctx) => ctx.players[ctx.controller].deck.length > 0,
  aiValue: (_e, ctx) => (ctx.players[ctx.controller].hand.length <= 4 ? 72 : 44),
});

function discardFromHandLoop(
  ctx: EffectContext,
  count: number,
  energyType?: import("../../model/energy").EnergyType
): void {
  if (count <= 0) return;
  const player = ctx.players[ctx.controller];
  const candidates = player.hand.filter(
    (card) => !energyType || (isEnergy(card.def) && card.def.provides.includes(energyType))
  );
  if (candidates.length === 0) return;
  ctx.requestChoice(
    ctx.controller,
    "Discard which card?",
    candidates.map((card) => ({
      label: card.def.name,
      aiScore: isEnergy(card.def) ? 5 : isTrainer(card.def) ? 2 : 0,
      apply: () => {
        const index = player.hand.findIndex((c) => c.uid === card.uid);
        if (index !== -1) player.discard.push(player.hand.splice(index, 1)[0]);
        ctx.log(`${player.name} discards ${card.def.name}`);
        ctx.queueThunk(() => discardFromHandLoop(ctx, count - 1, energyType));
      },
    }))
  );
}

defineEffect<{ op: "discardFromHand"; count: number; energyType?: import("../../model/energy").EnergyType }>({
  op: "discardFromHand",
  run: (e, ctx) => discardFromHandLoop(ctx, e.count, e.energyType),
  canApply: (e, ctx) => ctx.players[ctx.controller].hand.filter(
    (card) => !e.energyType || (isEnergy(card.def) && card.def.provides.includes(e.energyType))
  ).length >= e.count,
  aiValue: (e) => -e.count * 8,
});

function discardOppHandLoop(ctx: EffectContext, count: number): void {
  if (count <= 0) return;
  const opponent = ctx.players[ctx.opponent];
  if (opponent.hand.length === 0) return;
  ctx.requestChoice(
    ctx.controller,
    "Choose a card for your opponent to discard:",
    opponent.hand.map((card) => ({
      label: card.def.name,
      aiScore: isEnergy(card.def) ? 10 : isTrainer(card.def) ? 8 : 5,
      apply: () => {
        const index = opponent.hand.findIndex((c) => c.uid === card.uid);
        if (index !== -1) opponent.discard.push(opponent.hand.splice(index, 1)[0]);
        ctx.log(`${opponent.name} discards ${card.def.name}`);
        ctx.queueThunk(() => discardOppHandLoop(ctx, count - 1));
      },
    }))
  );
}

defineEffect<{ op: "discardOpponentHand"; count: number }>({
  op: "discardOpponentHand",
  run: (e, ctx) => discardOppHandLoop(ctx, e.count),
  aiValue: (e) => e.count * 15,
});

defineEffect<{
  op: "shuffleHandDraw";
  who: "self" | "opponent" | "both";
  count: number | "opponentHand" | "ownPrizes";
}>({
  op: "shuffleHandDraw",
  run: (e, ctx) => {
    const targets =
      e.who === "both"
        ? [ctx.controller, ctx.opponent]
        : e.who === "self"
          ? [ctx.controller]
          : [ctx.opponent];
    const drawCounts = targets.map((p) => {
      if (e.count === "opponentHand") return ctx.players[1 - p].hand.length;
      if (e.count === "ownPrizes") return ctx.players[p].prizes.length;
      return e.count;
    });
    targets.forEach((p, i) => {
      const player = ctx.players[p];
      if (player.hand.length > 0) {
        player.deck.push(...player.hand.splice(0));
        ctx.shuffleDeck(p);
        ctx.log(`${player.name} shuffles their hand into the deck`);
      }
      ctx.drawCards(p, drawCounts[i]);
    });
  },
  aiValue: (_e, ctx) => (ctx.players[ctx.controller].hand.length <= 3 ? 55 : 30),
});

defineEffect<{ op: "heal"; amount: number; target: import("../../model/effects").EffectTarget }>({
  op: "heal",
  run: (e, ctx) => {
    const source = ctx.sourceRef ? ctx.getPokemon(ctx.sourceRef) : ctx.players[ctx.controller].active;
    const healOne = (pokemon: import("../../core/state").PokemonInPlay) => {
      pokemon.damage = Math.max(0, pokemon.damage - e.amount);
      ctx.log(`${pokemon.def.name} healed ${e.amount}`, "heal", {
        uid: pokemon.card.uid,
        amount: e.amount,
      });
    };
    let candidates = ctx.allInPlay(ctx.controller).filter(({ pokemon }) => pokemon.damage > 0);
    if (e.target === "self") candidates = candidates.filter(({ pokemon }) => pokemon === source);
    else if (e.target === "anySelfChoiceExceptSelf")
      candidates = candidates.filter(({ pokemon }) => pokemon !== source);
    if (candidates.length === 0) return;
    if (e.target === "self" || candidates.length === 1) { healOne(candidates[0].pokemon); return; }
    ctx.requestChoice(
      ctx.controller,
      "Heal which Pokemon?",
      candidates.map(({ ref, pokemon }) => ({
        label: `${ctx.describeSlot(ref)} — ${pokemon.damage} damage`,
        aiScore: Math.min(pokemon.damage, e.amount),
        apply: () => healOne(pokemon),
      }))
    );
  },
  canApply: (_e, ctx) =>
    ctx.allInPlay(ctx.controller).some(({ pokemon }) => pokemon.damage > 0),
  aiValue: (_e, ctx) => {
    const worst = Math.max(
      0,
      ...ctx.allInPlay(ctx.controller).map(({ pokemon }) => pokemon.damage)
    );
    return worst >= 20 ? 48 : 0;
  },
});

function searchDeckLoop(
  ctx: EffectContext,
  filter: CardFilter,
  count: number
): void {
  if (count <= 0) return;
  const player = ctx.players[ctx.controller];
  const seen = new Set<string>();
  const options: ChoiceOption[] = [];
  for (const card of player.deck) {
    if (!ctx.matchesFilter(card.def, filter) || seen.has(card.def.id)) continue;
    seen.add(card.def.id);
    const def = card.def;
    options.push({
      label: def.name,
      aiScore: searchCardChoiceScore(ctx, card, ctx.controller),
      apply: () => {
        const index = player.deck.findIndex((c) => c.def.id === def.id);
        if (index !== -1) player.hand.push(player.deck.splice(index, 1)[0]);
        ctx.log(`${player.name} takes ${def.name} from the deck`);
        ctx.shuffleDeck(ctx.controller);
        ctx.queueThunk(() => searchDeckLoop(ctx, filter, count - 1));
      },
    });
  }
  options.push({
    label: "Take nothing",
    aiScore: -100,
    apply: () => {
      ctx.shuffleDeck(ctx.controller);
      ctx.log(`${player.name} shuffles their deck`);
    },
  });
  if (options.length === 1) { options[0].apply(); return; }
  ctx.requestChoice(ctx.controller, "Search your deck for:", options);
}

defineEffect<{ op: "searchDeck"; filter: CardFilter; count: number }>({
  op: "searchDeck",
  run: (e, ctx) => searchDeckLoop(ctx, e.filter, e.count),
  canApply: (_e, ctx) => ctx.players[ctx.controller].deck.length > 0,
  aiValue: () => 58,
});

defineEffect<{ op: "drawToHandSize"; size: number }>({
  op: "drawToHandSize",
  run: (e, ctx) => {
    const player = ctx.players[ctx.controller];
    const need = Math.max(0, e.size - player.hand.length);
    if (need > 0) ctx.drawCards(ctx.controller, need);
  },
  canApply: (e, ctx) => {
    const p = ctx.players[ctx.controller];
    return p.hand.length < e.size && p.deck.length > 0;
  },
  aiValue: (_e, ctx) => (ctx.players[ctx.controller].hand.length <= 3 ? 60 : 28),
});

defineEffect<{ op: "peekTopDeck"; count: number; filter?: CardFilter }>({
  op: "peekTopDeck",
  run: (e, ctx) => {
    const player = ctx.players[ctx.controller];
    const top = player.deck.slice(0, e.count);
    if (top.length === 0) return;
    const eligible = e.filter ? top.filter((c) => ctx.matchesFilter(c.def, e.filter!)) : top;
    if (eligible.length === 0) {
      ctx.log(`${player.name} looks at top ${top.length} card(s) — no eligible card found`);
      return;
    }
    const options: ChoiceOption[] = eligible.map((card) => ({
      label: card.def.name,
      aiScore: searchCardChoiceScore(ctx, card, ctx.controller),
      apply: () => {
        const index = player.deck.findIndex((c) => c.uid === card.uid);
        if (index !== -1) player.hand.push(player.deck.splice(index, 1)[0]);
        ctx.log(`${player.name} takes ${card.def.name} from the top of their deck`);
      },
    }));
    options.push({ label: "Take nothing", aiScore: -10, apply: () => {} });
    ctx.requestChoice(ctx.controller, "Choose a card to put into your hand:", options);
  },
  canApply: (_e, ctx) => ctx.players[ctx.controller].deck.length > 0,
  aiValue: () => 45,
});

defineEffect<{ op: "energyRestoreFlips"; flips: number }>({
  op: "energyRestoreFlips",
  run: (e, ctx) => {
    let heads = 0;
    for (let i = 0; i < e.flips; i++) if (ctx.flip("Coin flip")) heads++;
    if (heads === 0) { ctx.log("No heads — no Energy restored"); return; }
    const player = ctx.players[ctx.controller];
    const basicEnergies = player.discard.filter((c) => isEnergy(c.def) && c.def.isBasic);
    const count = Math.min(heads, basicEnergies.length);
    if (count === 0) { ctx.log("No basic Energy in discard pile"); return; }
    let taken = 0;
    for (const card of basicEnergies) {
      if (taken >= count) break;
      const idx = player.discard.findIndex((c) => c.uid === card.uid);
      if (idx !== -1) {
        player.hand.push(player.discard.splice(idx, 1)[0]);
        ctx.log(`${card.def.name} recovered from discard pile`);
        taken++;
      }
    }
    ctx.log(`${player.name} recovered ${taken} basic Energy from the discard pile`);
  },
  canApply: (_e, ctx) =>
    ctx.players[ctx.controller].discard.some((c) => isEnergy(c.def) && c.def.isBasic),
  aiValue: () => 35,
});
