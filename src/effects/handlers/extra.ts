import { isEnergy } from "../../model/cards";
import type { CardInstance } from "../../model/cards";
import type { EnergyType } from "../../model/energy";
import { ALL_TYPES } from "../../model/energy";
import type { CardFilter, Effect, Predicate } from "../../model/effects";
import type { PokemonInPlay, SlotRef } from "../../core/state";
import type { ChoiceOption, EffectContext } from "../context";
import { defineEffect, defineEffectCommand, effectCanApply } from "../registry";

const BENCH_LIMIT = 5;

function source(ctx: EffectContext): PokemonInPlay | null {
  return ctx.sourceRef ? ctx.getPokemon(ctx.sourceRef) : ctx.players[ctx.controller].active;
}

function findInPlay(ctx: EffectContext, uid: number): { ref: SlotRef; pokemon: PokemonInPlay } | null {
  for (let p = 0; p < 2; p++) {
    const found = ctx.allInPlay(p).find(({ pokemon }) => pokemon.card.uid === uid);
    if (found) return found;
  }
  return null;
}

function hasSpecialCondition(pokemon: PokemonInPlay): boolean {
  return pokemon.condition !== null || pokemon.poisonCounters > 0 || pokemon.burned;
}

export function evalPredicate(pred: Predicate, ctx: EffectContext): boolean {
  const defender = ctx.players[ctx.opponent].active;
  switch (pred.kind) {
    case "not":
      return !evalPredicate(pred.of, ctx);
    case "stadiumInPlay":
      return ctx.stadium() !== null;
    case "opponentFewerPrizes":
      return ctx.players[ctx.opponent].prizes.length < ctx.players[ctx.controller].prizes.length;
    case "defenderStatus": {
      if (!defender) return false;
      if (pred.status === "poisoned") return defender.poisonCounters > 0;
      if (pred.status === "burned") return defender.burned;
      return defender.condition === pred.status;
    }
    case "defenderAnyStatus":
      return !!defender && hasSpecialCondition(defender);
    case "defenderEnergyAtLeast":
      return !!defender && defender.energy.length >= pred.n;
    case "defenderWasBenchedStartOfTurn":
      return !!defender && defender.activeSince === ctx.turnNumber;
    case "defenderKnockedOut":
      return !!defender && defender.damage >= ctx.effectiveHp({ p: ctx.opponent, slot: "active" }, defender);
    case "selfInPlayTurns": {
      const src = source(ctx);
      return !!src && ctx.turnNumber - src.enteredTurn >= pred.turns;
    }
    case "selfHasEnergyTypes": {
      const src = source(ctx);
      if (!src) return false;
      return pred.types.every((t) =>
        src.energy.some((c) => isEnergy(c.def) && c.def.provides.includes(t))
      );
    }
    case "namedPokemonInPlay": {
      const inPlay = ctx.allInPlay(ctx.controller).map(({ pokemon }) => pokemon.def.name);
      return pred.names.every((name) => inPlay.some((n) => n.includes(name)));
    }
    case "selfDistinctBasicEnergyAtLeast": {
      const src = source(ctx);
      if (!src) return false;
      const types = new Set<string>();
      for (const c of src.energy)
        if (isEnergy(c.def) && c.def.isBasic) for (const t of c.def.provides) types.add(t);
      return types.size >= pred.n;
    }
    case "selfDamageCountersExactly": {
      const src = source(ctx);
      return !!src && src.damage / 10 === pred.n;
    }
    case "activeDamageCountersAtLeast": {
      const active = ctx.players[ctx.controller].active;
      return !!active && active.damage / 10 >= pred.n;
    }
    case "defenderRetreatCostAtLeast": {
      if (!defender) return false;
      return ctx.effectiveRetreatCost({ p: ctx.opponent, slot: "active" }, defender) >= pred.n;
    }
  }
}

// ── conditional ────────────────────────────────────────────────────────────

defineEffect<{ op: "conditional"; cond: Predicate; then: Effect[]; else?: Effect[] }>({
  op: "conditional",
  run: (e, ctx) => ctx.queueEffects(evalPredicate(e.cond, ctx) ? e.then : e.else ?? []),
  canApply: (e, ctx) => {
    const branch = evalPredicate(e.cond, ctx) ? e.then : e.else ?? [];
    return branch.length > 0 && branch.every((sub) => effectCanApply(sub, ctx));
  },
  aiValue: () => 5,
});

// ── becomeEnergyType ─────────────────────────────────────────────────────────

defineEffect<{ op: "becomeEnergyType"; untilEndOfTurn?: boolean }>({
  op: "becomeEnergyType",
  run: (e, ctx) => {
    const src = source(ctx);
    if (!src || src.energy.length === 0) return;
    const attached = src.energy[src.energy.length - 1];
    if (!isEnergy(attached.def) || attached.def.provides.length === 0) return;
    const types = [...attached.def.provides];
    src.typeOverride = {
      types,
      untilTurn: e.untilEndOfTurn === false ? Number.POSITIVE_INFINITY : ctx.turnNumber,
    };
    ctx.log(`${src.def.name}'s type becomes ${types.join("/")}`);
  },
  aiValue: () => 0,
});

// ── searchToBench ──────────────────────────────────────────────────────────

