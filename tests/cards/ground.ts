import { suite, test, assertEqual, assertTrue } from "../harness";
import { configuredGame, attack, resolveChoice, forceCoins } from "../helpers";
import type { CardInstance } from "../../src/model/cards";

let suid = 800000;
function stadium(): CardInstance {
  return {
    uid: suid++,
    def: { id: "test-stadium", name: "Test Stadium", supertype: "Trainer", kind: "Stadium", text: "", effects: [] },
  };
}

suite("Trapinch", () => {
  test("Sinkhole drags up a Benched Pokémon and stops it retreating", () => {
    const game = configuredGame({
      attackerId: "trapinch",
      defenderId: "feraligatr",
      attackerEnergy: ["fighting-energy", "water-energy"],
      defenderBench: [{ id: "wooper" }],
    });
    attack(game, "Sinkhole");
    resolveChoice(game, "Wooper");
    assertEqual(game.players[1].active?.def.id, "wooper", "new Defending");
    assertTrue(game.players[1].active?.locks.retreat !== undefined, "can't retreat");
    assertEqual(game.players[1].bench[0]?.def.id, "feraligatr", "old Active benched");
  });
});

suite("Vibrava", () => {
  test("Sand Screen prevents attack effects while no Stadium is in play", () => {
    const game = configuredGame({
      attackerId: "drowzee",
      defenderId: "vibrava",
      attackerEnergy: ["psychic-energy"],
    });
    attack(game, "Hypnotic Suggestion");
    assertEqual(game.players[1].active?.condition, null, "Asleep prevented");
  });

  test("Sand Screen is off when a Stadium is in play", () => {
    const game = configuredGame({
      attackerId: "drowzee",
      defenderId: "vibrava",
      attackerEnergy: ["psychic-energy"],
    });
    game.stadium = { card: stadium(), owner: 0 };
    forceCoins(game, false); // keep it Asleep through the sleep check
    attack(game, "Hypnotic Suggestion");
    assertEqual(game.players[1].active?.condition, "asleep");
  });

  test("Desert Signal fetches a Stadium from the deck", () => {
    const game = configuredGame({
      attackerId: "vibrava",
      defenderId: "feraligatr",
      attackerEnergy: ["water-energy", "water-energy"],
    });
    game.players[0].deck.unshift(stadium());
    attack(game, "Desert Signal");
    resolveChoice(game, "Test Stadium");
    assertTrue(game.players[0].hand.some((c) => c.def.id === "test-stadium"), "Stadium in hand");
  });

  test("Sonic Dust confuses only when a Stadium is in play", () => {
    const game = configuredGame({
      attackerId: "vibrava",
      defenderId: "feraligatr",
      attackerEnergy: ["fighting-energy", "water-energy"],
    });
    game.stadium = { card: stadium(), owner: 0 };
    attack(game, "Sonic Dust");
    assertEqual(game.players[1].active?.damage, 30);
    assertEqual(game.players[1].active?.condition, "confused");
  });
});

suite("Flygon ex", () => {
  test("Desert Dominion adds 1 Retreat Cost while a Stadium is in play", () => {
    const game = configuredGame({ attackerId: "flygon-ex", defenderId: "feraligatr" });
    game.stadium = { card: stadium(), owner: 0 };
    assertEqual(
      game.effectiveRetreatCost({ p: 1, slot: "active" }, game.players[1].active!),
      3,
      "base 2 + 1"
    );
  });

  test("Desert Dominion is inactive without a Stadium in play", () => {
    const game = configuredGame({ attackerId: "flygon-ex", defenderId: "feraligatr" });
    assertEqual(game.effectiveRetreatCost({ p: 1, slot: "active" }, game.players[1].active!), 2);
  });

  test("Desert Dominion only applies while Flygon ex is Active", () => {
    const game = configuredGame({
      attackerId: "munchlax",
      defenderId: "feraligatr",
      attackerBench: [{ id: "flygon-ex" }],
    });
    game.stadium = { card: stadium(), owner: 0 };
    assertEqual(
      game.effectiveRetreatCost({ p: 1, slot: "active" }, game.players[1].active!),
      2,
      "no bonus while Flygon is benched"
    );
  });

  test("Sand Burial discards the Stadium and snipes 40 to the Bench", () => {
    const game = configuredGame({
      attackerId: "flygon-ex",
      defenderId: "feraligatr",
      attackerEnergy: ["fighting-energy", "water-energy"],
      defenderBench: [{ id: "wooper" }],
    });
    game.stadium = { card: stadium(), owner: 0 };
    attack(game, "Sand Burial");
    resolveChoice(game, "Discard Stadium");
    assertEqual(game.stadium, null, "Stadium discarded");
    assertEqual(game.players[1].bench[0]?.damage, 40);
  });

  test("Sand Burial can keep the Stadium and then does no Bench damage", () => {
    const game = configuredGame({
      attackerId: "flygon-ex",
      defenderId: "feraligatr",
      attackerEnergy: ["fighting-energy", "water-energy"],
      defenderBench: [{ id: "wooper" }],
    });
    game.stadium = { card: stadium(), owner: 0 };
    attack(game, "Sand Burial");
    resolveChoice(game, "Don't discard");
    assertTrue(game.stadium !== null, "Stadium remains in play");
    assertEqual(game.players[1].bench[0]?.damage, 0);
  });

  test("Desert Storm does 100 with no Stadium in play", () => {
    const game = configuredGame({
      attackerId: "flygon-ex",
      defenderId: "feraligatr",
      attackerEnergy: ["fighting-energy", "fighting-energy", "fighting-energy"],
    });
    attack(game, "Desert Storm");
    assertEqual(game.players[1].active?.damage, 100);
  });

  test("Desert Storm does 70 with a Stadium in play", () => {
    const game = configuredGame({
      attackerId: "flygon-ex",
      defenderId: "feraligatr",
      attackerEnergy: ["fighting-energy", "fighting-energy", "fighting-energy"],
    });
    game.stadium = { card: stadium(), owner: 0 };
    attack(game, "Desert Storm");
    assertEqual(game.players[1].active?.damage, 70);
  });
});
