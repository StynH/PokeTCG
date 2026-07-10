import { suite, test, assertEqual, assertFalse } from "../harness";
import { configuredGame, attack } from "../helpers";

suite("Regirock ex", () => {
  test("Seismic Feedback deals 20 with 0 defender energy", () => {
    const game = configuredGame({
      attackerId: "regirock-ex",
      defenderId: "feraligatr",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
    });
    attack(game, "Seismic Feedback");
    assertEqual(game.players[1].active?.damage, 20);
  });

  test("Seismic Feedback deals +10 per defender energy (20 + 10*3 = 50)", () => {
    const game = configuredGame({
      attackerId: "regirock-ex",
      defenderId: "feraligatr",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
      defenderEnergy: ["water-energy", "water-energy", "water-energy"],
    });
    attack(game, "Seismic Feedback");
    assertEqual(game.players[1].active?.damage, 50);
  });

  test("Seismic Feedback doubles scaled total on weakness ((20+10)*2 = 60 vs miltank)", () => {
    const game = configuredGame({
      attackerId: "regirock-ex",
      defenderId: "miltank",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
      defenderEnergy: ["water-energy"],
    });
    attack(game, "Seismic Feedback");
    assertEqual(game.players[1].active?.damage, 60);
  });

  test("Hammer Arm deals 60 damage", () => {
    const game = configuredGame({
      attackerId: "regirock-ex",
      defenderId: "feraligatr",
      attackerEnergy: ["fighting-energy", "fighting-energy", "fighting-energy"],
    });
    attack(game, "Hammer Arm");
    assertEqual(game.players[1].active?.damage, 60);
  });

  test("Hammer Arm sets defender retreat lock to opponent's next turn", () => {
    const game = configuredGame({
      attackerId: "regirock-ex",
      defenderId: "feraligatr",
      attackerEnergy: ["fighting-energy", "fighting-energy", "fighting-energy"],
    });
    const turnBefore = game.turnNumber;
    attack(game, "Hammer Arm");
    assertEqual(game.players[1].active?.locks.retreat, turnBefore + 1);
  });

  test("Hammer Arm: locked defender has no retreat among legal actions despite bench + energy", () => {
    const game = configuredGame({
      attackerId: "regirock-ex",
      defenderId: "feraligatr",
      attackerEnergy: ["fighting-energy", "fighting-energy", "fighting-energy"],
      defenderEnergy: ["water-energy", "water-energy", "water-energy"],
      defenderBench: [{ id: "munchlax" }],
    });
    attack(game, "Hammer Arm");
    assertFalse(game.getLegalActions().some((a) => a.type === "retreat"));
  });

  test("Solid Stone suppresses Water weakness while Fighting Energy attached (Water Gun 30, not 60)", () => {
    const game = configuredGame({
      attackerId: "totodile",
      defenderId: "regirock-ex",
      attackerEnergy: ["water-energy", "water-energy"],
      defenderEnergy: ["fighting-energy"],
    });
    attack(game, "Water Gun");
    assertEqual(game.players[1].active?.damage, 30);
  });

  test("Water weakness applies normally without Fighting Energy (Water Gun 30*2 = 60)", () => {
    const game = configuredGame({
      attackerId: "totodile",
      defenderId: "regirock-ex",
      attackerEnergy: ["water-energy", "water-energy"],
    });
    attack(game, "Water Gun");
    assertEqual(game.players[1].active?.damage, 60);
  });
});
