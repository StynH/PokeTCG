import { suite, test, assertEqual, assertTrue, assertFalse } from "../harness";
import { configuredGame, attack, forceCoins, instance } from "../helpers";

suite("Cacnea Poison Spikes", () => {
  test("Poisons the Attacking Pokemon when Active Cacnea is damaged", () => {
    const game = configuredGame({
      attackerId: "munchlax",
      defenderId: "cacnea",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
    });
    attack(game, "Munch");
    assertEqual(game.players[1].active?.damage, 20, "Cacnea took the hit");
    assertEqual(game.players[0].active?.poisonCounters, 1, "attacker poisoned");
  });

  test("Triggers even if Cacnea is Knocked Out", () => {
    const game = configuredGame({
      attackerId: "munchlax",
      defenderId: "cacnea",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
      defenderDamage: 30,
    });
    attack(game, "Munch");
    assertEqual(game.players[0].active?.poisonCounters, 1);
  });
});

suite("Magmar Flame Body", () => {
  test("Heads burns the Attacking Pokemon", () => {
    const game = configuredGame({
      attackerId: "munchlax",
      defenderId: "magmar",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
    });
    forceCoins(game, true);
    attack(game, "Munch");
    assertTrue(game.players[0].active?.burned ?? false, "attacker burned");
  });

  test("Tails does not burn the Attacking Pokemon", () => {
    const game = configuredGame({
      attackerId: "munchlax",
      defenderId: "magmar",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
    });
    forceCoins(game, false);
    attack(game, "Munch");
    assertFalse(game.players[0].active?.burned ?? false);
  });
});

suite("Wobbuffet Destiny Bond", () => {
  test("Heads puts 2 damage counters on the Attacking Pokemon", () => {
    const game = configuredGame({
      attackerId: "munchlax",
      defenderId: "wobbuffet",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
    });
    forceCoins(game, true);
    attack(game, "Munch");
    assertEqual(game.players[0].active?.damage, 20);
  });

  test("Tails deals nothing back to the Attacking Pokemon", () => {
    const game = configuredGame({
      attackerId: "munchlax",
      defenderId: "wobbuffet",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
    });
    forceCoins(game, false);
    attack(game, "Munch");
    assertEqual(game.players[0].active?.damage, 0);
  });
});

suite("Cacturne Desert Veil", () => {
  test("Reduces damage from a Pokemon-ex by 20", () => {
    const game = configuredGame({
      attackerId: "regirock-ex",
      defenderId: "cacturne",
      attackerEnergy: ["fighting-energy", "fighting-energy", "fighting-energy"],
    });
    attack(game, "Hammer Arm");
    assertEqual(game.players[1].active?.damage, 40, "60 - 20 -> 40");
  });

  test("Does not reduce damage from a non-ex attacker", () => {
    const game = configuredGame({
      attackerId: "munchlax",
      defenderId: "cacturne",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
    });
    attack(game, "Munch");
    assertEqual(game.players[1].active?.damage, 20);
  });
});

suite("Magnemite Magnetic Pull", () => {
  test("Adds 1 to a Metal opponent's Retreat Cost while Magnemite is Active", () => {
    const game = configuredGame({ attackerId: "magnemite", defenderId: "aron" });
    const aron = game.players[1].active!;
    assertEqual(game.effectiveRetreatCost({ p: 1, slot: "active" }, aron), 2);
  });

  test("Does not affect a non-Metal opponent", () => {
    const game = configuredGame({ attackerId: "magnemite", defenderId: "feraligatr" });
    const target = game.players[1].active!;
    assertEqual(game.effectiveRetreatCost({ p: 1, slot: "active" }, target), 2);
  });

  test("Only applies while Magnemite is Active", () => {
    const game = configuredGame({
      attackerId: "munchlax",
      defenderId: "aron",
      attackerBench: [{ id: "magnemite" }],
    });
    const aron = game.players[1].active!;
    assertEqual(game.effectiveRetreatCost({ p: 1, slot: "active" }, aron), 1);
  });
});

suite("Murkrow Ominous Presence", () => {
  test("Opponent cannot play Supporter cards while Murkrow is Active", () => {
    const game = configuredGame({ attackerId: "munchlax", defenderId: "murkrow" });
    game.players[0].hand.push(instance("professor-birch"));
    assertFalse(game.getLegalActions().some((a) => a.type === "playTrainer"), "supporter blocked");
  });

  test("Supporter is playable without Murkrow Active", () => {
    const game = configuredGame({ attackerId: "munchlax", defenderId: "feraligatr" });
    game.players[0].hand.push(instance("professor-birch"));
    assertTrue(game.getLegalActions().some((a) => a.type === "playTrainer"), "supporter allowed");
  });
});
