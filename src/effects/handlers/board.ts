import { isEnergy } from "../../model/cards";
import type { EnergyCardDef, PokemonCardDef } from "../../model/cards";
import type { Effect } from "../../model/effects";
import type { ChoiceOption, EffectContext } from "../context";
import { defineEffect, defineEffectCommand, effectsAiValue } from "../registry";
import { gustChoiceScore, pokemonBattleScore, scoopUpChoiceScore } from "../../ai/choiceScoring";

defineEffect<{ op: "switchSelf"; optional?: boolean }>({
  op: "switchSelf",
  run: (e, ctx) => {
    const me = ctx.players[ctx.controller];
    if (me.bench.length === 0 || !me.active) return;
    const options: ChoiceOption[] = me.bench.map((pokemon, i) => ({
      label: ctx.describeSlot({ p: ctx.controller, slot: i }),
      informationKey: `switch:${pokemon.card.uid}`,
      aiScore: pokemonBattleScore(ctx, pokemon, ctx.controller, true),
      operation: { kind: "system", operation: { op: "switchPokemon", player: ctx.controller, pokemonUid: pokemon.card.uid } },
    }));
    if (e.optional) {
      options.push({
        label: "Don't switch",
        informationKey: "do-not-switch",
        aiScore: pokemonBattleScore(ctx, me.active, ctx.controller, true) + 12,
        operation: ctx.command("board.noop", {}),
      });
    }
    ctx.requestChoice(ctx.controller, "Switch to which Pokemon?", options);
  },
  canApply: (_e, ctx) =>
    ctx.players[ctx.controller].bench.length > 0 && ctx.players[ctx.controller].active !== null,
  aiValue: (_e, ctx) => {
    const me = ctx.players[ctx.controller];
    if (!me.active || me.bench.length === 0) return -40;
    const current = pokemonBattleScore(ctx, me.active, ctx.controller, true);
    const bestBench = Math.max(
      ...me.bench.map((pokemon) => pokemonBattleScore(ctx, pokemon, ctx.controller, true))
    );
    const improvement = bestBench - current;
    return improvement > 10 ? 24 + improvement * 0.35 : -18;
  },
});

defineEffect<{ op: "promoteSelfToActive"; moveDamageCounters?: number }>({
  op: "promoteSelfToActive",
  run: (e, ctx) => {
    const me = ctx.players[ctx.controller];
    const self = ctx.sourceRef ? ctx.getPokemon(ctx.sourceRef) : null;
    const displaced = me.active;
    if (!self || !displaced || self === displaced) return;
    const index = me.bench.indexOf(self);
    if (index < 0) return;
    ctx.swapActive(ctx.controller, index);
    ctx.log(`${self.def.name} switches into the Active spot`, "switch", {
      player: ctx.controller,
      uid: self.card.uid,
    });
    const move = Math.min(displaced.damage, (e.moveDamageCounters ?? 0) * 10);
    if (move > 0) {
      displaced.damage -= move;
      self.damage += move;
      ctx.log(`${move / 10} damage counter(s) move from ${displaced.def.name} to ${self.def.name}`);
    }
  },
  canApply: (_e, ctx) => {
    const me = ctx.players[ctx.controller];
    const self = ctx.sourceRef ? ctx.getPokemon(ctx.sourceRef) : null;
    return !!self && !!me.active && me.active !== self && me.bench.includes(self);
  },
  aiValue: () => 22,
});

defineEffect<{ op: "switchOpponent" }>({
  op: "switchOpponent",
  run: (_e, ctx) => ctx.queueSwitchChoice(ctx.opponent),
  canApply: (_e, ctx) => {
    const opponent = ctx.players[ctx.opponent];
    return opponent.active !== null && opponent.bench.length > 0;
  },
  aiValue: () => 10,
});