function searchBenchLoop(ctx: EffectContext, filter: CardFilter, remaining: number): void {
  const me = ctx.players[ctx.controller];
  if (remaining <= 0 || me.bench.length >= BENCH_LIMIT) {
    ctx.shuffleDeck(ctx.controller);
    ctx.log(`${me.name} shuffles their deck`);
    return;
  }
  const seen = new Set<string>();
  const options: ChoiceOption[] = [];
  for (const card of me.deck) {
    if (!ctx.matchesFilter(card.def, filter) || seen.has(card.def.id)) continue;
    seen.add(card.def.id);
    options.push({
      label: card.def.name,
      informationKey: `bench-search:${card.def.id}`,
      aiScore: 40,
      operation: ctx.command("extra.benchFromDeck", { cardId: card.def.id, filter, remaining }),
    });
  }
  if (options.length === 0) {
    ctx.shuffleDeck(ctx.controller);
    ctx.log(`${me.name} shuffles their deck`);
    return;
  }
  options.push({
    label: "Stop searching",
    informationKey: "stop",
    aiScore: -50,
    operation: ctx.command("extra.finishBenchSearch", {}),
  });
  ctx.requestChoice(ctx.controller, "Search your deck for a Basic Pokémon to Bench:", options);
}

defineEffect<{ op: "searchToBench"; count: number; filter?: CardFilter }>({
  op: "searchToBench",
  run: (e, ctx) =>
    searchBenchLoop(ctx, e.filter ?? { supertype: "Pokemon", stage: "Basic" }, e.count),
  canApply: (_e, ctx) => ctx.players[ctx.controller].bench.length < BENCH_LIMIT,
  aiValue: () => 50,
});

defineEffectCommand<{ cardId: string; filter: CardFilter; remaining: number }>(
  "extra.benchFromDeck",
  (payload, ctx) => {
    const player = ctx.players[ctx.controller];
    const index = player.deck.findIndex((card) => card.def.id === payload.cardId);
    if (index === -1) {
      searchBenchLoop(ctx, payload.filter, 0);
      return;
    }
    const card = player.deck[index];
    ctx.benchFromDeck(card.uid);
    searchBenchLoop(ctx, payload.filter, payload.remaining - 1);
  }
);

defineEffectCommand("extra.finishBenchSearch", (_payload: unknown, ctx) => {
  ctx.shuffleDeck(ctx.controller);
  ctx.log(`${ctx.players[ctx.controller].name} shuffles their deck`);
});

// ── retrieveEnergyToHand ─────────────────────────────────────────────────────

function energyMatcher(energyType?: import("../../model/energy").EnergyType, basicOnly?: boolean) {
  return (c: CardInstance) =>
    isEnergy(c.def) && (energyType ? c.def.provides.includes(energyType) : true) && (!basicOnly || c.def.isBasic);
}

function retrieveEnergyLoop(
  ctx: EffectContext,
  energyType: import("../../model/energy").EnergyType | undefined,
  basicOnly: boolean | undefined,
  count: number,
  thenIfDone: Effect[]
): void {
  const me = ctx.players[ctx.controller];
  const matches = energyMatcher(energyType, basicOnly);
  const candidates = me.discard.filter(matches);
  if (count <= 0 || candidates.length === 0) {
    if (thenIfDone.length) ctx.queueEffects(thenIfDone);
    return;
  }
  const seen = new Set<string>();
  const options: ChoiceOption[] = [];
  for (const card of candidates) {
    if (seen.has(card.def.id)) continue;
    seen.add(card.def.id);
    options.push({
      label: card.def.name,
      informationKey: `retrieve:${card.def.id}`,
      aiScore: 22,
      operation: ctx.command("extra.retrieveEnergy", {
        cardId: card.def.id, energyType, basicOnly, count, thenIfDone,
      }),
    });
  }
  if (count > 1)
    options.push({
      label: "Stop", informationKey: "stop-retrieve", aiScore: -1,
      operation: ctx.command("extra.retrieveEnergyStop", { thenIfDone }),
    });
  if (options.length === 1) {
    ctx.queueOperation(options[0].operation);
    return;
  }
  ctx.requestChoice(ctx.controller, "Put which Energy from your discard into your hand?", options);
}

defineEffect<{
  op: "retrieveEnergyToHand";
  energyType?: import("../../model/energy").EnergyType;
  basicOnly?: boolean;
  count?: number;
  thenIfDone?: Effect[];
}>({
  op: "retrieveEnergyToHand",
  run: (e, ctx) => retrieveEnergyLoop(ctx, e.energyType, e.basicOnly, e.count ?? 1, e.thenIfDone ?? []),
  canApply: (e, ctx) =>
    ctx.players[ctx.controller].discard.some(energyMatcher(e.energyType, e.basicOnly)),
  aiValue: (e) => 20 * (e.count ?? 1),
});

defineEffectCommand<{
  cardId: string;
  energyType?: import("../../model/energy").EnergyType;
  basicOnly?: boolean;
  count: number;
  thenIfDone: Effect[];
}>(
  "extra.retrieveEnergy",
  (payload, ctx) => {
    const player = ctx.players[ctx.controller];
    const index = player.discard.findIndex((card) => card.def.id === payload.cardId);
    if (index === -1) return;
    const card = player.discard.splice(index, 1)[0];
    player.hand.push(card);
    ctx.revealInHand(ctx.controller, card);
    ctx.log(`${card.def.name} is returned to ${player.name}'s hand`);
    retrieveEnergyLoop(ctx, payload.energyType, payload.basicOnly, payload.count - 1, payload.thenIfDone);
  }
);

defineEffectCommand<{ thenIfDone: Effect[] }>("extra.retrieveEnergyStop", (payload, ctx) => {
  if (payload.thenIfDone.length) ctx.queueEffects(payload.thenIfDone);
});

// ── recycleBasicEnergy (Energy Recycle System) ───────────────────────────────

