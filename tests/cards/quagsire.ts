import { suite, test, assertEqual } from "../harness";
import { configuredGame, attack, attachEnergy } from "../helpers";

suite("Quagsire", () => {
  test("Rejuvenation heals 10 when a Water Energy is attached from hand", () => {
    const game = configuredGame({ attackerId: "quagsire", defenderId: "feraligatr", attackerDamage: 30 });
    attachEnergy(game, "water-energy", { p: 0, slot: "active" });
    assertEqual(game.players[0].active?.damage, 20);
  });

  test("Rejuvenation does not trigger for non-Water Energy", () => {
    const game = configuredGame({ attackerId: "quagsire", defenderId: "feraligatr", attackerDamage: 30 });
    attachEnergy(game, "fighting-energy", { p: 0, slot: "active" });
    assertEqual(game.players[0].active?.damage, 30);
  });

  test("Mud Slide does 20 with no unused Water/Fighting Energy", () => {
    const game = configuredGame({
      attackerId: "quagsire",
      defenderId: "feraligatr",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
    });
    attack(game, "Mud Slide");
    assertEqual(game.players[1].active?.damage, 20);
  });

  test("Mud Slide adds 10 per unused Water/Fighting Energy (3 attached - 2 cost = +10)", () => {
    const game = configuredGame({
      attackerId: "quagsire",
      defenderId: "feraligatr",
      attackerEnergy: ["fighting-energy", "fighting-energy", "fighting-energy"],
    });
    attack(game, "Mud Slide");
    assertEqual(game.players[1].active?.damage, 30);
  });

  test("Mud Slide caps the bonus at +40", () => {
    const game = configuredGame({
      attackerId: "quagsire",
      defenderId: "feraligatr",
      attackerEnergy: Array.from({ length: 8 }, () => "fighting-energy"),
    });
    attack(game, "Mud Slide");
    assertEqual(game.players[1].active?.damage, 60);
  });
});
