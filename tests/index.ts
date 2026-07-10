import { run } from "./harness";
import "./cards/regirock-ex";
import "./cards/dark-registeel";
import "./cards/light-regice";

declare const process: { argv: string[]; exitCode?: number };

if (run(process.argv[2]) > 0) process.exitCode = 1;