function recycleToDeckLoop(ctx: EffectContext, remaining: number): void {
  const me = ctx.players[ctx.controller];
  const basics = me.discard.filter((c) => isEnergy(c.def) && c.def.isBasic);
  if (remaining <= 0 || basics.length === 0) {
    ctx.shuffleDeck(ctx.controller);
    ctx.log(`${me.name} shuffles their deck`);
    return;
  }
  const seen = new Set<string>();
  const options: ChoiceOption[] = [];
  for (const card of basics) {
    if (seen.has(card.def.id)) continue;
    seen.add(card.def.id);
    options.push({
      label: card.def.name,
      informationKey: `recycle-deck:${card.def.id}`,
      aiScore: 8,
      operation: ctx.command("extra.recycleToDeck", { cardId: card.def.id, remaining }),
    });
  }
  if (options.length === 1) { ctx.queueOperation(options[0].operation); return; }
  ctx.requestChoice(ctx.controller, `Shuffle which Energy into your deck? (${remaining} left)`, options);
}

defineEffect<{ op: "recycleBasicEnergy" }>({
  op: "recycleBasicEnergy",
  run: (_e, ctx) => {
    const me = ctx.players[ctx.controller];
    const count = me.discard.filter((c) => isEnergy(c.def) && c.def.isBasic).length;
    if (count === 0) return;
    if (count < 3) {
      retrieveEnergyLoop(ctx, undefined, true, 1, []);
      return;
    }
    ctx.requestChoice(ctx.controller, "Energy Recycle System:", [
      {
        label: "Put 1 basic Energy into your hand",
        informationKey: "recycle-hand",
        aiScore: 12,
        operation: ctx.command("extra.recycleHand", {}),
      },
      {
        label: "Shuffle 3 basic Energy into your deck",
        informationKey: "recycle-deck",
        aiScore: 6,
        operation: ctx.command("extra.recycleDeckStart", {}),
      },
    ]);
  },
  canApply: (_e, ctx) =>
    ctx.players[ctx.controller].discard.some((c) => isEnergy(c.def) && c.def.isBasic),
  aiValue: () => 18,
});

defineEffectCommand("extra.recycleHand", (_payload: unknown, ctx) => {
  retrieveEnergyLoop(ctx, undefined, true, 1, []);
});

defineEffectCommand("extra.recycleDeckStart", (_payload: unknown, ctx) => {
  recycleToDeckLoop(ctx, 3);
});

defineEffectCommand<{ cardId: string; remaining: number }>("extra.recycleToDeck", (payload, ctx) => {
  const me = ctx.players[ctx.controller];
  const index = me.discard.findIndex((c) => c.def.id === payload.cardId);
  if (index === -1) { recycleToDeckLoop(ctx, 0); return; }
  const card = me.discard.splice(index, 1)[0];
  me.deck.push(card);
  ctx.log(`${card.def.name} is shuffled back into ${me.name}'s deck`);
  recycleToDeckLoop(ctx, payload.remaining - 1);
});

// ── returnSelfEnergyToHand ───────────────────────────────────────────────────

function returnSelfEnergyLoop(ctx: EffectContext, count: number): void {
  if (count <= 0) return;
  const src = source(ctx);
  if (!src || src.energy.length === 0) return;
  const options: ChoiceOption[] = src.energy.map((card) => ({
    label: card.def.name,
    informationKey: `return-energy:${card.def.id}`,
    aiScore: -5,
    operation: ctx.command("extra.returnSelfEnergy", { cardUid: card.uid, count }),
  }));
  if (options.length === 1) {
    ctx.queueOperation(options[0].operation);
    return;
  }
  ctx.requestChoice(ctx.controller, "Return which Energy to your hand?", options);
}

defineEffect<{ op: "returnSelfEnergyToHand"; count: number }>({
  op: "returnSelfEnergyToHand",
  run: (e, ctx) => returnSelfEnergyLoop(ctx, e.count),
  aiValue: () => -5,
});

defineEffectCommand<{ cardUid: number; count: number }>(
  "extra.returnSelfEnergy",
  (payload, ctx) => {
    const src = source(ctx);
    if (!src) return;
    const index = src.energy.findIndex((card) => card.uid === payload.cardUid);
    if (index === -1) return;
    const card = src.energy.splice(index, 1)[0];
    ctx.players[ctx.controller].hand.push(card);
    ctx.revealInHand(ctx.controller, card);
    ctx.log(`${card.def.name} returns to ${ctx.players[ctx.controller].name}'s hand`);
    returnSelfEnergyLoop(ctx, payload.count - 1);
  }
);

// ── moveSelfEnergyToDeckTop ──────────────────────────────────────────────────

defineEffect<{
  op: "moveSelfEnergyToDeckTop";
  basicOnly?: boolean;
  energyType?: import("../../model/energy").EnergyType;
  thenIfDone?: Effect[];
}>({
  op: "moveSelfEnergyToDeckTop",
  run: (e, ctx) => {
    const matches = energyMatcher(e.energyType, e.basicOnly);
    const entries: Array<{ pokemon: PokemonInPlay; card: CardInstance; ref: SlotRef }> = [];
    for (const { ref, pokemon } of ctx.allInPlay(ctx.controller))
      for (const card of pokemon.energy) if (matches(card)) entries.push({ pokemon, card, ref });
    if (entries.length === 0) return;
    const options: ChoiceOption[] = entries.map(({ pokemon, card, ref }) => ({
      label: `${card.def.name} on ${ctx.describeSlot(ref)}`,
      informationKey: `todeck:${card.uid}`,
      aiScore: 5,
      operation: ctx.command("extra.moveEnergyToDeckTop", {
        pokemonUid: pokemon.card.uid,
        cardUid: card.uid,
        thenIfDone: e.thenIfDone ?? [],
      }),
    }));
    if (options.length === 1) {
      ctx.queueOperation(options[0].operation);
      return;
    }
    ctx.requestChoice(ctx.controller, "Put which Energy on top of your deck?", options);
  },
  canApply: (e, ctx) => {
    const matches = energyMatcher(e.energyType, e.basicOnly);
    return ctx.allInPlay(ctx.controller).some(({ pokemon }) => pokemon.energy.some(matches));
  },
  aiValue: () => 15,
});

