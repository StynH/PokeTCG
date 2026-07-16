import { suite, test, assertEqual, assertTrue } from "../harness";
import { configuredGame, attack, resolveChoice, attachEnergy, forceCoins, forceCoinSequence, instance } from "../helpers";
import type { PokemonCardDef } from "../../src/model/cards";

suite("Dark Mewtwo ex", () => {
  test("Psychic Contamination counters the Defending Pokémon when opponent attaches Energy", () => {
    const game = configuredGame({ attackerId: "feraligatr", defenderId: "dark-mewtwo-ex" });
    attachEnergy(game, "water-energy", { p: 0, slot: "active" });
    assertEqual(game.players[0].active?.damage, 10, "1 damage counter placed");
  });

  test("Psychic Contamination does not trigger while Dark Mewtwo ex is Benched", () => {
    const game = configuredGame({
      attackerId: "feraligatr",
      defenderId: "feraligatr",
      defenderBench: [{ id: "dark-mewtwo-ex" }],
    });
    attachEnergy(game, "water-energy", { p: 0, slot: "active" });
    assertEqual(game.players[0].active?.damage, 0);
  });

  test("Amnesia does 20 and locks only the chosen attack next turn", () => {
    const game = configuredGame({
      attackerId: "dark-mewtwo-ex",
      defenderId: "hypno",
      attackerEnergy: ["psychic-energy", "psychic-energy"],
      defenderEnergy: ["psychic-energy", "psychic-energy"],
    });
    attack(game, "Amnesia");
    resolveChoice(game, "Dream Tax");
    assertEqual(game.players[1].active?.damage, 20);
    const attacks = game.getLegalActions()
      .filter((action) => action.type === "attack")
      .map((action) => game.describeAction(action));
    assertEqual(attacks.some((label) => label.includes("Dream Tax")), false, "chosen attack locked");
    assertEqual(attacks.some((label) => label.includes("Pendulum Trance")), true, "other attack available");
  });

  test("Mind Shatter does 40 and discards a chosen card from the opponent's hand", () => {
    const game = configuredGame({
      attackerId: "dark-mewtwo-ex",
      defenderId: "feraligatr",
      attackerEnergy: ["psychic-energy", "psychic-energy", "psychic-energy"],
    });
    game.players[1].hand.push(instance("professor-birch"));
    attack(game, "Mind Shatter");
    resolveChoice(game, "Professor");
    assertEqual(game.players[1].active?.damage, 40);
    assertTrue(
      game.players[1].discard.some((c) => c.def.id === "professor-birch"),
      "chosen card discarded"
    );
  });
});

suite("Dark Steelix ex", () => {
  test("Buried Alive damages the Defending Pokémon then switches in a Benched one", () => {
    const game = configuredGame({
      attackerId: "dark-steelix-ex",
      defenderId: "feraligatr",
      attackerEnergy: ["darkness-energy", "metal-energy", "metal-energy"],
      defenderBench: [{ id: "wooper" }],
    });
    attack(game, "Buried Alive");
    resolveChoice(game, "Wooper");
    assertEqual(game.players[1].active?.def.id, "wooper", "new Defending");
    assertTrue(game.players[1].active?.locks.retreat !== undefined, "can't retreat");
    assertEqual(game.players[1].bench[0]?.damage, 40, "30 plus the attached Darkness Energy bonus");
  });

  test("Iron Grave mills 3 when it Knocks Out the Defending Pokémon", () => {
    const game = configuredGame({
      attackerId: "dark-steelix-ex",
      defenderId: "wooper",
      attackerEnergy: ["darkness-energy", "darkness-energy", "metal-energy", "metal-energy"],
      defenderBench: [{ id: "munchlax" }],
    });
    attack(game, "Iron Grave");
    assertEqual(game.players[1].discard.length, 4, "3 milled + KO'd Wooper");
  });

  test("Iron Grave does not mill without a Knock Out", () => {
    const game = configuredGame({
      attackerId: "dark-steelix-ex",
      defenderId: "dark-steelix-ex",
      attackerEnergy: ["darkness-energy", "darkness-energy", "metal-energy", "metal-energy"],
    });
    attack(game, "Iron Grave");
    assertEqual(game.players[1].active?.damage, 120, "100 plus two Darkness Energy bonuses");
    assertEqual(game.players[1].discard.length, 0, "no mill");
  });
});

suite("Relicanth ex", () => {
  test("Ancient Slumber keeps the opponent Asleep if either coin is tails", () => {
    const game = configuredGame({
      attackerId: "relicanth-ex",
      defenderId: "feraligatr",
    });
    game.players[1].active!.condition = "asleep";
    forceCoinSequence(game, [true, false]);
    game.perform({ type: "pass" });
    assertEqual(game.players[1].active?.condition, "asleep");
    assertEqual(game.log.filter((entry) => entry.startsWith("Sleep check for")).length, 2, "two coins flipped");
  });

  test("Ancient Slumber allows the opponent to wake up on 2 heads", () => {
    const game = configuredGame({ attackerId: "relicanth-ex", defenderId: "feraligatr" });
    game.players[1].active!.condition = "asleep";
    forceCoinSequence(game, [true, true]);
    game.perform({ type: "pass" });
    assertEqual(game.players[1].active?.condition, null);
  });

  test("Ancient Slumber has no effect while Relicanth ex is Benched", () => {
    const game = configuredGame({
      attackerId: "wooper",
      defenderId: "feraligatr",
      attackerBench: [{ id: "relicanth-ex" }],
    });
    game.players[1].active!.condition = "asleep";
    forceCoins(game, true);
    game.perform({ type: "pass" });
    assertEqual(game.players[1].active?.condition, null);
    assertEqual(game.log.filter((entry) => entry.startsWith("Sleep check for")).length, 1, "one coin flipped");
  });

  test("Deep-sea Crush does 80 damage to an Asleep defender and wakes it", () => {
    const game = configuredGame({
      attackerId: "relicanth-ex",
      defenderId: "feraligatr",
      attackerEnergy: ["water-energy", "water-energy", "water-energy"],
    });
    game.players[1].active!.condition = "asleep";
    game.players[1].active!.poisonCounters = 1;
    game.players[1].active!.burned = true;
    forceCoins(game, true);
    attack(game, "Deep-sea Crush");
    assertEqual(game.players[1].active?.damage, 90, "80 from the attack plus the normal Poison tick");
    assertEqual(game.players[1].active?.condition, null, "Defending Pokémon woke up");
    assertEqual(game.players[1].active?.poisonCounters, 1, "Poison remains");
    assertEqual(game.players[1].active?.burned, true, "Burn remains");
  });

  test("Deep-sea Crush does 50 damage to an awake defender", () => {
    const game = configuredGame({
      attackerId: "relicanth-ex",
      defenderId: "feraligatr",
      attackerEnergy: ["water-energy", "water-energy", "water-energy"],
    });
    attack(game, "Deep-sea Crush");
    assertEqual(game.players[1].active?.damage, 50);
  });

  test("Relicanth ex uses the supplied artwork and attack cost", () => {
    const relicanth = instance("relicanth-ex").def as PokemonCardDef;
    assertEqual(relicanth.image, "/cards/relicanth-ex.png");
    assertEqual(relicanth.power?.name, "Ancient Slumber");
    assertEqual(relicanth.attacks[0].cost.join(","), "Water,Water,Colorless");
  });
});
