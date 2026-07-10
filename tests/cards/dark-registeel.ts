import { suite, test, assertEqual } from "../harness";
import { configuredGame, attack } from "../helpers";

suite("Dark Registeel", () => {
  test("Corrosive Lockdown: 20 attack + 10 poison between turns (energyless to avoid Darkness rider)", () => {
    const game = configuredGame({
      attackerId: "dark-registeel",
      defenderId: "feraligatr",
    });
    attack(game, "Corrosive Lockdown");
    assertEqual(game.players[1].active?.damage, 30);
  });

  test("Corrosive Lockdown poisons the defender", () => {
    const game = configuredGame({
      attackerId: "dark-registeel",
      defenderId: "feraligatr",
    });
    attack(game, "Corrosive Lockdown");
    assertEqual(game.players[1].active?.poisonCounters, 1);
  });

  test("Corrosive Lockdown locks defender retreat for opponent's next turn", () => {
    const game = configuredGame({
      attackerId: "dark-registeel",
      defenderId: "feraligatr",
    });
    const turnBefore = game.turnNumber;
    attack(game, "Corrosive Lockdown");
    assertEqual(game.players[1].active?.locks.retreat, turnBefore + 1);
  });

  test("Shadow Crash deals 60 without defender Special Energy", () => {
    const game = configuredGame({
      attackerId: "dark-registeel",
      defenderId: "feraligatr",
    });
    attack(game, "Shadow Crash");
    assertEqual(game.players[1].active?.damage, 60);
  });

  test("Shadow Crash deals 80 and discards defender's Special Energy", () => {
    const game = configuredGame({
      attackerId: "dark-registeel",
      defenderId: "feraligatr",
      defenderEnergy: ["double-rainbow-energy"],
    });
    attack(game, "Shadow Crash");
    assertEqual(game.players[1].active?.damage, 80, "damage");
    assertEqual(
      game.players[1].discard.some((c) => c.def.id === "double-rainbow-energy"),
      true,
      "special energy in discard"
    );
    assertEqual(
      game.players[1].active?.energy.some((c) => c.def.id === "double-rainbow-energy"),
      false,
      "special energy detached"
    );
  });

  test("Shadow Crash leaves basic energy untouched (no bonus, no discard)", () => {
    const game = configuredGame({
      attackerId: "dark-registeel",
      defenderId: "feraligatr",
      defenderEnergy: ["water-energy"],
    });
    attack(game, "Shadow Crash");
    assertEqual(game.players[1].active?.damage, 60, "damage");
    assertEqual(game.players[1].active?.energy.length, 1, "energy count");
  });

  test("Black Iron Coating reduces incoming damage by 20 while Darkness Energy attached (20-20 = 0)", () => {
    const game = configuredGame({
      attackerId: "munchlax",
      defenderId: "dark-registeel",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
      defenderEnergy: ["darkness-energy"],
    });
    attack(game, "Munch");
    assertEqual(game.players[1].active?.damage, 0);
  });

  test("Black Iron Coating inactive without Darkness Energy (full 20 lands)", () => {
    const game = configuredGame({
      attackerId: "munchlax",
      defenderId: "dark-registeel",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
    });
    attack(game, "Munch");
    assertEqual(game.players[1].active?.damage, 20);
  });

  test("Black Iron Coating active via Double Rainbow (provides Darkness)", () => {
    const game = configuredGame({
      attackerId: "munchlax",
      defenderId: "dark-registeel",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
      defenderEnergy: ["double-rainbow-energy"],
    });
    attack(game, "Munch");
    assertEqual(game.players[1].active?.damage, 0);
  });
});
