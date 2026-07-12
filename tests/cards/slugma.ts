import { suite, test, assertEqual } from "../harness";
import { configuredGame, attack, instance } from "../helpers";

suite("Slugma", () => {
  test("Reignite attaches the Fire Energy to Slugma itself", () => {
    const game = configuredGame({ attackerId: "slugma", defenderId: "feraligatr" });
    game.players[0].discard.push(instance("fire-energy"));
    attack(game, "Reignite");
    assertEqual(game.players[0].active?.energy.length, 1, "attached one energy");
    assertEqual(game.players[0].active?.energy[0]?.def.id, "fire-energy");
  });

  test("Reignite targets Slugma, not a Benched Pokemon", () => {
    const game = configuredGame({
      attackerId: "slugma",
      defenderId: "feraligatr",
      attackerBench: [{ id: "munchlax" }],
    });
    game.players[0].discard.push(instance("fire-energy"));
    attack(game, "Reignite");
    assertEqual(game.players[0].active?.energy.length, 1, "Slugma got the energy");
    assertEqual(game.players[0].bench[0]?.energy.length, 0, "bench untouched");
  });
});