defineEffect<{ op: "gustOpponent"; optional?: boolean; thenIfSwitched?: Effect[] }>({
  op: "gustOpponent",
  run: (e, ctx) => {
    const opp = ctx.players[ctx.opponent];
    if (opp.bench.length === 0 || !opp.active) return;
    const options: ChoiceOption[] = opp.bench.map((pokemon, i) => ({
      label: ctx.describeSlot({ p: ctx.opponent, slot: i }),
      informationKey: `gust:${pokemon.card.uid}`,
      aiScore: gustChoiceScore(ctx, pokemon, ctx.opponent),
      operation: ctx.command("board.gust", {
        player: ctx.opponent,
        pokemonUid: pokemon.card.uid,
        thenIfSwitched: e.thenIfSwitched ?? [],
      }),
    }));
    if (e.optional) {
      options.push({
        label: "Don't switch",
        informationKey: "do-not-switch",
        aiScore: -1,
        operation: ctx.command("board.noop", {}),
      });
    }
    ctx.requestChoice(ctx.controller, "Bring which Pokemon to the Active spot?", options);
  },
  canApply: (_e, ctx) => ctx.players[ctx.opponent].bench.length > 0,
  aiValue: () => 30,
});

defineEffect<{ op: "warpPoint" }>({
  op: "warpPoint",
  run: (_e, ctx) => {
    ctx.queueSwitchChoice(ctx.controller);
    ctx.queueSwitchChoice(ctx.opponent);
  },
  canApply: (_e, ctx) =>
    ctx.players[ctx.controller].bench.length > 0 || ctx.players[ctx.opponent].bench.length > 0,
  aiValue: () => 15,
});

defineEffect<{ op: "scoopUp" }>({
  op: "scoopUp",
  run: (_e, ctx) => {
    const candidates = ctx.allInPlay(ctx.controller);
    if (candidates.length === 0) return;
    ctx.requestChoice(
      ctx.controller,
      "Return which Pokemon to your hand?",
      candidates.map(({ ref, pokemon }) => ({
        label: `${ctx.describeSlot(ref)} — ${pokemon.damage} damage`,
        informationKey: `scoop:${pokemon.card.uid}`,
        aiScore: scoopUpChoiceScore(ctx, pokemon, ctx.controller, ref.slot === "active"),
        operation: ctx.command("board.scoop", { pokemonUid: pokemon.card.uid }),
      }))
    );
  },
  canApply: (_e, ctx) => ctx.allInPlay(ctx.controller).length > 0,
  aiValue: () => 20,
});

function moveDamageLoop(ctx: EffectContext, count: number, ownOnly?: boolean): void {
  if (count <= 0) return;
  const pool = ownOnly ? ctx.allInPlay(ctx.controller) : [...ctx.allInPlay(0), ...ctx.allInPlay(1)];
  const sources = pool.filter(({ pokemon }) => pokemon.damage > 0);
  if (sources.length === 0) return;
  if (ownOnly && ctx.allInPlay(ctx.controller).length < 2) return;
  ctx.requestChoice(
    ctx.controller,
    "Move a damage counter from which Pokemon?",
    sources.map(({ ref, pokemon }) => ({
      label: `${ctx.players[ref.p].name}'s ${ctx.describeSlot(ref)} — ${pokemon.damage} damage`,
      aiScore: ref.p === ctx.controller ? pokemon.damage : 0,
      informationKey: `damage-source:${pokemon.card.uid}`,
      operation: ctx.command("board.chooseDamageTarget", { sourceUid: pokemon.card.uid, count, ownOnly: !!ownOnly }),
    }))
  );
}

defineEffect<{ op: "moveDamageCounters"; count: number; ownOnly?: boolean }>({
  op: "moveDamageCounters",
  run: (e, ctx) => moveDamageLoop(ctx, e.count, e.ownOnly),
  canApply: (e, ctx) => {
    if (!e.ownOnly) return true;
    const mine = ctx.allInPlay(ctx.controller);
    return mine.length >= 2 && mine.some(({ pokemon }) => pokemon.damage > 0);
  },
  aiValue: () => 20,
});

