import { suite, test, assertEqual } from "../harness";
import { configuredGame, attack, resolveChoice } from "../helpers";

suite("Magneton", () => {
  test("Shockwave discards all Lightning Energy and deals 50 to the Active", () => {
    const game = configuredGame({
      attackerId: "magneton",
      defenderId: "munchlax",
      attackerEnergy: ["lightning-energy", "lightning-energy", "metal-energy"],
    });
    attack(game, "Shockwave");
    assertEqual(game.players[1].active?.damage, 50, "50 damage");
    const energy = game.players[0].active?.energy ?? [];
    assertEqual(energy.filter((c) => c.def.id === "lightning-energy").length, 0, "no lightning left");
    assertEqual(energy.length, 1, "metal remains");
  });

  test("Shockwave can target a Benched Pokemon (no Weakness/Resistance)", () => {
    const game = configuredGame({
      attackerId: "magneton",
      defenderId: "munchlax",
      attackerEnergy: ["lightning-energy"],
      defenderBench: [{ id: "munchlax" }],
    });
    attack(game, "Shockwave");
    resolveChoice(game, "Bench");
    assertEqual(game.players[1].bench[0]?.damage, 50, "bench hit");
    assertEqual(game.players[1].active?.damage, 0, "active untouched");
  });
});