defineEffectCommand<{ pokemonUid: number; cardUid: number; thenIfDone: Effect[] }>(
  "extra.moveEnergyToDeckTop",
  (payload, ctx) => {
    const entry = findInPlay(ctx, payload.pokemonUid);
    if (!entry || entry.ref.p !== ctx.controller) return;
    const index = entry.pokemon.energy.findIndex((card) => card.uid === payload.cardUid);
    if (index === -1) return;
    const card = entry.pokemon.energy.splice(index, 1)[0];
    ctx.players[ctx.controller].deck.unshift(card);
    ctx.log(`${card.def.name} is put on top of ${ctx.players[ctx.controller].name}'s deck`);
    if (payload.thenIfDone.length) ctx.queueEffects(payload.thenIfDone);
  }
);

// ── revealTopDamagePerEnergy ─────────────────────────────────────────────────

defineEffect<{ op: "revealTopDamagePerEnergy"; count: number; damagePer: number }>({
  op: "revealTopDamagePerEnergy",
  run: (e, ctx) => {
    const me = ctx.players[ctx.controller];
    const top = me.deck.splice(0, e.count);
    if (top.length === 0) return;
    let basics = 0;
    for (const card of top) {
      if (isEnergy(card.def) && card.def.isBasic) {
        me.hand.push(card);
        ctx.revealInHand(ctx.controller, card);
        basics++;
      } else {
        me.discard.push(card);
      }
    }
    ctx.log(`${me.name} reveals ${top.length} card(s): ${basics} basic Energy to hand`);
    const total = basics * e.damagePer;
    if (total > 0 && !ctx.addAttackDamage(total)) ctx.dealDamage({ p: ctx.opponent, slot: "active" }, total);
  },
  aiValue: (e) => e.count * e.damagePer * 0.3,
});

// ── discardTopForDamage ──────────────────────────────────────────────────────

defineEffect<{
  op: "discardTopForDamage";
  count: number;
  base: number;
  damagePer: number;
  energyType?: import("../../model/energy").EnergyType;
}>({
  op: "discardTopForDamage",
  run: (e, ctx) => {
    const me = ctx.players[ctx.controller];
    const top = me.deck.splice(0, e.count);
    let matched = 0;
    for (const card of top) {
      if (isEnergy(card.def) && (e.energyType ? card.def.provides.includes(e.energyType) : true)) matched++;
      me.discard.push(card);
    }
    ctx.log(`${me.name} discards ${top.length} card(s) from the top of their deck (${matched} matched)`);
    const total = e.base + matched * e.damagePer;
    if (total > 0 && !ctx.addAttackDamage(total)) ctx.dealDamage({ p: ctx.opponent, slot: "active" }, total);
  },
  aiValue: (e) => e.base + e.damagePer * 1.5,
});

// ── discardDefenderEnergyPerHeads ────────────────────────────────────────────

defineEffect<{ op: "discardDefenderEnergyPerHeads"; flips: number; damageIfAnyHeads?: number }>({
  op: "discardDefenderEnergyPerHeads",
  run: (e, ctx) => {
    let heads = 0;
    for (let i = 0; i < e.flips; i++) if (ctx.flip("Coin flip")) heads++;
    if (heads === 0) {
      ctx.log("All tails — the attack does nothing");
      return;
    }
    if (e.damageIfAnyHeads && !ctx.addAttackDamage(e.damageIfAnyHeads))
      ctx.dealDamage({ p: ctx.opponent, slot: "active" }, e.damageIfAnyHeads);
    ctx.queueEffects([{ op: "discardOpponentEnergy", count: heads }]);
  },
  aiValue: (e) => (e.damageIfAnyHeads ?? 0) * 0.5 + e.flips * 8,
});

// ── swapConditions ───────────────────────────────────────────────────────────

defineEffect<{ op: "swapConditions" }>({
  op: "swapConditions",
  run: (_e, ctx) => {
    const own = ctx.allInPlay(ctx.controller).filter(({ pokemon }) => hasSpecialCondition(pokemon));
    const opp = ctx.allInPlay(ctx.opponent).filter(({ pokemon }) => hasSpecialCondition(pokemon));
    if (own.length === 0 || opp.length === 0) return;
    ctx.requestChoice(
      ctx.controller,
      "Switch conditions — choose YOUR Pokémon:",
      own.map(({ ref, pokemon }) => ({
        label: ctx.describeSlot(ref),
        informationKey: `swap-own:${pokemon.card.uid}`,
        aiScore: 10,
        operation: ctx.command("extra.swapCondChooseOpp", { ownUid: pokemon.card.uid }),
      }))
    );
  },
  canApply: (_e, ctx) =>
    ctx.allInPlay(ctx.controller).some(({ pokemon }) => hasSpecialCondition(pokemon)) &&
    ctx.allInPlay(ctx.opponent).some(({ pokemon }) => hasSpecialCondition(pokemon)),
  aiValue: () => 18,
});

defineEffectCommand<{ ownUid: number }>("extra.swapCondChooseOpp", (payload, ctx) => {
  const opp = ctx.allInPlay(ctx.opponent).filter(({ pokemon }) => hasSpecialCondition(pokemon));
  if (opp.length === 0) return;
  ctx.requestChoice(
    ctx.controller,
    "Switch conditions — choose your opponent's Pokémon:",
    opp.map(({ ref, pokemon }) => ({
      label: ctx.describeSlot(ref),
      informationKey: `swap-opp:${pokemon.card.uid}`,
      aiScore: 10,
      operation: ctx.command("extra.swapCondApply", { ownUid: payload.ownUid, oppUid: pokemon.card.uid }),
    }))
  );
});

