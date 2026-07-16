import { suite, test, assertEqual } from "../harness";
import { configuredGame, attack, forceCoins } from "../helpers";

suite("Snorlax", () => {
  test("Resting Press does 70 and puts Snorlax to Sleep", () => {
    const game = configuredGame({
      attackerId: "snorlax",
      defenderId: "feraligatr",
      attackerEnergy: ["grass-energy", "grass-energy", "grass-energy"],
    });
    forceCoins(game, false);
    attack(game, "Resting Press");
    assertEqual(game.players[1].active?.damage, 70);
    assertEqual(game.players[0].active?.condition, "asleep", "Snorlax fell Asleep");
  });

  test("Deep Sleep reduces damage by 30 while Snorlax is Asleep", () => {
    const game = configuredGame({
      attackerId: "sealeo",
      defenderId: "snorlax",
      attackerEnergy: ["water-energy", "water-energy", "grass-energy"],
    });
    game.players[1].active!.condition = "asleep";
    attack(game, "Aurora Beam");
    assertEqual(game.players[1].active?.damage, 10, "40 - 30");
  });

  test("Deep Sleep does nothing while Snorlax is awake", () => {
    const game = configuredGame({
      attackerId: "sealeo",
      defenderId: "snorlax",
      attackerEnergy: ["water-energy", "water-energy", "grass-energy"],
    });
    attack(game, "Aurora Beam");
    assertEqual(game.players[1].active?.damage, 40);
  });
});
