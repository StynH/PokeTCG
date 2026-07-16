import { isEnergy } from "../../model/cards";
import type { CardInstance } from "../../model/cards";
import type { EnergyType } from "../../model/energy";
import type { Effect } from "../../model/effects";
import type { SlotRef } from "../../core/state";
import type { ChoiceOption } from "../../core/choice";
import type { EffectContext } from "../context";
import { defineEffect, defineEffectCommand } from "../registry";
import {
  energyAttachmentChoiceScore,
  energyMoveSourceChoiceScore,
  energyMoveValue,
  energyRemovalChoiceScore,
  energyTransferChoiceScore,
} from "../../ai/choiceScoring";

function moveEnergyLoop(
  ctx: EffectContext,
  energyType: EnergyType | undefined,
  count: number,
  basicOnly?: boolean
): void {
  if (count <= 0) return;
  const p = ctx.controller;
  const matches = (card: CardInstance) =>
    isEnergy(card.def) &&
    (!energyType || card.def.provides.includes(energyType)) &&
    (!basicOnly || card.def.isBasic);
  const sources = ctx.allInPlay(p).filter(({ pokemon }) => pokemon.energy.some(matches));
  if (sources.length === 0) return;
  ctx.requestChoice(
    p,
    "Move Energy from which Pokemon?",
    sources.map(({ ref, pokemon }) => {
      const card = pokemon.energy.find(matches)!;
      return {
        label: ctx.describeSlot(ref),
        informationKey: `energy-source:${pokemon.card.uid}`,
        aiScore: energyMoveSourceChoiceScore(ctx, pokemon, p, card),
        operation: ctx.command("energy.chooseMoveTarget", {
          sourceUid: pokemon.card.uid, energyType, count, basicOnly,
        }),
      };
    })
  );
}

function moveEnergyFromSelf(
  ctx: EffectContext,
  energyType: EnergyType | undefined,
  count: number,
  basicOnly?: boolean,
  optional?: boolean
): void {
  const src = ctx.sourceRef ? ctx.getPokemon(ctx.sourceRef) : ctx.players[ctx.controller].active;
  if (!src) return;
  const matches = (card: CardInstance) =>
    isEnergy(card.def) && (!energyType || card.def.provides.includes(energyType)) && (!basicOnly || card.def.isBasic);
  const card = src.energy.find(matches);
  const targets = ctx.allInPlay(ctx.controller).filter(({ pokemon }) => pokemon !== src);
  if (!card || targets.length === 0) return;
  const options: ChoiceOption[] = targets.map((entry) => ({
    label: ctx.describeSlot(entry.ref),
    informationKey: `energy-target:${entry.pokemon.card.uid}`,
    aiScore: energyTransferChoiceScore(ctx, src, entry.pokemon, ctx.controller, card),
    operation: ctx.command("energy.move", {
      sourceUid: src.card.uid, targetUid: entry.pokemon.card.uid, cardUid: card.uid,
      energyType, count, basicOnly,
    }),
  }));
  if (optional)
    options.push({ label: "Don't move Energy", informationKey: "keep-energy", aiScore: -1, operation: ctx.command("energy.moveNoop", {}) });
  ctx.requestChoice(ctx.controller, "Move Energy to which Pokemon?", options);
}

defineEffectCommand("energy.moveNoop", (_payload: unknown, _ctx) => {});

defineEffect<{ op: "moveEnergy"; count: number; energyType?: EnergyType; basicOnly?: boolean; fromSelf?: boolean; optional?: boolean }>({
  op: "moveEnergy",
  run: (e, ctx) =>
    e.fromSelf
      ? moveEnergyFromSelf(ctx, e.energyType, e.count, e.basicOnly, e.optional)
      : moveEnergyLoop(ctx, e.energyType, e.count, e.basicOnly),
  canApply: (e, ctx) =>
    e.optional ||
    ctx.allInPlay(ctx.controller).some(({ pokemon }) =>
      pokemon.energy.some(
        (c) => isEnergy(c.def) && (!e.energyType || c.def.provides.includes(e.energyType)) && (!e.basicOnly || c.def.isBasic)
      )
    ),
  aiValue: (e, ctx) => energyMoveValue(
    ctx,
    ctx.controller,
    (card) => isEnergy(card.def) &&
      (!e.energyType || card.def.provides.includes(e.energyType)) &&
      (!e.basicOnly || card.def.isBasic)
  ),
});