defineEffectCommand<{ ownUid: number; oppUid: number }>("extra.swapCondApply", (payload, ctx) => {
  const own = findInPlay(ctx, payload.ownUid)?.pokemon;
  const opp = findInPlay(ctx, payload.oppUid)?.pokemon;
  if (!own || !opp) return;
  const swap = { condition: own.condition, poisonCounters: own.poisonCounters, burned: own.burned };
  own.condition = opp.condition;
  own.poisonCounters = opp.poisonCounters;
  own.burned = opp.burned;
  opp.condition = swap.condition;
  opp.poisonCounters = swap.poisonCounters;
  opp.burned = swap.burned;
  ctx.log(`${own.def.name} and ${opp.def.name} switch Special Conditions`);
});

// ── opponentDrawCard ─────────────────────────────────────────────────────────

defineEffect<{ op: "opponentDrawCard" }>({
  op: "opponentDrawCard",
  run: (_e, ctx) => ctx.drawCards(ctx.opponent, 1),
  aiValue: () => -10,
});

// ── charge counters ──────────────────────────────────────────────────────────

defineEffect<{ op: "addCharge"; count: number }>({
  op: "addCharge",
  run: (e, ctx) => {
    const src = source(ctx);
    if (!src) return;
    src.chargeCounters += e.count;
    ctx.log(`${src.def.name} gets ${e.count} charge counter(s) (${src.chargeCounters} total)`);
  },
  aiValue: (e) => e.count * 6,
});

defineEffect<{ op: "dischargeForDamage"; base: number; damagePer: number; mode: "all" | "choose" }>({
  op: "dischargeForDamage",
  run: (e, ctx) => {
    const src = source(ctx);
    if (!src) return;
    if (e.mode === "all") {
      const removed = src.chargeCounters;
      src.chargeCounters = 0;
      if (removed > 0) ctx.log(`${src.def.name} removes ${removed} charge counter(s)`);
      const total = e.base + e.damagePer * removed;
      if (total > 0 && !ctx.addAttackDamage(total)) ctx.dealDamage({ p: ctx.opponent, slot: "active" }, total);
      return;
    }
    const options: ChoiceOption[] = [];
    for (let k = 0; k <= src.chargeCounters; k++) {
      options.push({
        label: `Remove ${k} charge counter(s) (+${e.damagePer * k})`,
        informationKey: `discharge:${k}`,
        aiScore: k,
        operation: ctx.command("extra.discharge", { remove: k, base: e.base, damagePer: e.damagePer }),
      });
    }
    if (options.length === 1) {
      ctx.queueOperation(options[0].operation);
      return;
    }
    ctx.requestChoice(ctx.controller, "Remove how many charge counters?", options);
  },
  aiValue: (e) => e.base + e.damagePer * 2,
});

defineEffectCommand<{ remove: number; base: number; damagePer: number }>(
  "extra.discharge",
  (payload, ctx) => {
    const src = source(ctx);
    if (!src) return;
    src.chargeCounters = Math.max(0, src.chargeCounters - payload.remove);
    if (payload.remove > 0) ctx.log(`${src.def.name} removes ${payload.remove} charge counter(s)`);
    const total = payload.base + payload.damagePer * payload.remove;
    if (total > 0 && !ctx.addAttackDamage(total)) ctx.dealDamage({ p: ctx.opponent, slot: "active" }, total);
  }
);

// ── blockOpponentStadiumNextTurn ─────────────────────────────────────────────

defineEffect<{ op: "blockOpponentStadiumNextTurn" }>({
  op: "blockOpponentStadiumNextTurn",
  run: (_e, ctx) => {
    ctx.blockStadiumNextTurn(ctx.opponent);
    ctx.log(`${ctx.players[ctx.opponent].name} can't play Stadium cards next turn`);
  },
  aiValue: () => 8,
});

// ── damageDamagedOpponent ────────────────────────────────────────────────────

defineEffect<{ op: "damageDamagedOpponent"; amount: number }>({
  op: "damageDamagedOpponent",
  run: (e, ctx) => {
    const targets = ctx.allInPlay(ctx.opponent).filter(({ pokemon }) => pokemon.damage > 0);
    if (targets.length === 0) return;
    if (targets.length === 1) {
      ctx.dealDamage(targets[0].ref, e.amount, false);
      return;
    }
    ctx.requestChoice(
      ctx.controller,
      `Deal ${e.amount} damage to which damaged Pokémon?`,
      targets.map(({ ref, pokemon }) => ({
        label: ctx.describeSlot(ref),
        informationKey: `damaged-target:${pokemon.card.uid}`,
        aiScore: pokemon.damage,
        operation: ctx.command("extra.damageTarget", { targetUid: pokemon.card.uid, amount: e.amount }),
      }))
    );
  },
  aiValue: (e) => e.amount * 0.7,
});

defineEffectCommand<{ targetUid: number; amount: number }>(
  "extra.damageTarget",
  (payload, ctx) => {
    const entry = ctx.allInPlay(ctx.opponent).find(({ pokemon }) => pokemon.card.uid === payload.targetUid);
    if (!entry) return;
    ctx.dealDamage(entry.ref, payload.amount, false);
  }
);

// ── discardStadiumInPlay ─────────────────────────────────────────────────────

function discardStadium(ctx: EffectContext, thenIfDone: Effect[]): void {
  if (!ctx.stadium()) return;
  ctx.removeStadium();
  if (thenIfDone.length) ctx.queueEffects(thenIfDone);
}

