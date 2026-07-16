import { suite, test, assertEqual } from "../harness";
import { configuredGame, attack } from "../helpers";

suite("Nidoqueen", () => {
  test("Royal Escort lowers the Retreat Cost of the Nidoran family", () => {
    const game = configuredGame({
      attackerId: "nidoqueen",
      defenderId: "feraligatr",
      attackerBench: [{ id: "nidorino" }, { id: "munchlax" }],
    });
    const nidorino = game.players[0].bench[0]!;
    const munchlax = game.players[0].bench[1]!;
    assertEqual(game.effectiveRetreatCost({ p: 0, slot: 0 }, nidorino), 1, "Nidorino 2 - 1");
    assertEqual(game.effectiveRetreatCost({ p: 0, slot: "active" }, game.players[0].active!), 2, "Nidoqueen 3 - 1");
    assertEqual(
      game.effectiveRetreatCost({ p: 0, slot: 1 }, munchlax),
      munchlax.def.retreatCost,
      "unrelated Pokémon unaffected"
    );
  });

  test("Royal Command does 40 without Nidoking", () => {
    const game = configuredGame({
      attackerId: "nidoqueen",
      defenderId: "feraligatr",
      attackerEnergy: ["grass-energy", "grass-energy", "grass-energy"],
    });
    attack(game, "Royal Command");
    assertEqual(game.players[1].active?.damage, 40);
  });

  test("Royal Command does 70 with Nidoking in play", () => {
    const game = configuredGame({
      attackerId: "nidoqueen",
      defenderId: "feraligatr",
      attackerEnergy: ["grass-energy", "grass-energy", "grass-energy"],
      attackerBench: [{ id: "nidoking-ex" }],
    });
    attack(game, "Royal Command");
    assertEqual(game.players[1].active?.damage, 70, "40 + 30");
  });
});