function runDiscardSelfEnergy(
  e: { count: number | "all"; energyType?: EnergyType; thenIfDone?: Effect[] },
  ctx: EffectContext
): void {
  const source = ctx.sourceRef ? ctx.getPokemon(ctx.sourceRef) : ctx.players[ctx.controller].active;
  if (!source) return;
  const limit = e.count === "all" ? source.energy.length : e.count;
  let discarded = 0;
  for (let i = 0; i < limit; i++) {
    const index = e.energyType
      ? source.energy.findIndex(
          (en) => isEnergy(en.def) && en.def.provides.includes(e.energyType!)
        )
      : source.energy.length - 1;
    if (index === -1 || source.energy.length === 0) break;
    const removed = source.energy.splice(index, 1)[0];
    ctx.players[ctx.controller].discard.push(removed);
    ctx.log(`${source.def.name} discards ${removed.def.name}`);
    discarded++;
  }
  if (discarded > 0 && e.thenIfDone?.length) ctx.queueEffects(e.thenIfDone);
}

defineEffectCommand<{ count: number | "all"; energyType?: EnergyType; thenIfDone?: Effect[] }>(
  "energy.discardSelfOptional",
  (payload, ctx) => runDiscardSelfEnergy(payload, ctx)
);

defineEffect<{ op: "discardSelfEnergy"; count: number | "all"; energyType?: EnergyType; optional?: boolean; thenIfDone?: Effect[] }>({
  op: "discardSelfEnergy",
  run: (e, ctx) => {
    if (e.optional) {
      const source = ctx.sourceRef ? ctx.getPokemon(ctx.sourceRef) : ctx.players[ctx.controller].active;
      const payable = source?.energy.filter(
        (card) => isEnergy(card.def) && (!e.energyType || card.def.provides.includes(e.energyType))
      ).length ?? 0;
      const needed = e.count === "all" ? 1 : e.count;
      if (payable < needed) return;
      const label = e.energyType ? `${e.energyType} Energy` : "Energy";
      ctx.requestChoice(ctx.controller, `Discard ${label} from ${source!.def.name}?`, [
        {
          label: `Discard ${label}`,
          informationKey: "discard-self-energy",
          aiScore: (e.thenIfDone?.length ?? 0) > 0 ? 24 : -4,
          operation: ctx.command("energy.discardSelfOptional", {
            count: e.count, energyType: e.energyType, thenIfDone: e.thenIfDone ?? [],
          }),
        },
        {
          label: "Don't discard",
          informationKey: "keep-self-energy",
          aiScore: 0,
          operation: ctx.command("energy.discardSelfNoop", {}),
        },
      ]);
      return;
    }
    runDiscardSelfEnergy(e, ctx);
  },
  canApply: (e, ctx) => {
    if (e.optional) return true;
    const source = ctx.sourceRef ? ctx.getPokemon(ctx.sourceRef) : ctx.players[ctx.controller].active;
    if (!source) return false;
    const payable = source.energy.filter(
      (card) => isEnergy(card.def) && (!e.energyType || card.def.provides.includes(e.energyType))
    ).length;
    return e.count === "all" ? payable > 0 : payable >= e.count;
  },
  aiValue: (e) => (e.optional ? 4 : e.count === "all" ? -24 : -e.count * 8),
});

defineEffectCommand("energy.discardSelfNoop", (_payload: unknown, _ctx) => {});