defineEffect<{ op: "discardStadiumInPlay"; optional?: boolean; thenIfDone?: Effect[] }>({
  op: "discardStadiumInPlay",
  run: (e, ctx) => {
    if (!ctx.stadium()) return;
    const thenIfDone = e.thenIfDone ?? [];
    if (!e.optional) {
      discardStadium(ctx, thenIfDone);
      return;
    }
    ctx.requestChoice(ctx.controller, "Discard the Stadium in play?", [
      {
        label: "Discard Stadium",
        informationKey: "discard-stadium",
        aiScore: 20,
        operation: ctx.command("extra.discardStadium", { thenIfDone }),
      },
      {
        label: "Don't discard",
        informationKey: "keep-stadium",
        aiScore: 0,
        operation: ctx.command("extra.noop", {}),
      },
    ]);
  },
  aiValue: () => 12,
});

defineEffectCommand<{ thenIfDone: Effect[] }>("extra.discardStadium", (payload, ctx) => {
  discardStadium(ctx, payload.thenIfDone);
});

defineEffectCommand("extra.noop", (_payload: unknown, _ctx) => {});

// ── endTurn ──────────────────────────────────────────────────────────────────

defineEffect<{ op: "endTurn" }>({
  op: "endTurn",
  run: (_e, ctx) => {
    ctx.endTurn();
    ctx.log(`${ctx.players[ctx.controller].name}'s turn ends`);
  },
  aiValue: () => -30,
});

// ── millOpponent ─────────────────────────────────────────────────────────────

defineEffect<{ op: "millOpponent"; count: number }>({
  op: "millOpponent",
  run: (e, ctx) => {
    const opp = ctx.players[ctx.opponent];
    const removed = opp.deck.splice(0, Math.min(e.count, opp.deck.length));
    if (removed.length === 0) return;
    opp.discard.push(...removed);
    ctx.log(`${opp.name} discards ${removed.length} card(s) from the top of their deck`);
  },
  aiValue: (e) => e.count * 3,
});

// ── discardOpponentHandChosen ────────────────────────────────────────────────

function chosenDiscardLoop(ctx: EffectContext, count: number): void {
  if (count <= 0) return;
  const opp = ctx.players[ctx.opponent];
  if (opp.hand.length === 0) return;
  ctx.requestChoice(
    ctx.controller,
    "Choose a card in your opponent's hand to discard:",
    opp.hand.map((card) => ({
      label: card.def.name,
      informationKey: `discard-chosen:${card.def.id}`,
      aiScore: 15,
      operation: ctx.command("extra.discardOppHandChosen", { cardUid: card.uid, count }),
    }))
  );
}

defineEffect<{ op: "discardOpponentHandChosen"; count: number }>({
  op: "discardOpponentHandChosen",
  run: (e, ctx) => chosenDiscardLoop(ctx, e.count),
  aiValue: (e) => e.count * 16,
});

defineEffectCommand<{ cardUid: number; count: number }>(
  "extra.discardOppHandChosen",
  (payload, ctx) => {
    const opp = ctx.players[ctx.opponent];
    const index = opp.hand.findIndex((card) => card.uid === payload.cardUid);
    if (index === -1) return;
    const card = opp.hand.splice(index, 1)[0];
    ctx.forgetKnownCard(card.uid);
    opp.discard.push(card);
    ctx.log(`${opp.name} discards ${card.def.name}`);
    chosenDiscardLoop(ctx, payload.count - 1);
  }
);

// ── copyDefenderAbility ──────────────────────────────────────────────────────

defineEffect<{ op: "copyDefenderAbility" }>({
  op: "copyDefenderAbility",
  run: (_e, ctx) => {
    const defender = ctx.players[ctx.opponent].active;
    const src = source(ctx);
    if (!defender || !src) return;
    const power = defender.grantedPower?.power ?? defender.def.power;
    if (!power) return;
    src.grantedPower = { power, untilTurn: ctx.turnNumber + 2 };
    ctx.log(`${src.def.name} copies ${power.name} from ${defender.def.name}`);
  },
  aiValue: () => 10,
});

// ── lostZoneCostEnergy ───────────────────────────────────────────────────────

defineEffect<{
  op: "lostZoneCostEnergy";
  energyType: import("../../model/energy").EnergyType;
  costCount: number;
  max: number;
}>({
  op: "lostZoneCostEnergy",
  run: (e, ctx) => {
    const src = source(ctx);
    if (!src) return;
    const attached = src.energy.filter((c) => isEnergy(c.def) && c.def.provides.includes(e.energyType)).length;
    const used = Math.max(0, Math.min(e.max, e.costCount - attached));
    const me = ctx.players[ctx.controller];
    let moved = 0;
    for (let i = 0; i < used; i++) {
      const index = me.discard.findIndex((c) => isEnergy(c.def) && c.def.provides.includes(e.energyType));
      if (index === -1) break;
      me.lostZone.push(me.discard.splice(index, 1)[0]);
      moved++;
    }
    if (moved > 0) ctx.log(`${me.name} puts ${moved} ${e.energyType} Energy in the Lost Zone`);
  },
  aiValue: () => 0,
});

// ── retrieveFromDiscard ──────────────────────────────────────────────────────

function retrieveFromDiscardLoop(ctx: EffectContext, filter: CardFilter, count: number, thenIfDone: Effect[]): void {
  const me = ctx.players[ctx.controller];
  const candidates = me.discard.filter((c) => ctx.matchesFilter(c.def, filter));
  if (count <= 0 || candidates.length === 0) {
    if (thenIfDone.length) ctx.queueEffects(thenIfDone);
    return;
  }
  const seen = new Set<string>();
  const options: ChoiceOption[] = [];
  for (const card of candidates) {
    if (seen.has(card.def.id)) continue;
    seen.add(card.def.id);
    options.push({
      label: card.def.name,
      informationKey: `retrieve-discard:${card.def.id}`,
      aiScore: 22,
      operation: ctx.command("extra.retrieveFromDiscard", { cardId: card.def.id, filter, count, thenIfDone }),
    });
  }
  if (count > 1)
    options.push({ label: "Stop", informationKey: "stop", aiScore: -1, operation: ctx.command("extra.retrieveEnergyStop", { thenIfDone }) });
  if (options.length === 1) { ctx.queueOperation(options[0].operation); return; }
  ctx.requestChoice(ctx.controller, "Put which card from your discard pile into your hand?", options);
}

