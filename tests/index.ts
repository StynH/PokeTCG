import { run } from "./harness";
import "./cards/regirock-ex";
import "./cards/dark-registeel";
import "./cards/light-regice";
import "./cards/spelling";
import "./cards/quagsire";
import "./cards/slugma";
import "./cards/abra";
import "./cards/pikachu";
import "./cards/magneton";
import "./cards/lairon";
import "./cards/miltank";
import "./cards/gligar";
import "./cards/magcargo";
import "./cards/poke-bodies";

declare const process: { argv: string[]; exitCode?: number };

if (run(process.argv[2]) > 0) process.exitCode = 1;
