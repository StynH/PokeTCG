import { suite, test, assertEqual } from "../harness";
import { configuredGame, attack } from "../helpers";

suite("Pikachu", () => {
  test("Dual Bolt does 10 to each opponent Pokemon", () => {
    const game = configuredGame({
      attackerId: "pikachu",
      defenderId: "wooper",
      attackerEnergy: ["lightning-energy", "lightning-energy"],
      defenderBench: [{ id: "wooper" }],
    });
    attack(game, "Dual Bolt");
    assertEqual(game.players[1].active?.damage, 10, "active");
    assertEqual(game.players[1].bench[0]?.damage, 10, "bench");
  });

  test("Dual Bolt does 20 to each when Pichu is on your Bench", () => {
    const game = configuredGame({
      attackerId: "pikachu",
      defenderId: "wooper",
      attackerEnergy: ["lightning-energy", "lightning-energy"],
      attackerBench: [{ id: "pichu" }],
      defenderBench: [{ id: "wooper" }],
    });
    attack(game, "Dual Bolt");
    assertEqual(game.players[1].active?.damage, 20, "active");
    assertEqual(game.players[1].bench[0]?.damage, 20, "bench");
  });
});
