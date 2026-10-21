import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mapRestKline } from "../../src/data.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(fs.readFileSync(path.resolve(here, "../fixtures/klines.json"), "utf8"));

export const fixtureBars = () => RAW.map(mapRestKline);

// Окна по 1000 свечей (как в живом терминале) + короткие окна для краевых случаев.
export const WINDOWS = [[0, 1000], [500, 1500], [1000, 2000], [1500, 2500], [2000, 3000], [2955, 3000], [2975, 3000]];

export const windowBars = ([a, b]) => fixtureBars().slice(a, b);
