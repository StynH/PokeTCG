import { suite, test, assertEqual, assertTrue } from "../harness";
import { configuredGame, attack, forceCoins } from "../helpers";

suite("Spheal", () => {
  test("Defense Curl heads sets up damage prevention", () => {
    const game = configuredGame({
      attackerId: "spheal",
      defenderId: "feraligatr",
      attackerEnergy: ["water-energy"],
    });
    forceCoins(game, true);
    attack(game, "Defense Curl");
    assertEqual(game.players[0].active?.guard?.mode, "preventAll");
  });

  test("Defense Curl tails does nothing", () => {
    const game = configuredGame({
      attackerId: "spheal",
      defenderId: "feraligatr",
      attackerEnergy: ["water-energy"],
    });
    forceCoins(game, false);
    attack(game, "Defense Curl");
    assertTrue(game.players[0].active?.guard == null, "no guard set");
  });

  test("Ice Ball does 20", () => {
    const game = configuredGame({
      attackerId: "spheal",
      defenderId: "feraligatr",
      attackerEnergy: ["water-energy", "grass-energy"],
    });
    attack(game, "Ice Ball");
    assertEqual(game.players[1].active?.damage, 20);
  });
});