defineEffect<{ op: "devolveDefending" }>({
  op: "devolveDefending",
  run: (_e, ctx) => {
    const target = ctx.players[ctx.opponent].active;
    if (!target || target.underneath.length === 0) return;
    const removed = target.card;
    const previous = target.underneath.pop()!;
    target.card = previous;
    target.def = previous.def as PokemonCardDef;
    target.condition = null;
    target.poisonCounters = 0;
    target.burned = false;
    target.guard = null;
    target.locks = {};
    target.evolvedTurn = null;
    ctx.players[ctx.opponent].hand.push(removed);
    ctx.revealInHand(ctx.opponent, removed);
    ctx.log(`${removed.def.name} devolves into ${target.def.name}`);
    const invalid = target.energy.filter(
      (e) => isEnergy(e.def) && (e.def as EnergyCardDef).attachRequiresEvolved
    );
    for (const e of invalid) {
      target.energy.splice(target.energy.indexOf(e), 1);
      ctx.players[ctx.opponent].discard.push(e);
      ctx.log(`${e.def.name} is discarded (${target.def.name} is no longer Evolved)`);
    }
  },
  aiValue: () => 25,
});

defineEffect<{ op: "rareCandy" }>({
  op: "rareCandy",
  run: (_e, ctx) => {
    const pairs = ctx.rareCandyPairs(ctx.controller);
    if (pairs.length === 0) return;
    ctx.requestChoice(
      ctx.controller,
      "Evolve which Pokemon?",
      pairs.map(({ ref, pokemon, stage2 }) => ({
        label: `${ctx.describeSlot(ref)} → ${stage2.def.name}`,
        informationKey: `rare-candy:${pokemon.card.uid}:${stage2.def.id}`,
        aiScore: (stage2.def as PokemonCardDef).hp,
        operation: ctx.command("board.rareCandy", { pokemonUid: pokemon.card.uid, stage2Uid: stage2.uid }),
      }))
    );
  },
  canApply: (_e, ctx) => ctx.rareCandyPairs(ctx.controller).length > 0,
  aiValue: () => 83,
});

defineEffect<{ op: "healAllYours"; amount: number }>({
  op: "healAllYours",
  run: (e, ctx) => {
    for (const { pokemon } of ctx.allInPlay(ctx.controller)) {
      if (pokemon.damage > 0) {
        const actual = Math.min(pokemon.damage, e.amount);
        pokemon.damage -= actual;
        ctx.log(`${pokemon.def.name} heals ${actual} damage`, "heal", { uid: pokemon.card.uid, amount: actual });
      }
    }
  },
  canApply: (_e, ctx) => ctx.allInPlay(ctx.controller).some(({ pokemon }) => pokemon.damage > 0),
  aiValue: (e, ctx) => {
    const count = ctx.allInPlay(ctx.controller).filter(({ pokemon }) => pokemon.damage >= e.amount).length;
    return count * e.amount * 0.25;
  },
});

defineEffect<{ op: "flip"; heads: Effect[]; tails: Effect[] }>({
  op: "flip",
  run: (e, ctx) => {
    const heads = ctx.flip("Coin flip");
    ctx.queueEffects(heads ? e.heads : e.tails);
  },
  aiValue: (e, ctx) =>
    (effectsAiValue(e.heads, ctx) + effectsAiValue(e.tails, ctx)) / 2,
});

defineEffectCommand("board.noop", () => {});

defineEffectCommand<{ player: number; pokemonUid: number; thenIfSwitched: Effect[] }>(
  "board.gust",
  (payload, ctx) => {
    const player = ctx.players[payload.player];
    const index = player.bench.findIndex(
      (pokemon) => pokemon.card.uid === payload.pokemonUid
    );
    if (index < 0) return;
    const pokemon = player.bench[index];
    ctx.swapActive(payload.player, index);
    ctx.log(`${pokemon.def.name} is dragged to the Active spot`, "switch", {
      player: payload.player,
      uid: pokemon.card.uid,
    });
    if (payload.thenIfSwitched.length) ctx.queueEffects(payload.thenIfSwitched);
  }
);

