import { suite, test, assertEqual, assertTrue, assertFalse } from "../harness";
import { configuredGame, attack } from "../helpers";

suite("Swablu", () => {
  test("Cotton Shelter sets up a 20 damage reduction for the next turn", () => {
    const game = configuredGame({
      attackerId: "swablu",
      defenderId: "feraligatr",
      attackerEnergy: ["water-energy"],
    });
    attack(game, "Cotton Shelter");
    const guard = game.players[0].active?.guard;
    assertEqual(guard?.mode, "reduce");
    assertEqual(guard?.amount, 20);
  });
});

suite("Altaria", () => {
  test("Harmonize heals 10 from each of your Pokémon with 2+ basic Energy types", () => {
    const game = configuredGame({
      attackerId: "altaria",
      defenderId: "feraligatr",
      attackerEnergy: ["fire-energy", "water-energy"],
      attackerDamage: 20,
    });
    game.perform({ type: "usePower", target: { p: 0, slot: "active" } });
    assertEqual(game.players[0].active?.damage, 10, "healed 10");
  });

  test("Harmonize is unavailable with fewer than 2 basic Energy types", () => {
    const game = configuredGame({
      attackerId: "altaria",
      defenderId: "feraligatr",
      attackerEnergy: ["fire-energy", "fire-energy"],
      attackerDamage: 20,
    });
    assertFalse(
      game.getLegalActions().some((a) => a.type === "usePower"),
      "power not offered"
    );
  });

  test("Harmonize is available with 2 basic Energy types", () => {
    const game = configuredGame({
      attackerId: "altaria",
      defenderId: "feraligatr",
      attackerEnergy: ["fire-energy", "water-energy"],
      attackerDamage: 20,
    });
    assertTrue(game.getLegalActions().some((a) => a.type === "usePower"));
  });

  test("Harmonize is unavailable while Altaria is Benched", () => {
    const game = configuredGame({
      attackerId: "munchlax",
      defenderId: "feraligatr",
      attackerBench: [{ id: "altaria", damage: 20, energy: ["fire-energy", "water-energy"] }],
    });
    assertFalse(
      game.getLegalActions().some((a) => a.type === "usePower" && a.target.slot === 0),
      "Benched Altaria cannot use Harmonize"
    );
  });

  test("Chorus Wing does 20 times the number of basic Energy types", () => {
    const game = configuredGame({
      attackerId: "altaria",
      defenderId: "feraligatr",
      attackerEnergy: ["fire-energy", "water-energy"],
    });
    attack(game, "Chorus Wing");
    assertEqual(game.players[1].active?.damage, 40, "2 types -> 40");
  });
});
