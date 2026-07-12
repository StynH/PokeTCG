import { suite, test, assertEqual, assertTrue } from "../harness";
import { configuredGame, attack, resolveChoice } from "../helpers";

suite("Gligar", () => {
  test("Scorpio Grip poisons the new Defending Pokemon when you switch", () => {
    const game = configuredGame({
      attackerId: "gligar",
      defenderId: "feraligatr",
      defenderBench: [{ id: "munchlax" }],
    });
    attack(game, "Scorpio Grip");
    resolveChoice(game, "Munchlax");
    assertEqual(game.players[1].active?.def.id, "munchlax", "switched in");
    assertEqual(game.players[1].active?.poisonCounters, 1, "new active poisoned");
  });

  test("Scorpio Grip does not poison when you decline the switch", () => {
    const game = configuredGame({
      attackerId: "gligar",
      defenderId: "feraligatr",
      defenderBench: [{ id: "munchlax" }],
    });
    attack(game, "Scorpio Grip");
    resolveChoice(game, "Don't switch");
    assertEqual(game.players[1].active?.def.id, "feraligatr", "no switch");
    assertEqual(game.players[1].active?.poisonCounters, 0, "not poisoned");
    assertTrue((game.players[1].active?.damage ?? 0) >= 10, "still took the 10 damage");
  });
});
