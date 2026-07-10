import { suite, test, assertEqual } from "../harness";
import { configuredGame, attack, attachEnergy } from "../helpers";

suite("Light Regice", () => {
  test("Radiant Ice Beam deals 60 damage", () => {
    const game = configuredGame({
      attackerId: "light-regice",
      defenderId: "hitmonchan",
      attackerEnergy: ["water-energy", "water-energy", "water-energy"],
    });
    attack(game, "Radiant Ice Beam");
    assertEqual(game.players[1].active?.damage, 60);
  });

  test("Radiant Ice Beam heals 10 from your active (40 → 30)", () => {
    const game = configuredGame({
      attackerId: "light-regice",
      defenderId: "hitmonchan",
      attackerEnergy: ["water-energy", "water-energy", "water-energy"],
      attackerDamage: 40,
    });
    attack(game, "Radiant Ice Beam");
    assertEqual(game.players[0].active?.damage, 30);
  });

  test("Radiant Ice Beam heals 10 from each benched Pokemon", () => {
    const game = configuredGame({
      attackerId: "light-regice",
      defenderId: "hitmonchan",
      attackerEnergy: ["water-energy", "water-energy", "water-energy"],
      attackerDamage: 30,
      attackerBench: [
        { id: "munchlax", damage: 40 },
        { id: "wooper", damage: 20 },
      ],
    });
    attack(game, "Radiant Ice Beam");
    assertEqual(game.players[0].active?.damage, 20, "active 30 → 20");
    assertEqual(game.players[0].bench[0]?.damage, 30, "bench 0: 40 → 30");
    assertEqual(game.players[0].bench[1]?.damage, 10, "bench 1: 20 → 10");
  });

  test("Radiant Ice Beam heal floors at 0", () => {
    const game = configuredGame({
      attackerId: "light-regice",
      defenderId: "hitmonchan",
      attackerEnergy: ["water-energy", "water-energy", "water-energy"],
      attackerBench: [{ id: "munchlax", damage: 0 }],
    });
    attack(game, "Radiant Ice Beam");
    assertEqual(game.players[0].bench[0]?.damage, 0);
  });

  test("Sacred Ice heals 10 from each of your Pokemon on basic Water Energy attach", () => {
    const game = configuredGame({
      attackerId: "light-regice",
      defenderId: "hitmonchan",
      attackerDamage: 30,
      attackerBench: [{ id: "munchlax", damage: 40 }],
    });
    attachEnergy(game, "water-energy", { p: 0, slot: "active" });
    assertEqual(game.players[0].active?.damage, 20, "active 30 → 20");
    assertEqual(game.players[0].bench[0]?.damage, 30, "bench 40 → 30");
  });

  test("Sacred Ice does not trigger for non-Water basic energy", () => {
    const game = configuredGame({
      attackerId: "light-regice",
      defenderId: "hitmonchan",
      attackerDamage: 30,
      attackerBench: [{ id: "munchlax", damage: 40 }],
    });
    attachEnergy(game, "fighting-energy", { p: 0, slot: "active" });
    assertEqual(game.players[0].active?.damage, 30, "active unchanged");
    assertEqual(game.players[0].bench[0]?.damage, 40, "bench unchanged");
  });

  test("Sacred Ice heals exactly 10 per attachment (50 → 40)", () => {
    const game = configuredGame({
      attackerId: "light-regice",
      defenderId: "hitmonchan",
      attackerDamage: 50,
    });
    attachEnergy(game, "water-energy", { p: 0, slot: "active" });
    assertEqual(game.players[0].active?.damage, 40);
  });

  test("Sacred Ice: energy still attaches after trigger", () => {
    const game = configuredGame({
      attackerId: "light-regice",
      defenderId: "hitmonchan",
    });
    attachEnergy(game, "water-energy", { p: 0, slot: "active" });
    assertEqual(game.players[0].active?.energy.length, 1, "energy attached");
    assertEqual(game.players[0].hand.length, 0, "hand empty");
  });
});
