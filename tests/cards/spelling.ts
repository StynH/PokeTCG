import { suite, test, assertEqual, assertTrue, assertFalse } from "../harness";
import { library } from "../helpers";

function text(id: string): string {
  return JSON.stringify(library[id]);
}

suite("Card spelling", () => {
  test("Feraligatr name is spelled correctly", () => {
    assertEqual(library["feraligatr"].name, "Feraligatr");
  });

  test("Magcargo name is spelled correctly", () => {
    assertEqual(library["magcargo"].name, "Magcargo");
  });

  test("Magcargo text never uses the Macargo misspelling", () => {
    assertFalse(text("magcargo").includes("Macargo"), "no Macargo in JSON");
    assertTrue(text("magcargo").includes("Magcargo"), "uses Magcargo");
  });

  test("Quagsire's Poke-Body is spelled Rejuvenation", () => {
    const power = (library["quagsire"] as { power?: { name: string } }).power;
    assertEqual(power?.name, "Rejuvenation");
  });
});