function discardOppEnergyLoop(ctx: EffectContext, count: number): void {
  if (count <= 0) return;
  const defender = ctx.players[ctx.opponent].active;
  if (!defender || defender.energy.length === 0) return;
  ctx.requestChoice(
    ctx.controller,
    "Discard which Energy from the Defending Pokemon?",
    defender.energy.map((card) => ({
      label: card.def.name,
      informationKey: `discard-energy:${card.def.id}`,
      aiScore: energyRemovalChoiceScore(ctx, defender, ctx.opponent, card, true) * -1,
      operation: ctx.command("energy.discardOpponent", {
        targetUid: defender.card.uid, cardUid: card.uid, count, any: false,
      }),
    }))
  );
}

function discardOppEnergyAnyLoop(ctx: EffectContext, count: number): void {
  if (count <= 0) return;
  const targets = ctx.allInPlay(ctx.opponent).filter(({ pokemon }) => pokemon.energy.length > 0);
  if (targets.length === 0) return;
  ctx.requestChoice(
    ctx.controller,
    "Choose opponent's Pokémon to discard Energy from:",
    targets.map(({ ref, pokemon }) => ({
      label: ctx.describeSlot(ref),
      informationKey: `discard-target:${pokemon.card.uid}`,
      aiScore: pokemon.energy.reduce((s, c) => s + ctx.energyUnits(c, pokemon, ctx.opponent).count * 10, 0),
      operation: ctx.command("energy.chooseOpponentEnergy", { targetUid: pokemon.card.uid, count }),
    }))
  );
}

defineEffect<{ op: "discardOpponentEnergy"; count: number; target?: "active" | "any" }>({
  op: "discardOpponentEnergy",
  run: (e, ctx) => e.target === "any" ? discardOppEnergyAnyLoop(ctx, e.count) : discardOppEnergyLoop(ctx, e.count),
  canApply: (e, ctx) => {
    if (e.target === "any") return ctx.allInPlay(ctx.opponent).some(({ pokemon }) => pokemon.energy.length > 0);
    const defender = ctx.players[ctx.opponent].active;
    return !!defender && defender.energy.length > 0;
  },
  aiValue: (e) => e.count * 25,
});

defineEffect<{
  op: "attachEnergyFromDiscard";
  energyType?: EnergyType;
  basicOnly?: boolean;
  target: "selfBenchChoice" | "anySelfChoice" | "self";
  thenIfDone?: Effect[];
}>({
  op: "attachEnergyFromDiscard",
  run: (e, ctx) => {
    const me = ctx.players[ctx.controller];
    const discardMatches = (c: CardInstance) =>
      isEnergy(c.def) &&
      (e.energyType ? c.def.provides.includes(e.energyType) : true) &&
      (!e.basicOnly || c.def.isBasic);
    const energyIndex = me.discard.findIndex(discardMatches);
    if (energyIndex === -1) return;
    const source = ctx.sourceRef ? ctx.getPokemon(ctx.sourceRef) : me.active;
    const candidates: { ref: SlotRef; pokemon: import("../../core/state").PokemonInPlay }[] =
      e.target === "self"
        ? source
          ? [{ ref: ctx.sourceRef ?? { p: ctx.controller, slot: "active" }, pokemon: source }]
          : []
        : e.target === "selfBenchChoice"
          ? me.bench.map((pokemon, i) => ({ ref: { p: ctx.controller, slot: i } as SlotRef, pokemon }))
          : ctx.allInPlay(ctx.controller);
    if (candidates.length === 0) return;
    const energy = me.discard[energyIndex];
    const options: ChoiceOption[] = candidates.map(({ ref, pokemon }) => ({
      label: ctx.describeSlot(ref),
      informationKey: `attach:${pokemon.card.uid}`,
      aiScore: energyAttachmentChoiceScore(ctx, energy, pokemon, ctx.controller, ref.slot === "active"),
      operation: ctx.command("energy.attachFromDiscard", {
        energyType: e.energyType, basicOnly: e.basicOnly, targetUid: pokemon.card.uid,
        thenIfDone: e.thenIfDone ?? [],
      }),
    }));
    if (options.length === 1) { ctx.queueOperation(options[0].operation); return; }
    const label = e.energyType ? `${e.energyType} Energy` : "a basic Energy";
    ctx.requestChoice(ctx.controller, `Attach ${label} to which Pokemon?`, options);
  },
  canApply: (e, ctx) => {
    const me = ctx.players[ctx.controller];
    const hasEnergy = me.discard.some(
      (c) => isEnergy(c.def) && (e.energyType ? c.def.provides.includes(e.energyType) : true) && (!e.basicOnly || c.def.isBasic)
    );
    const hasTarget = e.target === "selfBenchChoice" ? me.bench.length > 0 : true;
    return hasEnergy && hasTarget;
  },
  aiValue: () => 30,
});

