import { suite, test, assertEqual } from "../harness";
import { configuredGame, attack, resolveChoice } from "../helpers";

suite("Palkia ex", () => {
  test("Bent Space promotes Palkia ex from the Bench and switches the Defending Pokémon", () => {
    const game = configuredGame({
      attackerId: "wooper",
      defenderId: "feraligatr",
      attackerBench: [{ id: "palkia-ex" }],
      defenderBench: [{ id: "munchlax" }, { id: "slugma" }],
    });
    assertEqual(
      game.getLegalActions().some((action) => action.type === "usePower" && action.target.slot === 0),
      true,
      "Bent Space is available from the Bench"
    );
    game.perform({ type: "usePower", target: { p: 0, slot: 0 } });
    assertEqual(game.pending?.player, 1, "opponent chooses the replacement Defending Pokémon");
    resolveChoice(game, "Munchlax");
    assertEqual(game.players[0].active?.def.id, "palkia-ex", "Palkia ex became Active");
    assertEqual(game.players[0].bench[0]?.def.id, "wooper", "former Active moved to Bench");
    assertEqual(game.players[1].active?.def.id, "munchlax", "opponent's Active switched");
    assertEqual(game.current, 0, "turn continues");
  });

  test("Spatial Crush does 100 when the Defending Pokémon has Retreat Cost 2 or more", () => {
    const game = configuredGame({
      attackerId: "palkia-ex",
      defenderId: "feraligatr",
      attackerEnergy: ["water-energy", "water-energy", "water-energy"],
    });
    attack(game, "Spatial Crush");
    assertEqual(game.players[1].active?.damage, 100);
  });

  test("Spatial Crush does 60 when the Defending Pokémon has Retreat Cost below 2", () => {
    const game = configuredGame({
      attackerId: "palkia-ex",
      defenderId: "altaria",
      attackerEnergy: ["water-energy", "water-energy", "water-energy"],
    });
    attack(game, "Spatial Crush");
    assertEqual(game.players[1].active?.damage, 60);
  });
});

suite("Dialga ex", () => {
  test("Rewind does 30 and removes 3 damage counters without discarding Energy", () => {
    const game = configuredGame({
      attackerId: "dialga-ex",
      defenderId: "feraligatr",
      attackerEnergy: ["metal-energy", "metal-energy"],
      attackerDamage: 50,
    });
    attack(game, "Rewind");
    assertEqual(game.players[0].active?.damage, 20, "healed 30");
    assertEqual(game.players[0].active?.energy.length, 2, "energy kept");
    assertEqual(game.players[1].active?.damage, 30, "dealt 30");
  });

  test("Ages of Ruin does 100 and is locked during Dialga's next turn", () => {
    const game = configuredGame({
      attackerId: "dialga-ex",
      defenderId: "dark-steelix-ex",
      attackerEnergy: ["metal-energy", "metal-energy", "metal-energy", "metal-energy"],
    });
    attack(game, "Ages of Ruin");
    assertEqual(game.players[1].active?.damage, 100);
    game.perform({ type: "pass" });
    const attacks = game.getLegalActions()
      .filter((action) => action.type === "attack")
      .map((action) => game.describeAction(action));
    assertEqual(attacks.some((label) => label.includes("Ages of Ruin")), false, "Ages is locked");
    assertEqual(attacks.some((label) => label.includes("Rewind")), true, "other attacks remain usable");
  });

  test("Ages of Ruin becomes available again after the cooldown turn", () => {
    const game = configuredGame({
      attackerId: "dialga-ex",
      defenderId: "dark-steelix-ex",
      attackerEnergy: ["metal-energy", "metal-energy", "metal-energy", "metal-energy"],
    });
    attack(game, "Ages of Ruin");
    game.perform({ type: "pass" });
    game.perform({ type: "pass" });
    game.perform({ type: "pass" });
    assertEqual(
      game.getLegalActions().some((action) => action.type === "attack" && game.describeAction(action).includes("Ages of Ruin")),
      true
    );
  });
});