defineEffectCommand<{ pokemonUid: number }>("board.scoop", (payload, ctx) => {
  const entry = ctx.allInPlay(ctx.controller).find(({ pokemon }) => pokemon.card.uid === payload.pokemonUid);
  if (!entry) return;
  const player = ctx.players[ctx.controller];
  const pokemon = entry.pokemon;
  player.hand.push(pokemon.card, ...pokemon.underneath, ...pokemon.energy);
  if (pokemon.tool) player.hand.push(pokemon.tool);
  for (const card of [
    pokemon.card,
    ...pokemon.underneath,
    ...pokemon.energy,
    ...(pokemon.tool ? [pokemon.tool] : []),
  ]) ctx.revealInHand(ctx.controller, card);
  if (player.active === pokemon) player.active = null;
  player.bench = player.bench.filter((candidate) => candidate !== pokemon);
  ctx.log(`${pokemon.def.name} returns to ${player.name}'s hand`);
});

defineEffectCommand<{ sourceUid: number; count: number; ownOnly?: boolean }>(
  "board.chooseDamageTarget",
  (payload, ctx) => {
    const pool = payload.ownOnly ? ctx.allInPlay(ctx.controller) : [...ctx.allInPlay(0), ...ctx.allInPlay(1)];
    const source = pool.find(({ pokemon }) => pokemon.card.uid === payload.sourceUid);
    if (!source || source.pokemon.damage <= 0) return;
    const targets = pool.filter(({ pokemon }) => pokemon.card.uid !== payload.sourceUid);
    if (targets.length === 0) return;
    ctx.requestChoice(
      ctx.controller,
      "Move it to which Pokemon?",
      targets.map((entry) => ({
        label: `${ctx.players[entry.ref.p].name}'s ${ctx.describeSlot(entry.ref)}`,
        informationKey: `damage-target:${entry.pokemon.card.uid}`,
        aiScore: entry.ref.p !== ctx.controller ? entry.pokemon.damage + 10 : -entry.pokemon.damage,
        operation: ctx.command("board.moveDamage", {
          sourceUid: payload.sourceUid,
          targetUid: entry.pokemon.card.uid,
          count: payload.count,
          ownOnly: !!payload.ownOnly,
        }),
      }))
    );
  }
);

defineEffectCommand<{ sourceUid: number; targetUid: number; count: number; ownOnly?: boolean }>(
  "board.moveDamage",
  (payload, ctx) => {
    const entries = [...ctx.allInPlay(0), ...ctx.allInPlay(1)];
    const source = entries.find(({ pokemon }) => pokemon.card.uid === payload.sourceUid)?.pokemon;
    const target = entries.find(({ pokemon }) => pokemon.card.uid === payload.targetUid)?.pokemon;
    if (!source || !target || source.damage <= 0) return;
    source.damage -= 10;
    target.damage += 10;
    ctx.log(`A damage counter moves from ${source.def.name} to ${target.def.name}`);
    moveDamageLoop(ctx, payload.count - 1, payload.ownOnly);
  }
);

defineEffectCommand<{ pokemonUid: number; stage2Uid: number }>(
  "board.rareCandy",
  (payload, ctx) => {
    const player = ctx.players[ctx.controller];
    const pokemon = ctx.allInPlay(ctx.controller)
      .find((entry) => entry.pokemon.card.uid === payload.pokemonUid)?.pokemon;
    const index = player.hand.findIndex((card) => card.uid === payload.stage2Uid);
    if (!pokemon || index === -1) return;
    const card = player.hand.splice(index, 1)[0];
    ctx.forgetKnownCard(card.uid);
    ctx.evolvePokemon(pokemon, card);
    ctx.log(
      `Rare Candy: ${pokemon.underneath[pokemon.underneath.length - 1].def.name} becomes ${card.def.name}`
    );
  }
);