defineEffect<{ op: "attachEnergyFromDeck"; energyType: EnergyType; basicOnly?: boolean; targetType?: EnergyType }>({
  op: "attachEnergyFromDeck",
  run: (e, ctx) => {
    const me = ctx.players[ctx.controller];
    const matches = (c: CardInstance) =>
      isEnergy(c.def) && c.def.provides.includes(e.energyType) && (!e.basicOnly || c.def.isBasic);
    if (!me.deck.some(matches)) return;
    const candidates = ctx.allInPlay(ctx.controller).filter(
      ({ pokemon }) => !e.targetType || pokemon.def.types.includes(e.targetType)
    );
    if (candidates.length === 0) return;
    const attach = (pokemon: import("../../core/state").PokemonInPlay) => {
      const card = me.deck.splice(me.deck.findIndex(matches), 1)[0];
      pokemon.energy.push(card);
      ctx.log(`${card.def.name} attached to ${pokemon.def.name} from the deck`);
      ctx.shuffleDeck(ctx.controller);
    };
    if (candidates.length === 1) { attach(candidates[0].pokemon); return; }
    ctx.requestChoice(
      ctx.controller,
      `Attach ${e.energyType} Energy to which Pokemon?`,
      candidates.map(({ ref, pokemon }) => {
        const energy = me.deck.find(matches)!;
        return {
          label: ctx.describeSlot(ref),
          informationKey: `attach:${pokemon.card.uid}`,
          aiScore: energyAttachmentChoiceScore(ctx, energy, pokemon, ctx.controller, ref.slot === "active"),
          operation: ctx.command("energy.attachFromDeck", {
            energyType: e.energyType, basicOnly: e.basicOnly, targetUid: pokemon.card.uid,
          }),
        };
      })
    );
  },
  canApply: (e, ctx) =>
    ctx.players[ctx.controller].deck.some(
      (c) => isEnergy(c.def) && c.def.provides.includes(e.energyType) && (!e.basicOnly || c.def.isBasic)
    ) &&
    ctx.allInPlay(ctx.controller).some(
      ({ pokemon }) => !e.targetType || pokemon.def.types.includes(e.targetType)
    ),
  aiValue: () => 32,
});

