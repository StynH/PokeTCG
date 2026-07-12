import { suite, test, assertEqual } from "../harness";
import { configuredGame, attack } from "../helpers";

suite("Lairon", () => {
  test("Steel Plating reduces damage to a Benched Metal Pokemon by 20 while Lairon is Active", () => {
    const game = configuredGame({
      attackerId: "pikachu",
      defenderId: "lairon",
      attackerEnergy: ["lightning-energy", "lightning-energy"],
      defenderBench: [{ id: "aron" }],
    });
    attack(game, "Dual Bolt");
    assertEqual(game.players[1].bench[0]?.damage, 0, "benched Metal reduced 10 - 20 -> 0");
    assertEqual(game.players[1].active?.damage, 10, "Active Lairon itself is not protected");
  });

  test("Steel Plating does not protect a Benched non-Metal Pokemon", () => {
    const game = configuredGame({
      attackerId: "pikachu",
      defenderId: "lairon",
      attackerEnergy: ["lightning-energy", "lightning-energy"],
      defenderBench: [{ id: "munchlax" }],
    });
    attack(game, "Dual Bolt");
    assertEqual(game.players[1].bench[0]?.damage, 10);
  });

  test("Benched Metal Pokemon takes full damage without Lairon Active", () => {
    const game = configuredGame({
      attackerId: "pikachu",
      defenderId: "munchlax",
      attackerEnergy: ["lightning-energy", "lightning-energy"],
      defenderBench: [{ id: "aron" }],
    });
    attack(game, "Dual Bolt");
    assertEqual(game.players[1].bench[0]?.damage, 10);
  });
});
