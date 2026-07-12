import { suite, test, assertEqual } from "../harness";
import { configuredGame, attack } from "../helpers";

suite("Magcargo", () => {
  test("Molten Guard reduces damage to your Fire Pokemon by 20 while Magcargo holds Fire Energy", () => {
    const game = configuredGame({
      attackerId: "munchlax",
      defenderId: "slugma",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
      defenderBench: [{ id: "magcargo", energy: ["fire-energy"] }],
    });
    attack(game, "Munch");
    assertEqual(game.players[1].active?.damage, 0, "20 - 20 -> 0");
  });

  test("Molten Guard is inactive without Fire Energy on Magcargo", () => {
    const game = configuredGame({
      attackerId: "munchlax",
      defenderId: "slugma",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
      defenderBench: [{ id: "magcargo" }],
    });
    attack(game, "Munch");
    assertEqual(game.players[1].active?.damage, 20);
  });

  test("Molten Guard does not protect non-Fire Pokemon", () => {
    const game = configuredGame({
      attackerId: "munchlax",
      defenderId: "wooper",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
      defenderBench: [{ id: "magcargo", energy: ["fire-energy"] }],
    });
    attack(game, "Munch");
    assertEqual(game.players[1].active?.damage, 20);
  });
});
