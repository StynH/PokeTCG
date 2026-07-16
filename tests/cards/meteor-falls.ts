import { suite, test, assertEqual } from "../harness";
import { configuredGame, instance } from "../helpers";

function setStadium(game: ReturnType<typeof configuredGame>, id: string): void {
  game.stadium = { card: instance(id), owner: 0 };
}

suite("Meteor Falls", () => {
  test("lets an Evolved Pokémon use an attack from a card underneath it", () => {
    const game = configuredGame({
      attackerId: "machamp",
      defenderId: "feraligatr",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
    });
    game.players[0].active!.underneath = [instance("machop"), instance("machoke")];
    setStadium(game, "meteor-falls");
    // Machamp's own attack is index 0; Machop's "Cross" is a borrowed attack.
    game.perform({ type: "attack", index: 2 });
    assertEqual(game.players[1].active?.damage, 30, "Machop's Cross does 30");
  });

  test("without Meteor Falls the borrowed attack does not exist", () => {
    const game = configuredGame({
      attackerId: "machamp",
      defenderId: "feraligatr",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
    });
    game.players[0].active!.underneath = [instance("machop"), instance("machoke")];
    game.perform({ type: "attack", index: 2 });
    assertEqual(game.players[1].active?.damage ?? 0, 0, "no borrowed attack");
  });
});
