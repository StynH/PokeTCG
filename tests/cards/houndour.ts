import { suite, test, assertEqual, assertTrue, assertFalse } from "../harness";
import { configuredGame, attack, forceCoins } from "../helpers";

suite("Houndour", () => {
  test("is both Darkness and Fire type", () => {
    const game = configuredGame({ attackerId: "houndour", defenderId: "feraligatr" });
    const types = game.players[0].active!.def.types;
    assertTrue(types.includes("Darkness") && types.includes("Fire"), "dual type");
  });

  test("Smoldering Bite heads does 10 and Burns", () => {
    const game = configuredGame({
      attackerId: "houndour",
      defenderId: "feraligatr",
      attackerEnergy: ["fire-energy"],
    });
    forceCoins(game, true);
    attack(game, "Smoldering Bite");
    assertEqual(game.players[1].active?.damage, 10);
    assertTrue(game.players[1].active?.burned ?? false, "defender Burned");
  });

  test("Smoldering Bite tails does 10 without Burn", () => {
    const game = configuredGame({
      attackerId: "houndour",
      defenderId: "feraligatr",
      attackerEnergy: ["fire-energy"],
    });
    forceCoins(game, false);
    attack(game, "Smoldering Bite");
    assertEqual(game.players[1].active?.damage, 10);
    assertFalse(game.players[1].active?.burned ?? false);
  });
});
