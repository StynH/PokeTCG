import { suite, test, assertEqual, assertTrue } from "../harness";
import { configuredGame, attack, resolveChoice, forceCoins, forceCoinSequence, instance } from "../helpers";

suite("Gengar", () => {
  test("Nightmare Gate switches in a Benched Pokémon when Defending is Asleep", () => {
    const game = configuredGame({
      attackerId: "gengar",
      defenderId: "feraligatr",
      attackerEnergy: ["psychic-energy"],
      defenderBench: [{ id: "wooper" }],
    });
    game.players[1].active!.condition = "asleep";
    forceCoins(game, false); // keep the new Defending Asleep through the sleep check
    attack(game, "Nightmare Gate");
    resolveChoice(game, "Wooper");
    assertEqual(game.players[1].active?.def.id, "wooper", "new Defending switched in");
    assertEqual(game.players[1].active?.condition, "asleep", "new Defending Asleep");
    assertEqual(game.players[1].bench[0]?.damage, 20, "original took 20");
  });

  test("Nightmare Gate just does 20 when Defending is not Asleep", () => {
    const game = configuredGame({
      attackerId: "gengar",
      defenderId: "feraligatr",
      attackerEnergy: ["psychic-energy"],
      defenderBench: [{ id: "wooper" }],
    });
    attack(game, "Nightmare Gate");
    assertEqual(game.players[1].active?.def.id, "feraligatr");
    assertEqual(game.players[1].active?.damage, 20);
  });

  test("Nightmare Gate can decline the switch and does not put a new Pokémon Asleep", () => {
    const game = configuredGame({
      attackerId: "gengar",
      defenderId: "feraligatr",
      attackerEnergy: ["psychic-energy"],
      defenderBench: [{ id: "wooper" }],
    });
    game.players[1].active!.condition = "asleep";
    forceCoins(game, false);
    attack(game, "Nightmare Gate");
    resolveChoice(game, "Don't switch");
    assertEqual(game.players[1].active?.def.id, "feraligatr");
    assertEqual(game.players[1].bench[0]?.condition, null);
  });

  test("Nightmare Gate does not require a switch when the opponent has no Bench", () => {
    const game = configuredGame({ attackerId: "gengar", defenderId: "feraligatr", attackerEnergy: ["psychic-energy"] });
    game.players[1].active!.condition = "asleep";
    forceCoins(game, false);
    attack(game, "Nightmare Gate");
    assertEqual(game.pending, null);
    assertEqual(game.players[1].active?.damage, 20);
  });

  test("Prize of Darkness does 80 when opponent has fewer Prizes", () => {
    const game = configuredGame({
      attackerId: "gengar",
      defenderId: "feraligatr",
      attackerEnergy: ["psychic-energy", "psychic-energy", "psychic-energy"],
    });
    game.players[1].prizes.splice(0, 3);
    attack(game, "Prize of Darkness");
    assertEqual(game.players[1].active?.damage, 80);
  });

  test("Prize of Darkness does 40 on even Prizes", () => {
    const game = configuredGame({
      attackerId: "gengar",
      defenderId: "feraligatr",
      attackerEnergy: ["psychic-energy", "psychic-energy", "psychic-energy"],
    });
    attack(game, "Prize of Darkness");
    assertEqual(game.players[1].active?.damage, 40);
  });
});

suite("Drowzee", () => {
  test("Hypnotic Suggestion sleeps the Defending Pokémon and makes the opponent draw", () => {
    const game = configuredGame({
      attackerId: "drowzee",
      defenderId: "feraligatr",
      attackerEnergy: ["psychic-energy"],
    });
    forceCoins(game, false); // keep the Defending Pokémon Asleep through the sleep check
    attack(game, "Hypnotic Suggestion");
    assertEqual(game.players[1].active?.condition, "asleep");
    // 1 from the effect + 1 from the opponent's own start-of-turn draw
    assertEqual(game.players[1].hand.length, 2, "opponent drew a card");
  });
});

suite("Hypno", () => {
  test("Pendulum Trance does 10 and puts the Defending Pokémon Asleep on heads", () => {
    const game = configuredGame({
      attackerId: "hypno",
      defenderId: "feraligatr",
      attackerEnergy: ["psychic-energy"],
    });
    forceCoinSequence(game, [true, false]);
    attack(game, "Pendulum Trance");
    assertEqual(game.players[1].active?.damage, 10);
    assertEqual(game.players[1].active?.condition, "asleep");
  });

  test("Hypno no longer has Pendulum Exchange", () => {
    const hypno = instance("hypno").def as import("../../src/model/cards").PokemonCardDef;
    assertEqual(hypno.power, undefined);
    assertEqual(hypno.attacks[0]?.name, "Pendulum Trance");
  });

  test("Dream Tax makes opponent discard when Defending is Asleep", () => {
    const game = configuredGame({
      attackerId: "hypno",
      defenderId: "feraligatr",
      attackerEnergy: ["psychic-energy", "psychic-energy"],
    });
    game.players[1].active!.condition = "asleep";
    game.players[1].hand.push(instance("munchlax"));
    attack(game, "Dream Tax");
    resolveChoice(game, "Munchlax");
    assertTrue(game.players[1].discard.some((c) => c.def.id === "munchlax"), "card discarded");
    assertEqual(game.players[1].active?.damage, 30);
  });
});
