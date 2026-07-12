import { suite, test, assertEqual } from "../harness";
import { configuredGame, attack } from "../helpers";

suite("Miltank", () => {
  test("Milk Drink heals another of your Pokemon, not Miltank", () => {
    const game = configuredGame({
      attackerId: "miltank",
      defenderId: "feraligatr",
      attackerDamage: 30,
      attackerBench: [{ id: "munchlax", damage: 40 }],
    });
    attack(game, "Milk Drink");
    assertEqual(game.players[0].bench[0]?.damage, 30, "benched healed 40 -> 30");
    assertEqual(game.players[0].active?.damage, 30, "Miltank unchanged");
  });

  test("Milk Drink does nothing when only Miltank is damaged", () => {
    const game = configuredGame({
      attackerId: "miltank",
      defenderId: "feraligatr",
      attackerDamage: 30,
      attackerBench: [{ id: "munchlax", damage: 0 }],
    });
    attack(game, "Milk Drink");
    assertEqual(game.players[0].active?.damage, 30);
  });
});