defineEffect<{ op: "retrieveFromDiscard"; filter: CardFilter; count?: number; thenIfDone?: Effect[] }>({
  op: "retrieveFromDiscard",
  run: (e, ctx) => retrieveFromDiscardLoop(ctx, e.filter, e.count ?? 1, e.thenIfDone ?? []),
  canApply: (e, ctx) => ctx.players[ctx.controller].discard.some((c) => ctx.matchesFilter(c.def, e.filter)),
  aiValue: (e) => 20 * (e.count ?? 1),
});

defineEffectCommand<{ cardId: string; filter: CardFilter; count: number; thenIfDone: Effect[] }>(
  "extra.retrieveFromDiscard",
  (payload, ctx) => {
    const player = ctx.players[ctx.controller];
    const index = player.discard.findIndex((card) => card.def.id === payload.cardId);
    if (index === -1) return;
    const card = player.discard.splice(index, 1)[0];
    player.hand.push(card);
    ctx.revealInHand(ctx.controller, card);
    ctx.log(`${card.def.name} is returned to ${player.name}'s hand`);
    retrieveFromDiscardLoop(ctx, payload.filter, payload.count - 1, payload.thenIfDone);
  }
);

// ── lookTopChooseToHand (Night Watch) ────────────────────────────────────────

defineEffect<{ op: "lookTopChooseToHand"; count: number }>({
  op: "lookTopChooseToHand",
  run: (e, ctx) => {
    const me = ctx.players[ctx.controller];
    const top = me.deck.slice(0, e.count);
    if (top.length === 0) return;
    const topUids = top.map((c) => c.uid);
    if (top.length === 1) {
      const card = me.deck.shift()!;
      me.hand.push(card);
      ctx.revealInHand(ctx.controller, card);
      ctx.log(`${me.name} puts a card into their hand`);
      return;
    }
    ctx.requestChoice(
      ctx.controller,
      "Choose a card to put into your hand (the rest go to the bottom):",
      top.map((card) => ({
        label: card.def.name,
        informationKey: `nightwatch:${card.def.id}`,
        aiScore: 20,
        operation: ctx.command("extra.nightWatchPick", { chosenUid: card.uid, topUids }),
      }))
    );
  },
  canApply: (_e, ctx) => ctx.players[ctx.controller].deck.length > 0,
  aiValue: () => 40,
});

defineEffectCommand<{ chosenUid: number; topUids: number[] }>("extra.nightWatchPick", (payload, ctx) => {
  const me = ctx.players[ctx.controller];
  const chosenIndex = me.deck.findIndex((c) => c.uid === payload.chosenUid);
  if (chosenIndex === -1) return;
  const chosen = me.deck.splice(chosenIndex, 1)[0];
  me.hand.push(chosen);
  ctx.revealInHand(ctx.controller, chosen);
  ctx.log(`${me.name} puts ${chosen.def.name} into their hand`);
  for (const uid of payload.topUids) {
    if (uid === payload.chosenUid) continue;
    const idx = me.deck.findIndex((c) => c.uid === uid);
    if (idx === -1) continue;
    me.deck.push(me.deck.splice(idx, 1)[0]);
  }
  ctx.log(`${me.name} puts the other card(s) on the bottom of their deck`);
});

// ── reorderTopDeck (Data Reorder) ────────────────────────────────────────────

defineEffect<{ op: "reorderTopDeck"; count: number }>({
  op: "reorderTopDeck",
  run: (e, ctx) => {
    const me = ctx.players[ctx.controller];
    const top = me.deck.slice(0, e.count).map((c) => c.uid);
    if (top.length <= 1) return;
    ctx.queueOperation(ctx.command("extra.reorderPick", { ordered: [], pool: top }));
  },
  canApply: (_e, ctx) => ctx.players[ctx.controller].deck.length > 1,
  aiValue: () => 6,
});

defineEffectCommand<{ ordered: number[]; pool: number[] }>("extra.reorderPick", (payload, ctx) => {
  const me = ctx.players[ctx.controller];
  if (payload.pool.length === 0) {
    for (let i = payload.ordered.length - 1; i >= 0; i--) {
      const idx = me.deck.findIndex((c) => c.uid === payload.ordered[i]);
      if (idx === -1) continue;
      me.deck.unshift(me.deck.splice(idx, 1)[0]);
    }
    ctx.log(`${me.name} rearranges the top of their deck`);
    return;
  }
  const cards = payload.pool
    .map((uid) => me.deck.find((c) => c.uid === uid))
    .filter((c): c is CardInstance => !!c);
  const options: ChoiceOption[] = cards.map((card) => ({
    label: card.def.name,
    informationKey: `reorder:${card.def.id}:${card.uid}`,
    aiScore: 5,
    operation: ctx.command("extra.reorderPick", {
      ordered: [...payload.ordered, card.uid],
      pool: payload.pool.filter((uid) => uid !== card.uid),
    }),
  }));
  if (options.length === 1) { ctx.queueOperation(options[0].operation); return; }
  ctx.requestChoice(ctx.controller, "Put which card on top next?", options);
});

// ── shiftEnergyToSelf (Shifting Melody) ──────────────────────────────────────

