import { suite, test, assertEqual } from "../harness";
import { configuredGame, attack, forceCoins } from "../helpers";

suite("Nidoran ♂", () => {
  test("Poison Horn heads poisons and does 10", () => {
    const game = configuredGame({
      attackerId: "nidoran-m",
      defenderId: "feraligatr",
      attackerEnergy: ["grass-energy"],
    });
    forceCoins(game, true);
    attack(game, "Poison Horn");
    assertEqual(game.players[1].active?.poisonCounters, 1, "poisoned");
    // 10 from the attack + 10 from the poison tick as the turn ends
    assertEqual(game.players[1].active?.damage, 20);
  });

  test("Desperate Charge does 30 and 10 to itself", () => {
    const game = configuredGame({
      attackerId: "nidoran-m",
      defenderId: "feraligatr",
      attackerEnergy: ["grass-energy", "grass-energy"],
    });
    attack(game, "Desperate Charge");
    assertEqual(game.players[1].active?.damage, 30);
    assertEqual(game.players[0].active?.damage, 10);
  });
});

suite("Nidorino", () => {
  test("Toxic Blood puts a damage counter on the Attacking Pokémon", () => {
    const game = configuredGame({
      attackerId: "munchlax",
      defenderId: "nidorino",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
    });
    attack(game, "Munch");
    assertEqual(game.players[1].active?.damage, 20, "Nidorino took 20");
    assertEqual(game.players[0].active?.damage, 10, "attacker got 1 counter");
  });

  test("Toxic Blood triggers even if Nidorino is Knocked Out", () => {
    const game = configuredGame({
      attackerId: "munchlax",
      defenderId: "nidorino",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
      defenderDamage: 70,
    });
    attack(game, "Munch");
    assertEqual(game.players[0].active?.damage, 10);
  });

  test("Rage Horn does 20 plus 10 per damage counter on Nidorino", () => {
    const game = configuredGame({
      attackerId: "nidorino",
      defenderId: "feraligatr",
      attackerEnergy: ["grass-energy", "grass-energy"],
      attackerDamage: 30,
    });
    attack(game, "Rage Horn");
    assertEqual(game.players[1].active?.damage, 50, "20 + 30");
  });
});

suite("Nidoking ex", () => {
  test("Royal Venom applies 2 poison counters", () => {
    const game = configuredGame({
      attackerId: "nidoking-ex",
      defenderId: "feraligatr",
      attackerEnergy: ["grass-energy", "grass-energy"],
    });
    attack(game, "Royal Venom");
    assertEqual(game.players[1].active?.poisonCounters, 2);
  });

  test("King's Rampage does 60 normally", () => {
    const game = configuredGame({
      attackerId: "nidoking-ex",
      defenderId: "feraligatr",
      attackerEnergy: ["fighting-energy", "fighting-energy", "fighting-energy"],
    });
    attack(game, "King's Rampage");
    assertEqual(game.players[1].active?.damage, 60);
    assertEqual(game.players[0].active?.energy.length, 3, "energy kept");
  });

  test("King's Rampage vs Poisoned discards all Energy and does 120", () => {
    const game = configuredGame({
      attackerId: "nidoking-ex",
      defenderId: "feraligatr",
      attackerEnergy: ["fighting-energy", "fighting-energy", "fighting-energy"],
    });
    game.players[1].active!.poisonCounters = 1;
    attack(game, "King's Rampage");
    assertEqual(game.players[0].active?.energy.length, 0, "all Energy discarded");
    assertEqual(game.players[1].active, null, "120 KOs Feraligatr");
  });

  test("King's Rampage does not get the bonus when no Energy was discarded", () => {
    const game = configuredGame({ attackerId: "nidoking-ex", defenderId: "feraligatr" });
    game.players[1].active!.poisonCounters = 1;
    attack(game, "King's Rampage");
    assertEqual(game.players[1].active?.damage, 70, "60 base damage plus the normal 10 Poison tick");
  });

  test("Poison Crown takes 1 extra Prize on a Poison Knock Out", () => {
    const game = configuredGame({
      attackerId: "nidoking-ex",
      defenderId: "drowzee",
      defenderDamage: 40,
    });
    game.players[1].active!.poisonCounters = 1;
    const before = game.players[0].prizes.length;
    game.perform({ type: "pass" });
    assertEqual(game.players[0].prizes.length, before - 2, "took 2 prizes (1 + Poison Crown)");
  });
});