defineEffect<{ op: "attachEnergyFromHand"; energyType?: EnergyType; target: "anySelfChoice" | "self" }>({
  op: "attachEnergyFromHand",
  run: (e, ctx) => {
    const me = ctx.players[ctx.controller];
    const matches = (c: CardInstance) =>
      isEnergy(c.def) && (e.energyType ? c.def.provides.includes(e.energyType) : c.def.isBasic);
    if (!me.hand.some(matches)) return;
    const source = ctx.sourceRef ? ctx.getPokemon(ctx.sourceRef) : me.active;
    const candidates =
      e.target === "self"
        ? source
          ? [{ ref: ctx.sourceRef ?? { p: ctx.controller, slot: "active" as const }, pokemon: source }]
          : []
        : ctx.allInPlay(ctx.controller);
    if (candidates.length === 0) return;
    const label = e.energyType ? `${e.energyType} Energy` : "a basic Energy";
    const attach = (pokemon: import("../../core/state").PokemonInPlay) => {
      const card = me.hand.splice(me.hand.findIndex(matches), 1)[0];
      ctx.forgetKnownCard(card.uid);
      pokemon.energy.push(card);
      ctx.log(`${card.def.name} attached to ${pokemon.def.name} from hand`);
    };
    if (candidates.length === 1) { attach(candidates[0].pokemon); return; }
    const energy = me.hand.find(matches)!;
    const options: ChoiceOption[] = candidates.map(({ ref, pokemon }) => ({
      label: ctx.describeSlot(ref),
      informationKey: `attach:${pokemon.card.uid}`,
      aiScore: energyAttachmentChoiceScore(ctx, energy, pokemon, ctx.controller, ref.slot === "active"),
      operation: ctx.command("energy.attachFromHand", {
        energyType: e.energyType, targetUid: pokemon.card.uid,
      }),
    }));
    ctx.requestChoice(ctx.controller, `Attach ${label} to which Pokemon?`, options);
  },
  canApply: (e, ctx) =>
    ctx.players[ctx.controller].hand.some(
      (c) => isEnergy(c.def) && (e.energyType ? c.def.provides.includes(e.energyType) : c.def.isBasic)
    ),
  aiValue: () => 30,
});

defineEffectCommand<{
  sourceUid: number;
  energyType?: EnergyType;
  count: number;
  basicOnly?: boolean;
}>("energy.chooseMoveTarget", (payload, ctx) => {
  const source = ctx.allInPlay(ctx.controller)
    .find(({ pokemon }) => pokemon.card.uid === payload.sourceUid)?.pokemon;
  if (!source) return;
  const matches = (card: CardInstance) =>
    isEnergy(card.def) &&
    (!payload.energyType || card.def.provides.includes(payload.energyType)) &&
    (!payload.basicOnly || card.def.isBasic);
  const card = source.energy.find(matches);
  if (!card) return;
  const targets = ctx.allInPlay(ctx.controller).filter(({ pokemon }) => pokemon !== source);
  if (targets.length === 0) return;
  ctx.requestChoice(
    ctx.controller,
    "Move Energy to which Pokemon?",
    targets.map((entry) => ({
      label: ctx.describeSlot(entry.ref),
      informationKey: `energy-target:${entry.pokemon.card.uid}`,
      aiScore: energyTransferChoiceScore(ctx, source, entry.pokemon, ctx.controller, card),
      operation: ctx.command("energy.move", {
        sourceUid: payload.sourceUid,
        targetUid: entry.pokemon.card.uid,
        cardUid: card.uid,
        energyType: payload.energyType,
        count: payload.count,
        basicOnly: payload.basicOnly,
      }),
    }))
  );
});

defineEffectCommand<{
  sourceUid: number;
  targetUid: number;
  cardUid: number;
  energyType?: EnergyType;
  count: number;
  basicOnly?: boolean;
}>("energy.move", (payload, ctx) => {
  const entries = ctx.allInPlay(ctx.controller);
  const source = entries.find(({ pokemon }) => pokemon.card.uid === payload.sourceUid)?.pokemon;
  const target = entries.find(({ pokemon }) => pokemon.card.uid === payload.targetUid)?.pokemon;
  if (!source || !target) return;
  const index = source.energy.findIndex((card) => card.uid === payload.cardUid);
  if (index === -1) return;
  const moved = source.energy.splice(index, 1)[0];
  target.energy.push(moved);
  ctx.log(`${moved.def.name} moves from ${source.def.name} to ${target.def.name}`);
  moveEnergyLoop(ctx, payload.energyType, payload.count - 1, payload.basicOnly);
});

