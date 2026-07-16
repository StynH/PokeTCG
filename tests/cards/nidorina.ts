import { suite, test, assertEqual, assertFalse } from "../harness";
import { configuredGame, attack, forceCoinSequence } from "../helpers";

suite("Nidorina", () => {
  test("Family Care removes a damage counter from a family member", () => {
    const game = configuredGame({
      attackerId: "nidorina",
      defenderId: "feraligatr",
      attackerBench: [{ id: "nidoran-m", damage: 20 }],
    });
    game.perform({ type: "usePower", target: { p: 0, slot: "active" } });
    assertEqual(game.players[0].bench[0]?.damage, 10, "healed 1 counter");
  });

  test("Family Care is blocked by a Special Condition", () => {
    const game = configuredGame({
      attackerId: "nidorina",
      defenderId: "feraligatr",
      attackerBench: [{ id: "nidoran-m", damage: 20 }],
    });
    game.players[0].active!.condition = "asleep";
    assertFalse(game.getLegalActions().some((a) => a.type === "usePower"), "power not offered");
  });

  test("Double Kick does 20 times heads", () => {
    const game = configuredGame({
      attackerId: "nidorina",
      defenderId: "feraligatr",
      attackerEnergy: ["grass-energy", "grass-energy"],
    });
    forceCoinSequence(game, [true, true]);
    attack(game, "Double Kick");
    assertEqual(game.players[1].active?.damage, 40);
  });

  test("Double Kick does 20 on one head", () => {
    const game = configuredGame({
      attackerId: "nidorina",
      defenderId: "feraligatr",
      attackerEnergy: ["grass-energy", "grass-energy"],
    });
    forceCoinSequence(game, [true, false]);
    attack(game, "Double Kick");
    assertEqual(game.players[1].active?.damage, 20);
  });
});
