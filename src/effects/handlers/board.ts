import { isEnergy } from "../../model/cards";
import type { EnergyCardDef, PokemonCardDef } from "../../model/cards";
import type { Effect } from "../../model/effects";
import type { ChoiceOption, EffectContext } from "../context";
import { defineEffect } from "../registry";
import { pokemonBattleScore } from "../../ai/choiceScoring";

defineEffect<{ op: "switchSelf"; optional?: boolean }>({
  op: "switchSelf",
  run: (e, ctx) => {
    const me = ctx.players[ctx.controller];
    if (me.bench.length === 0 || !me.active) return;
    const options: ChoiceOption[] = me.bench.map((pokemon, i) => ({
      label: pokemon.def.name,
      aiScore: pokemonBattleScore(ctx, pokemon, ctx.controller, true),
      apply: () => {
        ctx.swapActive(ctx.controller, i);
        ctx.log(`${me.name} switches to ${pokemon.def.name}`, "switch", {
          player: ctx.controller,
          uid: pokemon.card.uid,
        });
      },
    }));
    if (e.optional) {
      options.push({
        label: "Don't switch",
        aiScore: pokemonBattleScore(ctx, me.active, ctx.controller, true) + 12,
        apply: () => {},
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

defineEffect<{ op: "gustOpponent"; optional?: boolean; thenIfSwitched?: Effect[] }>({
  op: "gustOpponent",
  run: (e, ctx) => {
    const opp = ctx.players[ctx.opponent];
    if (opp.bench.length === 0 || !opp.active) return;
    const options: ChoiceOption[] = opp.bench.map((pokemon, i) => ({
      label: pokemon.def.name,
      aiScore: pokemon.damage,
      apply: () => {
        ctx.swapActive(ctx.opponent, i);
        ctx.log(`${pokemon.def.name} is dragged to the Active spot`, "switch", {
          player: ctx.opponent,
          uid: pokemon.card.uid,
        });
        if (e.thenIfSwitched?.length) ctx.queueEffects(e.thenIfSwitched);
      },
    }));
    if (e.optional) options.push({ label: "Don't switch", aiScore: -1, apply: () => {} });
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
        aiScore: pokemon.damage - (ref.slot === "active" ? 20 : 0),
        apply: () => {
          const player = ctx.players[ctx.controller];
          player.hand.push(pokemon.card, ...pokemon.underneath, ...pokemon.energy);
          if (pokemon.tool) player.hand.push(pokemon.tool);
          if (player.active === pokemon) player.active = null;
          player.bench = player.bench.filter((b) => b !== pokemon);
          ctx.log(`${pokemon.def.name} returns to ${player.name}'s hand`);
        },
      }))
    );
  },
  canApply: (_e, ctx) => ctx.allInPlay(ctx.controller).length > 0,
  aiValue: () => 20,
});

function moveDamageLoop(ctx: EffectContext, count: number): void {
  if (count <= 0) return;
  const sources = [...ctx.allInPlay(0), ...ctx.allInPlay(1)].filter(
    ({ pokemon }) => pokemon.damage > 0
  );
  if (sources.length === 0) return;
  ctx.requestChoice(
    ctx.controller,
    "Move a damage counter from which Pokemon?",
    sources.map(({ ref, pokemon }) => ({
      label: `${ctx.players[ref.p].name}'s ${ctx.describeSlot(ref)} — ${pokemon.damage} damage`,
      aiScore: ref.p === ctx.controller ? pokemon.damage : 0,
      apply: () => {
        ctx.queueThunk(() => {
          const targets = [...ctx.allInPlay(0), ...ctx.allInPlay(1)].filter(
            (entry) => entry.pokemon !== pokemon
          );
          if (targets.length === 0) return;
          ctx.requestChoice(
            ctx.controller,
            "Move it to which Pokemon?",
            targets.map((entry) => ({
              label: `${ctx.players[entry.ref.p].name}'s ${ctx.describeSlot(entry.ref)}`,
              aiScore:
                entry.ref.p !== ctx.controller
                  ? entry.pokemon.damage + 10
                  : -entry.pokemon.damage,
              apply: () => {
                pokemon.damage -= 10;
                entry.pokemon.damage += 10;
                ctx.log(
                  `A damage counter moves from ${pokemon.def.name} to ${entry.pokemon.def.name}`
                );
                ctx.queueThunk(() => moveDamageLoop(ctx, count - 1));
              },
            }))
          );
        });
      },
    }))
  );
}

defineEffect<{ op: "moveDamageCounters"; count: number }>({
  op: "moveDamageCounters",
  run: (e, ctx) => moveDamageLoop(ctx, e.count),
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
        aiScore: (stage2.def as PokemonCardDef).hp,
        apply: () => {
          const player = ctx.players[ctx.controller];
          const index = player.hand.findIndex((c) => c.uid === stage2.uid);
          if (index === -1) return;
          const card = player.hand.splice(index, 1)[0];
          ctx.evolvePokemon(pokemon, card);
          ctx.log(
            `Rare Candy: ${pokemon.underneath[pokemon.underneath.length - 1].def.name} becomes ${card.def.name}`
          );
        },
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
  aiValue: (e) => {
    let val = 0;
    for (const sub of e.heads) {
      if (sub.op === "applyCondition" || sub.op === "applyPoison" || sub.op === "applyBurn")
        val += 12;
      if (sub.op === "damage") val += (sub as { op: "damage"; amount: number }).amount / 2;
    }
    return val;
  },
});