defineEffectCommand<{ targetUid: number; count: number }>(
  "energy.chooseOpponentEnergy",
  (payload, ctx) => {
    const target = ctx.allInPlay(ctx.opponent)
      .find(({ pokemon }) => pokemon.card.uid === payload.targetUid)?.pokemon;
    if (!target || target.energy.length === 0) return;
    ctx.requestChoice(
      ctx.controller,
      "Discard which Energy?",
      target.energy.map((card) => ({
        label: card.def.name,
        informationKey: `discard-energy:${card.def.id}`,
        aiScore: -energyRemovalChoiceScore(ctx, target, ctx.opponent, card, target === ctx.players[ctx.opponent].active),
        operation: ctx.command("energy.discardOpponent", {
          targetUid: payload.targetUid,
          cardUid: card.uid,
          count: payload.count,
          any: true,
        }),
      }))
    );
  }
);

defineEffectCommand<{ targetUid: number; cardUid: number; count: number; any: boolean }>(
  "energy.discardOpponent",
  (payload, ctx) => {
    const target = ctx.allInPlay(ctx.opponent)
      .find(({ pokemon }) => pokemon.card.uid === payload.targetUid)?.pokemon;
    if (!target) return;
    const index = target.energy.findIndex((card) => card.uid === payload.cardUid);
    if (index === -1) return;
    const card = target.energy.splice(index, 1)[0];
    ctx.players[ctx.opponent].discard.push(card);
    ctx.log(`${target.def.name} loses ${card.def.name}`);
    if (payload.any) discardOppEnergyAnyLoop(ctx, payload.count - 1);
    else discardOppEnergyLoop(ctx, payload.count - 1);
  }
);

defineEffectCommand<{ energyType?: EnergyType; basicOnly?: boolean; targetUid: number; thenIfDone?: Effect[] }>(
  "energy.attachFromDiscard",
  (payload, ctx) => {
    const player = ctx.players[ctx.controller];
    const target = ctx.allInPlay(ctx.controller)
      .find(({ pokemon }) => pokemon.card.uid === payload.targetUid)?.pokemon;
    const index = player.discard.findIndex(
      (card) => isEnergy(card.def) &&
        (payload.energyType ? card.def.provides.includes(payload.energyType) : true) &&
        (!payload.basicOnly || card.def.isBasic)
    );
    if (!target || index === -1) return;
    const card = player.discard.splice(index, 1)[0];
    target.energy.push(card);
    ctx.log(`${card.def.name} attached to ${target.def.name} from the discard pile`);
    if (payload.thenIfDone?.length) ctx.queueEffects(payload.thenIfDone);
  }
);

defineEffectCommand<{
  energyType: EnergyType;
  basicOnly?: boolean;
  targetUid: number;
}>("energy.attachFromDeck", (payload, ctx) => {
  const player = ctx.players[ctx.controller];
  const target = ctx.allInPlay(ctx.controller)
    .find(({ pokemon }) => pokemon.card.uid === payload.targetUid)?.pokemon;
  const index = player.deck.findIndex(
    (card) => isEnergy(card.def) && card.def.provides.includes(payload.energyType) &&
      (!payload.basicOnly || card.def.isBasic)
  );
  if (!target || index === -1) return;
  const card = player.deck.splice(index, 1)[0];
  target.energy.push(card);
  ctx.log(`${card.def.name} attached to ${target.def.name} from the deck`);
  ctx.shuffleDeck(ctx.controller);
});

defineEffectCommand<{ energyType?: EnergyType; targetUid: number }>(
  "energy.attachFromHand",
  (payload, ctx) => {
    const player = ctx.players[ctx.controller];
    const target = ctx.allInPlay(ctx.controller)
      .find(({ pokemon }) => pokemon.card.uid === payload.targetUid)?.pokemon;
    const index = player.hand.findIndex(
      (card) => isEnergy(card.def) &&
        (payload.energyType ? card.def.provides.includes(payload.energyType) : card.def.isBasic)
    );
    if (!target || index === -1) return;
    const card = player.hand.splice(index, 1)[0];
    ctx.forgetKnownCard(card.uid);
    target.energy.push(card);
    ctx.log(`${card.def.name} attached to ${target.def.name} from hand`);
  }
);
