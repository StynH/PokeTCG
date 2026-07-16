import { suite, test, assertEqual } from "../harness";
import { configuredGame, attack, attachEnergy } from "../helpers";

suite("Regigigas", () => {
  test("Crystal Type turns Regigigas into the attached Energy's type until end of turn", () => {
    const game = configuredGame({
      attackerId: "regigigas",
      defenderId: "torchic",
      attackerEnergy: ["fighting-energy"],
    });
    attachEnergy(game, "water-energy", { p: 0, slot: "active" });
    assertEqual(game.effectiveTypes(game.players[0].active!).join(","), "Water", "type becomes Water");
  });

  test("Crystal Type reverts to Colorless on the following turn", () => {
    const game = configuredGame({ attackerId: "regigigas", defenderId: "torchic" });
    attachEnergy(game, "metal-energy", { p: 0, slot: "active" });
    assertEqual(game.effectiveTypes(game.players[0].active!).join(","), "Metal", "type is Metal this turn");
    game.perform({ type: "pass" });
    assertEqual(game.effectiveTypes(game.players[0].active!).join(","), "Colorless", "type reverted");
  });

  test("Crystal Type makes Regigigas hit Weakness of the attached Energy type", () => {
    const game = configuredGame({
      attackerId: "regigigas",
      defenderId: "regirock-ex",
      attackerEnergy: ["fighting-energy"],
    });
    attachEnergy(game, "water-energy", { p: 0, slot: "active" });
    attack(game, "Titanic Slam");
    assertEqual(game.players[1].active?.damage, 100, "50 doubled by Water Weakness");
  });

  test("Titanic Slam does 50 and discards a Fighting Energy", () => {
    const game = configuredGame({
      attackerId: "regigigas",
      defenderId: "feraligatr",
      attackerEnergy: ["water-energy", "fighting-energy", "fighting-energy"],
    });
    attack(game, "Titanic Slam");
    assertEqual(game.players[1].active?.damage, 50);
    assertEqual(game.players[0].active?.energy.filter((c) => c.def.id === "fighting-energy").length, 1, "one Fighting discarded");
  });

  test("Giant Impact does 80 without the Regi trio in play", () => {
    const game = configuredGame({
      attackerId: "regigigas",
      defenderId: "feraligatr",
      attackerEnergy: ["water-energy", "water-energy", "fighting-energy", "metal-energy"],
    });
    attack(game, "Giant Impact");
    assertEqual(game.players[1].active?.damage, 80);
  });

  test("Giant Impact does 110 when name-matching Registeel, Regirock and Regice are in play", () => {
    const game = configuredGame({
      attackerId: "regigigas",
      defenderId: "dark-steelix-ex",
      attackerEnergy: ["water-energy", "water-energy", "fighting-energy", "metal-energy"],
      attackerBench: [{ id: "dark-registeel" }, { id: "regirock-ex" }, { id: "light-regice" }],
    });
    attack(game, "Giant Impact");
    assertEqual(game.players[1].active?.damage, 110);
  });
});

suite("Cipher's Lugia", () => {
  test("is both Psychic and Darkness type", () => {
    const game = configuredGame({ attackerId: "ciphers-lugia", defenderId: "feraligatr" });
    assertEqual(game.players[0].active?.def.types.join(","), "Psychic,Darkness");
  });

  test("Overpowering Aura puts a damage counter when Psychic Energy is attached", () => {
    const game = configuredGame({ attackerId: "ciphers-lugia", defenderId: "feraligatr" });
    attachEnergy(game, "psychic-energy", { p: 0, slot: "active" });
    assertEqual(game.players[1].active?.damage, 10);
  });

  test("Overpowering Aura puts a damage counter when Darkness Energy is attached", () => {
    const game = configuredGame({ attackerId: "ciphers-lugia", defenderId: "feraligatr" });
    attachEnergy(game, "darkness-energy", { p: 0, slot: "active" });
    assertEqual(game.players[1].active?.damage, 10);
  });

  test("Overpowering Aura ignores off-type Energy", () => {
    const game = configuredGame({ attackerId: "ciphers-lugia", defenderId: "feraligatr" });
    attachEnergy(game, "fighting-energy", { p: 0, slot: "active" });
    assertEqual(game.players[1].active?.damage, 0);
  });

  test("Shadow Storm discards a Darkness Energy to also snipe a Benched Pokémon for 40", () => {
    const game = configuredGame({
      attackerId: "ciphers-lugia",
      defenderId: "feraligatr",
      attackerEnergy: ["psychic-energy", "psychic-energy", "darkness-energy", "darkness-energy"],
      defenderBench: [{ id: "munchlax" }],
    });
    attack(game, "Shadow Storm");
    game.resolvePending(game.pending!.options.findIndex((o) => o.label.includes("Discard")));
    assertEqual(game.players[1].active?.damage, 90, "80 + special Darkness Energy to the Active");
    assertEqual(game.players[1].bench[0]?.damage, 40, "40 to the Benched Pokémon");
    assertEqual(game.players[0].active?.energy.filter((c) => c.def.id === "darkness-energy").length, 1, "one Darkness discarded");
  });

  test("Shadow Storm may decline the Darkness discard", () => {
    const game = configuredGame({
      attackerId: "ciphers-lugia",
      defenderId: "feraligatr",
      attackerEnergy: ["psychic-energy", "psychic-energy", "darkness-energy"],
      defenderBench: [{ id: "munchlax" }],
    });
    attack(game, "Shadow Storm");
    game.resolvePending(game.pending!.options.findIndex((o) => o.label.includes("Don't")));
    assertEqual(game.players[1].active?.damage, 90, "80 + special Darkness Energy to the Active");
    assertEqual(game.players[1].bench[0]?.damage, 0, "no bench damage");
    assertEqual(game.players[0].active?.energy.filter((c) => c.def.id === "darkness-energy").length, 1, "Darkness kept");
  });
});
