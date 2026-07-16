import { suite, test, assertEqual, assertTrue, assertFalse } from "../harness";
import { configuredGame, attack, instance } from "../helpers";
import type { Game } from "../../src/engine/game";
import type { PokemonCardDef } from "../../src/model/cards";
import type { SlotRef } from "../../src/core/state";

function usePower(game: Game, target: SlotRef): void {
  game.perform({ type: "usePower", target });
}

suite("Styn's Hitmonlee ★", () => {
  test("Perfect Counter with no damage counters does base 20", () => {
    const game = configuredGame({
      attackerId: "styns-hitmonlee-star",
      defenderId: "feraligatr",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
    });
    attack(game, "Perfect Counter");
    assertEqual(game.players[1].active?.damage, 20);
  });

  test("Perfect Counter adds 10 per damage counter (3 counters -> 50)", () => {
    const game = configuredGame({
      attackerId: "styns-hitmonlee-star",
      defenderId: "feraligatr",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
      attackerDamage: 30,
    });
    attack(game, "Perfect Counter");
    assertEqual(game.players[1].active?.damage, 50);
  });

  test("Perfect Counter with exactly 4 counters replaces the calculation with 100", () => {
    const game = configuredGame({
      attackerId: "styns-hitmonlee-star",
      defenderId: "dark-steelix-ex",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
      attackerDamage: 40,
    });
    attack(game, "Perfect Counter");
    assertEqual(game.players[1].active?.damage, 100, "exact-four result is 100, not 140");
  });

  test("Perfect Counter with 5 counters falls back to base 20 (-> 70)", () => {
    const game = configuredGame({
      attackerId: "styns-hitmonlee-star",
      defenderId: "feraligatr",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
      attackerDamage: 50,
    });
    attack(game, "Perfect Counter");
    assertEqual(game.players[1].active?.damage, 70);
  });

  test("Step Into the Ring switches from Bench and moves 2 counters onto Hitmonlee", () => {
    const game = configuredGame({
      attackerId: "feraligatr",
      defenderId: "feraligatr",
      attackerDamage: 30,
      attackerBench: [{ id: "styns-hitmonlee-star" }],
    });
    usePower(game, { p: 0, slot: 0 });
    assertEqual(game.players[0].active?.def.id, "styns-hitmonlee-star", "Hitmonlee is now Active");
    assertEqual(game.players[0].active?.damage, 20, "Hitmonlee gained 2 counters");
    assertEqual(game.players[0].bench[0]?.def.id, "feraligatr", "former Active benched");
    assertEqual(game.players[0].bench[0]?.damage, 10, "former Active lost 2 counters");
  });

  test("Step Into the Ring is unavailable when Active has fewer than 2 counters", () => {
    const game = configuredGame({
      attackerId: "feraligatr",
      defenderId: "feraligatr",
      attackerDamage: 10,
      attackerBench: [{ id: "styns-hitmonlee-star" }],
    });
    assertFalse(
      game.getLegalActions().some((a) => a.type === "usePower"),
      "power not offered with only 1 counter on Active"
    );
  });

  test("Step Into the Ring becomes available once Active has 2 counters", () => {
    const game = configuredGame({
      attackerId: "feraligatr",
      defenderId: "feraligatr",
      attackerDamage: 20,
      attackerBench: [{ id: "styns-hitmonlee-star" }],
    });
    assertTrue(
      game.getLegalActions().some((a) => a.type === "usePower" && a.target.slot === 0),
      "power offered with 2 counters on Active"
    );
  });

  test("Step Into the Ring is blocked while Hitmonlee has a Special Condition", () => {
    const game = configuredGame({
      attackerId: "feraligatr",
      defenderId: "feraligatr",
      attackerDamage: 30,
      attackerBench: [{ id: "styns-hitmonlee-star" }],
    });
    game.players[0].bench[0].poisonCounters = 1;
    assertFalse(
      game.getLegalActions().some((a) => a.type === "usePower"),
      "power not offered while affected by a Special Condition"
    );
  });

  test("Card metadata: Gold Star basic, 80 HP, Psychic weakness", () => {
    const def = instance("styns-hitmonlee-star").def as PokemonCardDef;
    assertEqual(def.hp, 80);
    assertTrue(def.isGoldStar === true, "isGoldStar");
    assertEqual(def.weakness, "Psychic");
    assertEqual(def.retreatCost, 1);
  });
});