defineEffect<{ op: "shiftEnergyToSelf"; fromNames: string[]; becomeType?: boolean }>({
  op: "shiftEnergyToSelf",
  run: (e, ctx) => {
    const self = source(ctx);
    if (!self) return;
    const entries: Array<{ pokemon: PokemonInPlay; card: CardInstance }> = [];
    for (const { pokemon } of ctx.allInPlay(ctx.controller)) {
      if (pokemon === self) continue;
      if (!e.fromNames.some((n) => pokemon.def.name.includes(n))) continue;
      for (const card of pokemon.energy) entries.push({ pokemon, card });
    }
    if (entries.length === 0) return;
    const options: ChoiceOption[] = entries.map(({ pokemon, card }) => ({
      label: `${card.def.name} on ${pokemon.def.name}`,
      informationKey: `shift:${card.uid}`,
      aiScore: 10,
      operation: ctx.command("extra.shiftEnergy", {
        selfUid: self.card.uid, fromUid: pokemon.card.uid, cardUid: card.uid, becomeType: !!e.becomeType,
      }),
    }));
    if (options.length === 1) { ctx.queueOperation(options[0].operation); return; }
    ctx.requestChoice(ctx.controller, "Move which Energy to this Pokémon?", options);
  },
  canApply: (e, ctx) => {
    const self = source(ctx);
    if (!self) return false;
    return ctx.allInPlay(ctx.controller).some(
      ({ pokemon }) => pokemon !== self && e.fromNames.some((n) => pokemon.def.name.includes(n)) && pokemon.energy.length > 0
    );
  },
  aiValue: () => 8,
});

defineEffectCommand<{ selfUid: number; fromUid: number; cardUid: number; becomeType: boolean }>(
  "extra.shiftEnergy",
  (payload, ctx) => {
    const self = findInPlay(ctx, payload.selfUid)?.pokemon;
    const from = findInPlay(ctx, payload.fromUid)?.pokemon;
    if (!self || !from) return;
    const index = from.energy.findIndex((c) => c.uid === payload.cardUid);
    if (index === -1) return;
    const card = from.energy.splice(index, 1)[0];
    self.energy.push(card);
    ctx.log(`${card.def.name} moves from ${from.def.name} to ${self.def.name}`);
    if (payload.becomeType && isEnergy(card.def) && card.def.provides.length > 0) {
      self.typeOverride = { types: [...card.def.provides], untilTurn: ctx.turnNumber };
      ctx.log(`${self.def.name}'s type becomes ${card.def.provides.join("/")}`);
    }
  }
);

// ── rewriteEnergyType (Energy Rewrite) ───────────────────────────────────────

defineEffect<{ op: "rewriteEnergyType" }>({
  op: "rewriteEnergyType",
  run: (_e, ctx) => {
    const self = source(ctx);
    if (!self) return;
    const specials = self.energy.filter((c) => isEnergy(c.def) && !c.def.isBasic);
    if (specials.length === 0) return;
    const pick = (card: CardInstance) => {
      ctx.requestChoice(
        ctx.controller,
        `Change ${card.def.name} to provide which type?`,
        ALL_TYPES.map((type) => ({
          label: type,
          informationKey: `rewrite-type:${type}`,
          aiScore: 5,
          operation: ctx.command("extra.rewriteEnergy", { selfUid: self.card.uid, cardUid: card.uid, type }),
        }))
      );
    };
    if (specials.length === 1) { pick(specials[0]); return; }
    ctx.requestChoice(
      ctx.controller,
      "Rewrite which Special Energy?",
      specials.map((card) => ({
        label: card.def.name,
        informationKey: `rewrite-energy:${card.uid}`,
        aiScore: 5,
        operation: ctx.command("extra.rewritePick", { selfUid: self.card.uid, cardUid: card.uid }),
      }))
    );
  },
  canApply: (_e, ctx) => {
    const self = source(ctx);
    return !!self && self.energy.some((c) => isEnergy(c.def) && !c.def.isBasic);
  },
  aiValue: () => 0,
});

defineEffectCommand<{ selfUid: number; cardUid: number }>("extra.rewritePick", (payload, ctx) => {
  const self = findInPlay(ctx, payload.selfUid)?.pokemon;
  const card = self?.energy.find((c) => c.uid === payload.cardUid);
  if (!self || !card) return;
  ctx.requestChoice(
    ctx.controller,
    `Change ${card.def.name} to provide which type?`,
    ALL_TYPES.map((type: EnergyType) => ({
      label: type,
      informationKey: `rewrite-type:${type}`,
      aiScore: 5,
      operation: ctx.command("extra.rewriteEnergy", { selfUid: payload.selfUid, cardUid: payload.cardUid, type }),
    }))
  );
});

defineEffectCommand<{ selfUid: number; cardUid: number; type: EnergyType }>("extra.rewriteEnergy", (payload, ctx) => {
  const self = findInPlay(ctx, payload.selfUid)?.pokemon;
  const card = self?.energy.find((c) => c.uid === payload.cardUid);
  if (!self || !card) return;
  card.provideOverride = { types: [payload.type], untilTurn: ctx.turnNumber };
  ctx.log(`${card.def.name} now provides ${payload.type} Energy until end of turn`);
});

// ── damagePerCardInDiscards ──────────────────────────────────────────────────

defineEffect<{ op: "damagePerCardInDiscards"; base: number; damagePer: number; filter: CardFilter; both?: boolean }>({
  op: "damagePerCardInDiscards",
  run: (e, ctx) => {
    const piles = e.both ? [0, 1] : [ctx.controller];
    let matched = 0;
    for (const p of piles)
      matched += ctx.players[p].discard.filter((c) => ctx.matchesFilter(c.def, e.filter)).length;
    const total = e.base + matched * e.damagePer;
    if (total > 0 && !ctx.addAttackDamage(total)) ctx.dealDamage({ p: ctx.opponent, slot: "active" }, total);
  },
  aiValue: (e) => e.base + e.damagePer * 2,
});
