import { suite, test, assertEqual, assertTrue } from "../harness";
import { configuredGame, attack, resolveChoice } from "../helpers";

suite("Walrein", () => {
  test("Frozen Hide reduces damage from an attacker with Special Energy by 20", () => {
    const game = configuredGame({
      attackerId: "sealeo",
      defenderId: "walrein",
      attackerEnergy: ["metal-energy", "water-energy"],
    });
    attack(game, "Aurora Beam");
    assertEqual(game.players[1].active?.damage, 20, "40 - 20");
  });

  test("Frozen Hide does not reduce damage from an all-basic attacker", () => {
    const game = configuredGame({
      attackerId: "sealeo",
      defenderId: "walrein",
      attackerEnergy: ["water-energy", "water-energy"],
    });
    attack(game, "Aurora Beam");
    assertEqual(game.players[1].active?.damage, 40);
  });

  test("Frozen Current does 50 and discards an Energy when the Defender has 2 or more", () => {
    const game = configuredGame({
      attackerId: "walrein",
      defenderId: "feraligatr",
      attackerEnergy: ["water-energy", "water-energy", "grass-energy"],
      defenderEnergy: ["water-energy", "water-energy"],
    });
    attack(game, "Frozen Current");
    resolveChoice(game, "Water Energy");
    assertEqual(game.players[1].active?.damage, 50);
    assertEqual(game.players[1].active?.energy.length, 1, "one Energy discarded");
  });

  test("Frozen Current leaves a single Energy alone", () => {
    const game = configuredGame({
      attackerId: "walrein",
      defenderId: "feraligatr",
      attackerEnergy: ["water-energy", "water-energy", "grass-energy"],
      defenderEnergy: ["water-energy"],
    });
    attack(game, "Frozen Current");
    assertEqual(game.players[1].active?.energy.length, 1, "no discard with only 1 Energy");
    assertTrue(game.pending == null, "no discard prompt");
  });
});
