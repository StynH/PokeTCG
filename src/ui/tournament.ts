import type { GameEvent } from "../engine/game";

export interface TournamentPlayer {
  name: string;
  deck: string;
}

export interface SideStats {
  attacks: number;
  kos: number;
  prizes: number;
  trainers: number;
  energies: number;
  draws: number;
  evolutions: number;
  powers: number;
  statuses: number;
  damage: number;
  heals: number;
  flips: number;
  heads: number;
  whiffs: number;
}

export interface HitRecord {
  amount: number;
  attacker: string;
  attack: string;
  target: string;
  side: 0 | 1;
  turn: number;
  ko: boolean;
}

export interface Combatant {
  name: string;
  side: 0 | 1;
  attacks: number;
  damage: number;
  kos: number;
  timesKod: number;
}

export interface AttackLine {
  pokemon: string;
  attack: string;
  side: 0 | 1;
  uses: number;
  damage: number;
  kos: number;
  best: number;
}

export interface CardPlay {
  name: string;
  side: 0 | 1;
  count: number;
}

export interface GameStats {
  turns: number;
  suddenDeath: boolean;
  winReason: string;
  winnerSide: 0 | 1 | null;
  totalDamage: number;
  biggestHit: HitRecord | null;
  finalBlow: HitRecord | null;
  maxDeficit: [number, number];
  leadChanges: number;
  combatants: Combatant[];
  attackLines: AttackLine[];
  cardPlays: CardPlay[];
  coinFlips: number;
  coinHeads: number;
  perSide: [SideStats, SideStats];
}

export interface MatchOutcome {
  winnerSide: 0 | 1;
  score: [number, number];
  games: GameStats[];
}

function emptySideStats(): SideStats {
  return {
    attacks: 0,
    kos: 0,
    prizes: 0,
    trainers: 0,
    energies: 0,
    draws: 0,
    evolutions: 0,
    powers: 0,
    statuses: 0,
    damage: 0,
    heals: 0,
    flips: 0,
    heads: 0,
    whiffs: 0,
  };
}

const ATTACK_TEXT = /^(.+) uses (.+)$/;
const ATTRIBUTABLE_DAMAGE_TEXT = /^(.+) takes (\d+) damage$/;
const DAMAGE_COUNTER_TEXT = /^(.+) gets \d+ damage counter\(s\)$/;
const KO_TEXT = /^(.+) is Knocked Out!$/;
const TRAINER_PLAY_TEXT = /^.+ plays (?:Stadium )?(.+)$/;

export function collectGameStats(source: {
  events: GameEvent[];
  turnNumber: number;
  suddenDeath: boolean;
  winReason: string;
  winner: number | null;
}): GameStats {
  const perSide: [SideStats, SideStats] = [emptySideStats(), emptySideStats()];
  let owner = 0;
  let totalDamage = 0;
  let coinFlips = 0;
  let coinHeads = 0;
  let leadChanges = 0;
  let lastHit: HitRecord | null = null;
  let biggestHit: HitRecord | null = null;
  let finalBlow: HitRecord | null = null;
  const taken: [number, number] = [0, 0];
  const maxDeficit: [number, number] = [0, 0];
  let leadSign = 0;

  const combatants = new Map<string, Combatant>();
  const combatantOf = (side: 0 | 1, name: string): Combatant => {
    const key = `${side}|${name}`;
    let found = combatants.get(key);
    if (!found) {
      found = { name, side, attacks: 0, damage: 0, kos: 0, timesKod: 0 };
      combatants.set(key, found);
    }
    return found;
  };
  const attackLines = new Map<string, AttackLine>();
  const attackLineOf = (side: 0 | 1, pokemon: string, attack: string): AttackLine => {
    const key = `${side}|${pokemon}|${attack}`;
    let found = attackLines.get(key);
    if (!found) {
      found = { pokemon, attack, side, uses: 0, damage: 0, kos: 0, best: 0 };
      attackLines.set(key, found);
    }
    return found;
  };
  const cardPlays = new Map<string, CardPlay>();
  const bumpCard = (side: 0 | 1, name: string) => {
    const key = `${side}|${name}`;
    const found = cardPlays.get(key);
    if (found) found.count++;
    else cardPlays.set(key, { name, side, count: 1 });
  };

  let swing: { side: 0 | 1; attacker: string; attack: string; damage: number; line: AttackLine; mon: Combatant } | null =
    null;
  const closeSwing = () => {
    if (swing && swing.damage === 0) perSide[swing.side].whiffs++;
    swing = null;
  };

  for (const ev of source.events) {
    if (ev.player !== undefined && (ev.cat === "turn" || ev.cat === "attack")) owner = ev.player;
    switch (ev.cat) {
      case "turn":
        closeSwing();
        break;
      case "trainer": {
        closeSwing();
        if (ev.player === undefined) break;
        perSide[ev.player].trainers++;
        const played = TRAINER_PLAY_TEXT.exec(ev.text);
        if (played) bumpCard(ev.player as 0 | 1, played[1]);
        break;
      }
      case "attack": {
        const side = (ev.player ?? owner) as 0 | 1;
        perSide[side].attacks++;
        closeSwing();
        const parsed = ATTACK_TEXT.exec(ev.text);
        if (parsed) {
          const mon = combatantOf(side, parsed[1]);
          mon.attacks++;
          const line = attackLineOf(side, parsed[1], parsed[2]);
          line.uses++;
          swing = { side, attacker: parsed[1], attack: parsed[2], damage: 0, line, mon };
        }
        break;
      }
      case "ko": {
        if (ev.player === undefined) break;
        const victimSide = ev.player as 0 | 1;
        perSide[1 - victimSide].kos++;
        const parsed = KO_TEXT.exec(ev.text);
        if (parsed) combatantOf(victimSide, parsed[1]).timesKod++;
        if (swing && swing.side !== victimSide) {
          swing.line.kos++;
          swing.mon.kos++;
        }
        if (lastHit && lastHit.turn === ev.turn) {
          lastHit.ko = true;
          finalBlow = lastHit;
        }
        break;
      }
      case "prize": {
        if (ev.player === undefined) break;
        const side = ev.player as 0 | 1;
        const amount = ev.amount ?? 1;
        perSide[side].prizes += amount;
        taken[side] += amount;
        maxDeficit[0] = Math.max(maxDeficit[0], taken[1] - taken[0]);
        maxDeficit[1] = Math.max(maxDeficit[1], taken[0] - taken[1]);
        const sign = Math.sign(taken[0] - taken[1]);
        if (sign !== 0 && leadSign !== 0 && sign !== leadSign) leadChanges++;
        if (sign !== 0) leadSign = sign;
        break;
      }
      case "energy":
        if (ev.player !== undefined) perSide[ev.player].energies++;
        break;
      case "evolve":
        if (ev.player !== undefined) perSide[ev.player].evolutions++;
        break;
      case "power":
        if (ev.player !== undefined) perSide[ev.player].powers++;
        break;
      case "draw": {
        const match = ev.text.match(/draws (\d+)/);
        perSide[ev.player ?? owner].draws += match ? Number(match[1]) : 1;
        break;
      }
      case "heal": {
        const match = ev.text.match(/healed (\d+)/);
        perSide[owner].heals += match ? Number(match[1]) : 0;
        break;
      }
      case "status":
        if (ev.text.includes("is now")) perSide[owner].statuses++;
        break;
      case "damage": {
        const amount = ev.amount ?? 0;
        totalDamage += amount;
        perSide[owner].damage += amount;
        if (amount <= 0) break;
        const direct = ATTRIBUTABLE_DAMAGE_TEXT.exec(ev.text) ?? DAMAGE_COUNTER_TEXT.exec(ev.text);
        if (!swing || !direct) break;
        swing.damage += amount;
        swing.line.damage += amount;
        swing.line.best = Math.max(swing.line.best, amount);
        swing.mon.damage += amount;
        lastHit = {
          amount,
          attacker: swing.attacker,
          attack: swing.attack,
          target: direct[1],
          side: swing.side,
          turn: ev.turn,
          ko: false,
        };
        if (!biggestHit || amount > biggestHit.amount) biggestHit = lastHit;
        break;
      }
      case "coin":
        coinFlips++;
        perSide[owner].flips++;
        if (ev.text.endsWith("Heads")) {
          coinHeads++;
          perSide[owner].heads++;
        }
        break;
    }
  }
  closeSwing();
  return {
    turns: source.turnNumber,
    suddenDeath: source.suddenDeath,
    winReason: source.winReason,
    winnerSide: source.winner === 0 || source.winner === 1 ? source.winner : null,
    totalDamage,
    biggestHit,
    finalBlow,
    maxDeficit,
    leadChanges,
    combatants: [...combatants.values()],
    attackLines: [...attackLines.values()],
    cardPlays: [...cardPlays.values()],
    coinFlips,
    coinHeads,
    perSide,
  };
}

export interface TournamentCtx {
  deckNames: () => string[];
  playMatch: (
    a: TournamentPlayer,
    b: TournamentPlayer,
    label: string,
    onDone: (outcome: MatchOutcome) => void
  ) => void;
  showStartScreen: () => void;
}

type Format = "single" | "double";

type Source =
  | { kind: "seed"; slot: number }
  | { kind: "winner"; match: number }
  | { kind: "loser"; match: number };

interface MatchResult {
  winnerSide: 0 | 1;
  score: [number, number] | null;
  walkover: boolean;
  games?: GameStats[];
}

interface BracketMatch {
  bracket: "w" | "l" | "g";
  round: number;
  sources: [Source, Source];
  result: MatchResult | null;
  voided: boolean;
}

interface Tournament {
  format: Format;
  players: TournamentPlayer[];
  slots: Array<number | null>;
  matches: BracketMatch[];
  wbRounds: number[][];
  lbRounds: number[][];
  gfIndex: number;
  resetIndex: number;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  parent?: HTMLElement,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  parent?.appendChild(node);
  return node;
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function seedOrder(size: number): number[] {
  let order = [0];
  while (order.length < size) {
    const doubled = order.length * 2;
    const next: number[] = [];
    for (const s of order) {
      next.push(s);
      next.push(doubled - 1 - s);
    }
    order = next;
  }
  return order;
}

function buildTournament(format: Format, players: TournamentPlayer[]): Tournament {
  const size = nextPow2(players.length);
  const slots = seedOrder(size).map((seed) => (seed < players.length ? seed : null));
  const matches: BracketMatch[] = [];
  const add = (bracket: "w" | "l" | "g", round: number, a: Source, b: Source): number => {
    matches.push({ bracket, round, sources: [a, b], result: null, voided: false });
    return matches.length - 1;
  };
  const winner = (match: number): Source => ({ kind: "winner", match });
  const loser = (match: number): Source => ({ kind: "loser", match });

  const depth = Math.log2(size);
  const wbRounds: number[][] = [];
  const lbRounds: number[][] = [];

  const firstRound: number[] = [];
  for (let i = 0; i < size / 2; i++) {
    firstRound.push(add("w", 1, { kind: "seed", slot: 2 * i }, { kind: "seed", slot: 2 * i + 1 }));
  }
  wbRounds.push(firstRound);

  if (format === "double" && depth >= 2) {
    const round: number[] = [];
    for (let i = 0; i < size / 4; i++) {
      round.push(add("l", 1, loser(firstRound[2 * i]), loser(firstRound[2 * i + 1])));
    }
    lbRounds.push(round);
  }

  for (let r = 2; r <= depth; r++) {
    const prev = wbRounds[r - 2];
    const round: number[] = [];
    for (let i = 0; i < size / 2 ** r; i++) {
      round.push(add("w", r, winner(prev[2 * i]), winner(prev[2 * i + 1])));
    }
    wbRounds.push(round);

    if (format === "double" && depth >= 2) {
      const count = size / 2 ** r;
      const prevLb = lbRounds[lbRounds.length - 1];
      const dropRound: number[] = [];
      const flip = r % 2 === 0;
      for (let i = 0; i < count; i++) {
        dropRound.push(
          add("l", lbRounds.length + 1, winner(prevLb[i]), loser(round[flip ? count - 1 - i : i]))
        );
      }
      lbRounds.push(dropRound);
      if (r < depth) {
        const pairRound: number[] = [];
        for (let i = 0; i < count / 2; i++) {
          pairRound.push(add("l", lbRounds.length + 1, winner(dropRound[2 * i]), winner(dropRound[2 * i + 1])));
        }
        lbRounds.push(pairRound);
      }
    }
  }

  let gfIndex = -1;
  let resetIndex = -1;
  if (format === "double") {
    const wbFinal = wbRounds[depth - 1][0];
    const lbSource: Source =
      lbRounds.length > 0 ? winner(lbRounds[lbRounds.length - 1][0]) : loser(wbFinal);
    gfIndex = add("g", 1, winner(wbFinal), lbSource);
    resetIndex = add("g", 2, winner(gfIndex), loser(gfIndex));
  }

  const tournament: Tournament = { format, players, slots, matches, wbRounds, lbRounds, gfIndex, resetIndex };
  autoResolve(tournament);
  return tournament;
}

function resolveSource(t: Tournament, src: Source): number | null | undefined {
  if (src.kind === "seed") return t.slots[src.slot];
  const match = t.matches[src.match];
  if (!match.result) return undefined;
  const side = src.kind === "winner" ? match.result.winnerSide : 1 - match.result.winnerSide;
  return resolveSource(t, match.sources[side]);
}

function autoResolve(t: Tournament): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const match of t.matches) {
      if (match.result || match.voided) continue;
      const a = resolveSource(t, match.sources[0]);
      const b = resolveSource(t, match.sources[1]);
      if (a === undefined || b === undefined) continue;
      if (a !== null && b !== null) continue;
      match.result = { winnerSide: a !== null ? 0 : 1, score: null, walkover: true };
      changed = true;
    }
  }
}

function recordOutcome(t: Tournament, index: number, outcome: MatchOutcome): void {
  t.matches[index].result = {
    winnerSide: outcome.winnerSide,
    score: outcome.score,
    walkover: false,
    games: outcome.games,
  };
  if (index === t.gfIndex && t.resetIndex >= 0 && outcome.winnerSide === 0) {
    t.matches[t.resetIndex].voided = true;
  }
  autoResolve(t);
}

function nextPlayable(t: Tournament): number {
  for (let i = 0; i < t.matches.length; i++) {
    const match = t.matches[i];
    if (match.result || match.voided) continue;
    const a = resolveSource(t, match.sources[0]);
    const b = resolveSource(t, match.sources[1]);
    if (typeof a === "number" && typeof b === "number") return i;
  }
  return -1;
}

function isComplete(t: Tournament): boolean {
  return t.matches.every((m) => m.result || m.voided);
}

function championOf(t: Tournament): number | null {
  if (!isComplete(t)) return null;
  for (let i = t.matches.length - 1; i >= 0; i--) {
    const match = t.matches[i];
    if (match.voided || !match.result) continue;
    const champ = resolveSource(t, match.sources[match.result.winnerSide]);
    return typeof champ === "number" ? champ : null;
  }
  return null;
}

function gamesPlayed(t: Tournament): number {
  return t.matches.filter((m) => m.result && !m.result.walkover).length;
}

function gamesRemaining(t: Tournament): number {
  let count = 0;
  for (let i = 0; i < t.matches.length; i++) {
    const match = t.matches[i];
    if (match.result || match.voided) continue;
    if (i === t.resetIndex) {
      const gf = t.matches[t.gfIndex];
      if (!gf.result || gf.result.winnerSide === 0) continue;
    }
    count++;
  }
  return count;
}

function matchTitle(t: Tournament, index: number): string {
  const match = t.matches[index];
  if (match.bracket === "g") return match.round === 1 ? "Grand Final" : "Bracket Reset";
  if (match.bracket === "l") {
    return match.round === t.lbRounds.length ? "Losers Final" : `Losers Round ${match.round}`;
  }
  const count = t.wbRounds[match.round - 1].length;
  if (t.format === "double") {
    return count === 1 ? "Winners Final" : `Winners Round ${match.round}`;
  }
  if (count === 1) return "Final";
  if (count === 2) return "Semifinals";
  if (count === 4) return "Quarterfinals";
  return `Round ${match.round}`;
}

function roundTitle(t: Tournament, matchIndexes: number[]): string {
  return matchTitle(t, matchIndexes[0]);
}

interface Placements {
  first: number | null;
  second: number | null;
  thirds: number[];
}

function placements(t: Tournament): Placements {
  const first = championOf(t);
  if (first === null) return { first: null, second: null, thirds: [] };
  let second: number | null = null;
  for (let i = t.matches.length - 1; i >= 0; i--) {
    const match = t.matches[i];
    if (match.voided || !match.result) continue;
    const loser = resolveSource(t, match.sources[1 - match.result.winnerSide]);
    if (typeof loser === "number") second = loser;
    break;
  }
  const thirds: number[] = [];
  const collectLoser = (index: number) => {
    const match = t.matches[index];
    if (!match.result) return;
    const loser = resolveSource(t, match.sources[1 - match.result.winnerSide]);
    if (typeof loser === "number" && loser !== first && loser !== second) thirds.push(loser);
  };
  if (t.format === "double") {
    if (t.lbRounds.length > 0) collectLoser(t.lbRounds[t.lbRounds.length - 1][0]);
  } else if (t.wbRounds.length >= 2) {
    for (const index of t.wbRounds[t.wbRounds.length - 2]) collectLoser(index);
  }
  return { first, second, thirds };
}

interface PlayerAgg extends SideStats {
  wins: number;
  losses: number;
  games: number;
  gameWins: number;
  gameLosses: number;
}

interface MonAgg {
  name: string;
  player: number;
  attacks: number;
  damage: number;
  kos: number;
  timesKod: number;
}

interface AttackAgg {
  pokemon: string;
  attack: string;
  player: number;
  uses: number;
  damage: number;
  kos: number;
  best: number;
}

interface CardAgg {
  name: string;
  count: number;
}

interface RunEntry {
  label: string;
  opponent: number;
  score: [number, number] | null;
  won: boolean;
  walkover: boolean;
}

interface RecordMoment {
  value: number;
  label: string;
  detail: string;
}

interface HitMoment {
  hit: HitRecord;
  label: string;
  by: number;
  against: number;
}

interface ComebackMoment {
  player: number;
  deficit: number;
  label: string;
  detail: string;
}

interface TournamentStats {
  aggs: PlayerAgg[];
  mons: MonAgg[];
  attacks: AttackAgg[];
  cards: CardAgg[];
  runs: RunEntry[][];
  gamesPlayed: number;
  suddenDeaths: number;
  totalTurns: number;
  totalDamage: number;
  totalKos: number;
  totalPrizes: number;
  totalAttacks: number;
  totalTrainers: number;
  totalEnergies: number;
  totalDraws: number;
  totalEvolutions: number;
  totalPowers: number;
  totalStatuses: number;
  totalHeals: number;
  totalWhiffs: number;
  coinFlips: number;
  coinHeads: number;
  fastestGame: RecordMoment | null;
  longestGame: RecordMoment | null;
  bloodiestMatch: RecordMoment | null;
  hardestHit: HitMoment | null;
  championshipPoint: HitMoment | null;
  biggestComeback: ComebackMoment | null;
  wildestSwing: RecordMoment | null;
}

function computeStats(t: Tournament): TournamentStats {
  const aggs: PlayerAgg[] = t.players.map(() => ({
    ...emptySideStats(),
    wins: 0,
    losses: 0,
    games: 0,
    gameWins: 0,
    gameLosses: 0,
  }));
  const stats: TournamentStats = {
    aggs,
    mons: [],
    attacks: [],
    cards: [],
    runs: t.players.map(() => []),
    gamesPlayed: 0,
    suddenDeaths: 0,
    totalTurns: 0,
    totalDamage: 0,
    totalKos: 0,
    totalPrizes: 0,
    totalAttacks: 0,
    totalTrainers: 0,
    totalEnergies: 0,
    totalDraws: 0,
    totalEvolutions: 0,
    totalPowers: 0,
    totalStatuses: 0,
    totalHeals: 0,
    totalWhiffs: 0,
    coinFlips: 0,
    coinHeads: 0,
    fastestGame: null,
    longestGame: null,
    bloodiestMatch: null,
    hardestHit: null,
    championshipPoint: null,
    biggestComeback: null,
    wildestSwing: null,
  };

  const mons = new Map<string, MonAgg>();
  const monOf = (player: number, name: string): MonAgg => {
    const key = `${player}|${name}`;
    let found = mons.get(key);
    if (!found) {
      found = { name, player, attacks: 0, damage: 0, kos: 0, timesKod: 0 };
      mons.set(key, found);
    }
    return found;
  };
  const attackAggs = new Map<string, AttackAgg>();
  const attackOf = (player: number, pokemon: string, attack: string): AttackAgg => {
    const key = `${player}|${pokemon}|${attack}`;
    let found = attackAggs.get(key);
    if (!found) {
      found = { pokemon, attack, player, uses: 0, damage: 0, kos: 0, best: 0 };
      attackAggs.set(key, found);
    }
    return found;
  };
  const cards = new Map<string, CardAgg>();

  t.matches.forEach((match, index) => {
    if (!match.result) return;
    const a = resolveSource(t, match.sources[0]);
    const b = resolveSource(t, match.sources[1]);
    if (typeof a !== "number" || typeof b !== "number") return;
    const sides: [number, number] = [a, b];
    const label = matchTitle(t, index);
    const detail = `${t.players[a].name} vs ${t.players[b].name}`;
    const winnerSide = match.result.winnerSide;
    stats.runs[sides[winnerSide]].push({
      label,
      opponent: sides[1 - winnerSide],
      score: match.result.score,
      won: true,
      walkover: match.result.walkover,
    });
    stats.runs[sides[1 - winnerSide]].push({
      label,
      opponent: sides[winnerSide],
      score: match.result.score ? [match.result.score[1 - winnerSide], match.result.score[winnerSide]] : null,
      won: false,
      walkover: match.result.walkover,
    });
    if (match.result.walkover) return;
    aggs[sides[winnerSide]].wins++;
    aggs[sides[1 - winnerSide]].losses++;
    let matchDamage = 0;
    for (const game of match.result.games ?? []) {
      stats.gamesPlayed++;
      if (game.suddenDeath) stats.suddenDeaths++;
      stats.totalTurns += game.turns;
      stats.totalDamage += game.totalDamage;
      stats.coinFlips += game.coinFlips;
      stats.coinHeads += game.coinHeads;
      matchDamage += game.totalDamage;
      if (game.winnerSide !== null) {
        aggs[sides[game.winnerSide]].gameWins++;
        aggs[sides[1 - game.winnerSide]].gameLosses++;
      }
      game.perSide.forEach((side, s) => {
        const agg = aggs[sides[s]];
        agg.games++;
        for (const key of Object.keys(emptySideStats()) as Array<keyof SideStats>) {
          agg[key] += side[key];
        }
        stats.totalKos += side.kos;
        stats.totalPrizes += side.prizes;
        stats.totalAttacks += side.attacks;
        stats.totalTrainers += side.trainers;
        stats.totalEnergies += side.energies;
        stats.totalDraws += side.draws;
        stats.totalEvolutions += side.evolutions;
        stats.totalPowers += side.powers;
        stats.totalStatuses += side.statuses;
        stats.totalHeals += side.heals;
        stats.totalWhiffs += side.whiffs;
      });
      for (const mon of game.combatants) {
        const agg = monOf(sides[mon.side], mon.name);
        agg.attacks += mon.attacks;
        agg.damage += mon.damage;
        agg.kos += mon.kos;
        agg.timesKod += mon.timesKod;
      }
      for (const line of game.attackLines) {
        const agg = attackOf(sides[line.side], line.pokemon, line.attack);
        agg.uses += line.uses;
        agg.damage += line.damage;
        agg.kos += line.kos;
        agg.best = Math.max(agg.best, line.best);
      }
      for (const play of game.cardPlays) {
        const found = cards.get(play.name);
        if (found) found.count += play.count;
        else cards.set(play.name, { name: play.name, count: play.count });
      }
      if (!game.suddenDeath) {
        if (!stats.fastestGame || game.turns < stats.fastestGame.value) {
          stats.fastestGame = { value: game.turns, label, detail };
        }
        if (!stats.longestGame || game.turns > stats.longestGame.value) {
          stats.longestGame = { value: game.turns, label, detail };
        }
      }
      if (game.biggestHit && (!stats.hardestHit || game.biggestHit.amount > stats.hardestHit.hit.amount)) {
        stats.hardestHit = {
          hit: game.biggestHit,
          label,
          by: sides[game.biggestHit.side],
          against: sides[1 - game.biggestHit.side],
        };
      }
      if (game.finalBlow) {
        stats.championshipPoint = {
          hit: game.finalBlow,
          label,
          by: sides[game.finalBlow.side],
          against: sides[1 - game.finalBlow.side],
        };
      }
      if (game.winnerSide !== null) {
        const deficit = game.maxDeficit[game.winnerSide];
        if (deficit > 0 && (!stats.biggestComeback || deficit > stats.biggestComeback.deficit)) {
          stats.biggestComeback = { player: sides[game.winnerSide], deficit, label, detail };
        }
      }
      if (game.leadChanges > 0 && (!stats.wildestSwing || game.leadChanges > stats.wildestSwing.value)) {
        stats.wildestSwing = { value: game.leadChanges, label, detail };
      }
    }
    if (matchDamage > 0 && (!stats.bloodiestMatch || matchDamage > stats.bloodiestMatch.value)) {
      stats.bloodiestMatch = { value: matchDamage, label, detail };
    }
  });
  stats.mons = [...mons.values()].sort((x, y) => y.damage - x.damage || y.kos - x.kos);
  stats.attacks = [...attackAggs.values()].sort((x, y) => y.damage - x.damage || y.uses - x.uses);
  stats.cards = [...cards.values()].sort((x, y) => y.count - x.count);
  return stats;
}

interface Award {
  icon: string;
  title: string;
  player: number;
  detail: string;
}

function computeAwards(t: Tournament, stats: TournamentStats): Award[] {
  const awards: Award[] = [];
  const best = (metric: (agg: PlayerAgg) => number): { player: number; value: number } | null => {
    let player = -1;
    let value = 0;
    stats.aggs.forEach((agg, i) => {
      const v = metric(agg);
      if (v > value) {
        value = v;
        player = i;
      }
    });
    return player >= 0 ? { player, value } : null;
  };
  const push = (
    icon: string,
    title: string,
    pick: { player: number; value: number } | null,
    detail: (v: number, agg: PlayerAgg) => string
  ) => {
    if (pick) awards.push({ icon, title, player: pick.player, detail: detail(pick.value, stats.aggs[pick.player]) });
  };
  push("💥", "Damage Dealer", best((a) => a.damage), (v, a) =>
    `${v} damage across ${a.games} games — ${Math.round(v / Math.max(1, a.games))} per game`
  );
  push("☠️", "Executioner", best((a) => a.kos), (v, a) =>
    `${v} knockouts, one every ${(a.attacks / Math.max(1, v)).toFixed(1)} attacks`
  );
  push("🎯", "Deadliest Aim", best((a) => (a.attacks >= 5 ? a.damage / a.attacks : 0)), (v) =>
    `${Math.round(v)} damage per attack on average`
  );
  push("⚔️", "Most Aggressive", best((a) => a.attacks), (v, a) =>
    `${v} attacks declared over ${a.games} games`
  );
  push("🧠", "Master Tactician", best((a) => a.trainers), (v, a) =>
    `${v} trainers played, ${(v / Math.max(1, a.games)).toFixed(1)} per game`
  );
  push("🔮", "Power Player", best((a) => a.powers), (v) => `${v} Poké-Powers fired off`);
  push("🩹", "Field Medic", best((a) => a.heals), (v) => `${v} HP patched back up`);
  push("🧬", "Evolution Expert", best((a) => a.evolutions), (v) => `${v} evolutions on the board`);
  push("🃏", "Card Shark", best((a) => a.draws), (v, a) =>
    `${v} cards drawn — ${Math.round(v / Math.max(1, a.games))} a game`
  );
  push("☣️", "Status Fiend", best((a) => a.statuses), (v) => `${v} conditions inflicted`);
  push("💨", "Whiff King", best((a) => a.whiffs), (v, a) =>
    `${v} attacks dealt zero damage (${Math.round((v / Math.max(1, a.attacks)) * 100)}% of swings)`
  );

  const undefeated = stats.aggs
    .map((agg, i) => ({ agg, i }))
    .filter((entry) => entry.agg.gameLosses === 0 && entry.agg.gameWins >= 2)
    .sort((x, y) => y.agg.gameWins - x.agg.gameWins)[0];
  if (undefeated) {
    awards.push({
      icon: "🛡️",
      title: "Flawless Run",
      player: undefeated.i,
      detail: `${undefeated.agg.gameWins}–0 in games, never dropped one`,
    });
  }

  const bestMon = stats.mons[0];
  if (bestMon && bestMon.damage > 0) {
    awards.push({
      icon: "⭐",
      title: "Signature Pokémon",
      player: bestMon.player,
      detail: `${bestMon.name} — ${bestMon.damage} damage, ${bestMon.kos} KOs`,
    });
  }

  const lucky = best((a) => (a.flips >= 4 ? a.heads / a.flips : 0));
  if (lucky && lucky.value > 0) {
    const agg = stats.aggs[lucky.player];
    awards.push({
      icon: "🍀",
      title: "Luckiest Trainer",
      player: lucky.player,
      detail: `${agg.heads} of ${agg.flips} flips came up heads (${Math.round((agg.heads / agg.flips) * 100)}%)`,
    });
  }
  const cursed = best((a) => (a.flips >= 4 ? 1 - a.heads / a.flips : 0));
  if (cursed && cursed.value > 0 && (!lucky || cursed.player !== lucky.player)) {
    const agg = stats.aggs[cursed.player];
    awards.push({
      icon: "🌧️",
      title: "Cursed Coins",
      player: cursed.player,
      detail: `only ${agg.heads} of ${agg.flips} flips landed heads (${Math.round((agg.heads / agg.flips) * 100)}%)`,
    });
  }

  const robbed = stats.aggs
    .map((agg, i) => ({ agg, i }))
    .filter((entry) => entry.agg.wins === 0 && entry.agg.losses > 0 && entry.agg.damage > 0)
    .sort((x, y) => y.agg.damage - x.agg.damage)[0];
  if (robbed) {
    awards.push({
      icon: "💔",
      title: "Robbed",
      player: robbed.i,
      detail: `${robbed.agg.damage} damage dealt and still went home 0–${robbed.agg.losses}`,
    });
  }
  return awards.filter((award) => t.players[award.player] !== undefined);
}

interface SetupRow {
  name: string;
  deck: string;
}

const MAX_PLAYERS = 16;

export function openTournamentSetup(root: HTMLElement, ctx: TournamentCtx): void {
  const decks = ctx.deckNames();
  let format: Format = "single";
  const rows: SetupRow[] = [0, 1, 2, 3].map((i) => ({
    name: "",
    deck: decks[i % decks.length],
  }));

  const draw = () => {
    root.innerHTML = "";
    const screen = el("div", "start-screen", root);
    const panel = el("div", "start-panel glass tourney-setup", screen);
    el("div", "start-title", panel, "AI Tournament");
    el("div", "start-subtitle", panel, "Pit your AI trainers against each other in a bracket");

    const formatRow = el("div", "format-toggle", panel);
    const single = el("button", `format-btn ${format === "single" ? "active" : ""}`, formatRow, "Single Elimination");
    const double = el("button", `format-btn ${format === "double" ? "active" : ""}`, formatRow, "Double Elimination");
    single.onclick = () => {
      format = "single";
      draw();
    };
    double.onclick = () => {
      format = "double";
      draw();
    };

    const list = el("div", "tp-list", panel);
    const headerRow = el("div", "tp-row tp-head", list);
    el("span", "", headerRow, "#");
    el("span", "", headerRow, "Name");
    el("span", "", headerRow, "Deck");
    el("span", "", headerRow, "");

    rows.forEach((row, i) => {
      const rowEl = el("div", "tp-row", list);
      el("span", "tp-seed", rowEl, String(i + 1));

      const nameInput = el("input", "", rowEl);
      nameInput.type = "text";
      nameInput.placeholder = `AI ${i + 1}`;
      nameInput.value = row.name;
      nameInput.oninput = () => (row.name = nameInput.value);

      const deckSelect = el("select", "", rowEl);
      for (const deck of decks) {
        const option = el("option", "", deckSelect, deck);
        option.value = deck;
      }
      deckSelect.value = row.deck;
      deckSelect.onchange = () => (row.deck = deckSelect.value);

      const remove = el("button", "tp-remove", rowEl, "✕");
      remove.disabled = rows.length <= 2;
      remove.onclick = () => {
        rows.splice(i, 1);
        draw();
      };
    });

    const manageRow = el("div", "start-manage-row", panel);
    const addButton = el("button", "menu-link-btn", manageRow, "＋ Add participant");
    addButton.disabled = rows.length >= MAX_PLAYERS;
    addButton.onclick = () => {
      rows.push({
        name: "",
        deck: decks[rows.length % decks.length],
      });
      draw();
    };
    const shuffleButton = el("button", "menu-link-btn", manageRow, "🔀 Shuffle seeds");
    shuffleButton.onclick = () => {
      for (let i = rows.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rows[i], rows[j]] = [rows[j], rows[i]];
      }
      draw();
    };
    const backButton = el("button", "menu-link-btn", manageRow, "← Back");
    backButton.onclick = ctx.showStartScreen;

    const startButton = el("button", "action-btn start-btn", panel, "Start Tournament");
    startButton.onclick = () => {
      const used = new Map<string, number>();
      const players: TournamentPlayer[] = rows.map((row, index) => {
        const base = row.name.trim() || `AI ${index + 1}`;
        const seen = used.get(base) ?? 0;
        used.set(base, seen + 1);
        return {
          name: seen === 0 ? base : `${base} ${seen + 1}`,
          deck: row.deck,
        };
      });
      for (let i = players.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [players[i], players[j]] = [players[j], players[i]];
      }
      renderBracketScreen(root, ctx, buildTournament(format, players));
    };
  };
  draw();
}

function renderBracketScreen(root: HTMLElement, ctx: TournamentCtx, t: Tournament): void {
  root.innerHTML = "";
  const screen = el("div", "tourney-screen", root);

  const header = el("div", "tourney-header glass", screen);
  const backButton = el("button", "menu-link-btn", header, "← Menu");
  backButton.onclick = ctx.showStartScreen;
  const titleWrap = el("div", "tourney-title-wrap", header);
  el("div", "tourney-title", titleWrap, "🏆 AI Tournament");
  el(
    "div",
    "tourney-format",
    titleWrap,
    `${t.format === "single" ? "Single" : "Double"} Elimination · ${t.players.length} trainers`
  );
  const played = gamesPlayed(t);
  const total = played + gamesRemaining(t);
  el("div", "tourney-progress", header, isComplete(t) ? "Complete" : `Game ${played + 1} of ${total}`);

  const champ = championOf(t);
  if (champ !== null) {
    const banner = el("div", "champion-banner glass", screen);
    el("div", "champion-trophy", banner, "🏆");
    const info = el("div", "champion-info", banner);
    el("div", "champion-label", info, "Champion");
    el("div", "champion-name", info, t.players[champ].name);
    el("div", "champion-deck", info, t.players[champ].deck);
  }

  const nextIndex = nextPlayable(t);
  const scroller = el("div", "bracket-scroll", screen);

  const wbCols: number[][] = [...t.wbRounds];
  if (t.gfIndex >= 0) {
    wbCols.push([t.gfIndex]);
    if (!t.matches[t.resetIndex].voided) wbCols.push([t.resetIndex]);
  }
  scroller.appendChild(
    renderBracketRow(t, t.format === "double" ? "Winners Bracket" : "", wbCols, nextIndex)
  );
  if (t.lbRounds.length > 0) {
    scroller.appendChild(renderBracketRow(t, "Losers Bracket", t.lbRounds, nextIndex));
  }

  const footer = el("div", "tourney-footer glass", screen);
  if (nextIndex >= 0) {
    const match = t.matches[nextIndex];
    const a = resolveSource(t, match.sources[0]) as number;
    const b = resolveSource(t, match.sources[1]) as number;
    el(
      "div",
      "tourney-next-label",
      footer,
      `Up next · ${matchTitle(t, nextIndex)}: ${t.players[a].name} vs ${t.players[b].name}`
    );
    const playButton = el("button", "action-btn next-game-btn", footer, "▶ Next Game");
    playButton.onclick = () => {
      const label = `${matchTitle(t, nextIndex)} · ${t.players[a].name} vs ${t.players[b].name}`;
      ctx.playMatch(t.players[a], t.players[b], label, (outcome) => {
        recordOutcome(t, nextIndex, outcome);
        if (isComplete(t)) renderResultsScreen(root, ctx, t);
        else renderBracketScreen(root, ctx, t);
      });
    };
  } else {
    el("div", "tourney-next-label", footer, "All matches decided. What a tournament!");
    const resultsButton = el("button", "action-btn next-game-btn", footer, "📊 View Results");
    resultsButton.onclick = () => renderResultsScreen(root, ctx, t);
    const againButton = el("button", "action-btn", footer, "New Tournament");
    againButton.onclick = () => openTournamentSetup(root, ctx);
  }
}

function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

function renderResultsScreen(root: HTMLElement, ctx: TournamentCtx, t: Tournament): void {
  root.innerHTML = "";
  const screen = el("div", "tourney-screen", root);
  const stats = computeStats(t);
  const podium = placements(t);
  const awards = computeAwards(t, stats);

  const header = el("div", "tourney-header glass", screen);
  const backButton = el("button", "menu-link-btn", header, "← Menu");
  backButton.onclick = ctx.showStartScreen;
  const titleWrap = el("div", "tourney-title-wrap", header);
  el("div", "tourney-title", titleWrap, "📊 Tournament Results");
  el(
    "div",
    "tourney-format",
    titleWrap,
    `${t.format === "single" ? "Single" : "Double"} Elimination · ${t.players.length} trainers · ${stats.gamesPlayed} games`
  );
  const bracketButton = el("button", "action-btn", header, "🗂 View Bracket");
  bracketButton.style.marginLeft = "auto";
  bracketButton.onclick = () => renderBracketScreen(root, ctx, t);

  const scroller = el("div", "results-scroll", screen);

  if (podium.first !== null) renderChampionHero(scroller, t, stats, podium.first);

  const podiumRow = el("div", "podium", scroller);
  const step = (cls: string, medal: string, place: string, players: number[]) => {
    const stepEl = el("div", `podium-step ${cls}`, podiumRow);
    el("div", "podium-medal", stepEl, medal);
    el("div", "podium-place", stepEl, place);
    for (const p of players) {
      const who = el("div", "podium-who", stepEl);
      el("div", "podium-name", who, t.players[p].name);
      el("div", "podium-deck", who, t.players[p].deck);
      el("div", "podium-record", who, `${stats.aggs[p].wins}W – ${stats.aggs[p].losses}L`);
    }
    if (players.length === 0) el("div", "podium-who podium-empty", stepEl, "—");
  };
  step("p2", "🥈", "2nd", podium.second !== null ? [podium.second] : []);
  step("p1", "🥇", "Champion", podium.first !== null ? [podium.first] : []);
  step("p3", "🥉", "3rd", podium.thirds);

  const moments: Array<{ icon: string; title: string; value: string; sub: string }> = [];
  if (stats.hardestHit) {
    const { hit, label, by, against } = stats.hardestHit;
    moments.push({
      icon: "👊",
      title: "Hardest Hit",
      value: `${hit.amount} damage`,
      sub: `${t.players[by].name}'s ${hit.attacker} used ${hit.attack} and ${
        hit.ko ? "vaporised" : "slammed"
      } ${t.players[against].name}'s ${hit.target} for ${hit.amount} on turn ${hit.turn} of the ${label}.`,
    });
  }
  if (stats.championshipPoint) {
    const { hit, label, by, against } = stats.championshipPoint;
    moments.push({
      icon: "🏁",
      title: "Championship Point",
      value: hit.attack,
      sub: `${t.players[by].name} sealed the ${label} when ${hit.attacker} used ${hit.attack} to knock out ${t.players[against].name}'s ${hit.target}.`,
    });
  }
  if (stats.biggestComeback) {
    const { player, deficit, label, detail } = stats.biggestComeback;
    moments.push({
      icon: "📈",
      title: "Biggest Comeback",
      value: `${deficit} prizes down`,
      sub: `${t.players[player].name} was ${deficit} prize${deficit === 1 ? "" : "s"} from the grave in the ${label} (${detail}) and still took the game.`,
    });
  }
  if (stats.fastestGame) {
    moments.push({
      icon: "⚡",
      title: "Quickest Victory",
      value: `${stats.fastestGame.value} turns`,
      sub: `${stats.fastestGame.detail} was over before it started — the ${stats.fastestGame.label} took just ${stats.fastestGame.value} turns.`,
    });
  }
  if (stats.longestGame && stats.longestGame.value !== stats.fastestGame?.value) {
    moments.push({
      icon: "🐢",
      title: "The Marathon",
      value: `${stats.longestGame.value} turns`,
      sub: `${stats.longestGame.detail} refused to end, grinding through ${stats.longestGame.value} turns in the ${stats.longestGame.label}.`,
    });
  }
  if (stats.bloodiestMatch) {
    moments.push({
      icon: "🩸",
      title: "Bloodiest Match",
      value: `${stats.bloodiestMatch.value} damage`,
      sub: `${stats.bloodiestMatch.detail} left nothing standing — ${stats.bloodiestMatch.value} damage traded across the ${stats.bloodiestMatch.label}.`,
    });
  }
  if (stats.wildestSwing) {
    moments.push({
      icon: "🎢",
      title: "Wildest Swing",
      value: `${stats.wildestSwing.value} lead changes`,
      sub: `The prize race flipped ${stats.wildestSwing.value} times in the ${stats.wildestSwing.label} (${stats.wildestSwing.detail}).`,
    });
  }
  if (stats.suddenDeaths > 0) {
    moments.push({
      icon: "💀",
      title: "Sudden Death",
      value: `${stats.suddenDeaths}×`,
      sub: `${stats.suddenDeaths} game${stats.suddenDeaths === 1 ? "" : "s"} couldn't be settled in regulation and went to a one-prize overtime.`,
    });
  }
  if (moments.length > 0) {
    el("div", "results-heading", scroller, "Moments of the Tournament");
    const momentsGrid = el("div", "moments-grid", scroller);
    for (const m of moments) {
      const card = el("div", "moment-card glass", momentsGrid);
      el("div", "moment-icon", card, m.icon);
      el("div", "moment-value", card, m.value);
      el("div", "moment-title", card, m.title);
      el("div", "moment-sub", card, m.sub);
    }
  }

  renderHallOfFame(scroller, t, stats);
  renderDamageRace(scroller, t, stats);

  if (awards.length > 0) {
    el("div", "results-heading", scroller, "Awards");
    const awardsGrid = el("div", "awards-grid", scroller);
    for (const award of awards) {
      const card = el("div", "award-card glass", awardsGrid);
      el("div", "award-icon", card, award.icon);
      const info = el("div", "award-info", card);
      el("div", "award-title", info, award.title);
      el("div", "award-player", info, t.players[award.player].name);
      el("div", "award-detail", info, award.detail);
    }
  }

  el("div", "results-heading", scroller, "Tournament Totals");
  const totalsGrid = el("div", "totals-grid", scroller);
  const total = (value: string, label: string) => {
    const card = el("div", "total-card glass", totalsGrid);
    el("div", "total-value", card, value);
    el("div", "total-label", card, label);
  };
  const perGame = (value: number) => (stats.gamesPlayed > 0 ? (value / stats.gamesPlayed).toFixed(1) : "0");
  total(String(stats.gamesPlayed), "games played");
  total(String(stats.totalTurns), "turns of battle");
  total(perGame(stats.totalTurns), "avg turns per game");
  total(String(stats.totalDamage), "total damage");
  total(perGame(stats.totalDamage), "damage per game");
  total(
    stats.totalAttacks > 0 ? String(Math.round(stats.totalDamage / stats.totalAttacks)) : "0",
    "damage per attack"
  );
  total(String(stats.totalKos), "knockouts");
  total(String(stats.totalPrizes), "prize cards taken");
  total(String(stats.totalAttacks), "attacks declared");
  total(
    stats.totalAttacks > 0 ? `${Math.round((stats.totalWhiffs / stats.totalAttacks) * 100)}%` : "0",
    "attacks that whiffed"
  );
  total(String(stats.totalEvolutions), "evolutions");
  total(String(stats.totalPowers), "Poké-Powers used");
  total(String(stats.totalTrainers), "trainers played");
  total(String(stats.totalEnergies), "energy attached");
  total(String(stats.totalDraws), "cards drawn");
  total(String(stats.totalHeals), "HP healed");
  total(String(stats.totalStatuses), "conditions inflicted");
  total(
    stats.coinFlips > 0
      ? `${stats.coinFlips} · ${Math.round((stats.coinHeads / stats.coinFlips) * 100)}%`
      : "0",
    "coin flips · heads rate"
  );

  renderMostPlayed(scroller, stats);

  el("div", "results-heading", scroller, "Final Standings");
  const order: number[] = [];
  const pushOrder = (p: number | null) => {
    if (p !== null && !order.includes(p)) order.push(p);
  };
  pushOrder(podium.first);
  pushOrder(podium.second);
  for (const p of podium.thirds) pushOrder(p);
  t.players
    .map((_, i) => i)
    .filter((i) => !order.includes(i))
    .sort((x, y) => stats.aggs[y].wins - stats.aggs[x].wins || stats.aggs[y].kos - stats.aggs[x].kos)
    .forEach((i) => order.push(i));
  const table = el("table", "standings-table glass", scroller);
  const head = el("tr", "", el("thead", "", table));
  for (const h of ["#", "Trainer", "Deck", "Matches", "Games", "KOs", "Prizes", "Damage", "DMG/Atk", "Ace"]) {
    el("th", "", head, h);
  }
  const tbody = el("tbody", "", table);
  order.forEach((p, rank) => {
    const agg = stats.aggs[p];
    const ace = stats.mons.find((mon) => mon.player === p && mon.damage > 0);
    const row = el("tr", rank === 0 ? "champ-row" : "", tbody);
    el("td", "", row, rank === 0 ? "🥇" : rank === 1 ? "🥈" : podium.thirds.includes(p) ? "🥉" : String(rank + 1));
    el("td", "st-name", row, t.players[p].name);
    el("td", "st-deck", row, t.players[p].deck);
    el("td", "", row, `${agg.wins}–${agg.losses}`);
    el("td", "", row, `${agg.gameWins}–${agg.gameLosses}`);
    el("td", "", row, String(agg.kos));
    el("td", "", row, String(agg.prizes));
    el("td", "", row, String(agg.damage));
    el("td", "", row, agg.attacks > 0 ? String(Math.round(agg.damage / agg.attacks)) : "—");
    el("td", "st-deck", row, ace ? `${ace.name} (${ace.kos} KO)` : "—");
  });

  const footer = el("div", "tourney-footer glass", screen);
  el("div", "tourney-next-label", footer, "GG! Run it back?");
  const againButton = el("button", "action-btn next-game-btn", footer, "New Tournament");
  againButton.onclick = () => openTournamentSetup(root, ctx);
}

function renderChampionHero(scroller: HTMLElement, t: Tournament, stats: TournamentStats, champ: number): void {
  const agg = stats.aggs[champ];
  const run = stats.runs[champ];
  const hero = el("div", "champ-hero glass", scroller);
  el("div", "champ-hero-glow", hero);
  const crest = el("div", "champ-hero-crest", hero);
  el("div", "champ-hero-trophy", crest, "🏆");
  const body = el("div", "champ-hero-body", hero);
  el("div", "champ-hero-label", body, "Tournament Champion");
  el("div", "champ-hero-name", body, t.players[champ].name);
  el("div", "champ-hero-deck", body, t.players[champ].deck);

  const beaten = run.filter((entry) => entry.won && !entry.walkover).map((entry) => t.players[entry.opponent].name);
  const byes = run.filter((entry) => entry.won && entry.walkover).length;
  const story: string[] = [];
  if (beaten.length > 0) {
    story.push(`Went ${agg.wins}–${agg.losses} in matches and ${agg.gameWins}–${agg.gameLosses} in games`);
    story.push(`beating ${beaten.join(", ")} on the way to the title`);
  }
  if (byes > 0) story.push(`${byes} bye${byes === 1 ? "" : "s"} along the way`);
  if (story.length > 0) el("div", "champ-hero-story", body, `${story.join(", ")}.`);

  const ace = stats.mons.find((mon) => mon.player === champ && mon.damage > 0);
  const aceAttack = stats.attacks.find((line) => line.player === champ && line.damage > 0);
  const line = el("div", "champ-hero-stats", body);
  const stat = (value: string, label: string) => {
    const cell = el("div", "champ-hero-stat", line);
    el("div", "champ-hero-stat-value", cell, value);
    el("div", "champ-hero-stat-label", cell, label);
  };
  stat(String(agg.damage), "damage dealt");
  stat(String(agg.kos), "knockouts");
  stat(agg.attacks > 0 ? String(Math.round(agg.damage / agg.attacks)) : "0", "dmg / attack");
  stat(agg.flips > 0 ? `${Math.round((agg.heads / agg.flips) * 100)}%` : "—", "heads rate");

  if (ace || aceAttack) {
    const bits: string[] = [];
    if (ace) bits.push(`${ace.name} carried the run with ${ace.damage} damage and ${ace.kos} KOs`);
    if (aceAttack) bits.push(`${aceAttack.attack} was the closer, hitting for up to ${aceAttack.best}`);
    el("div", "champ-hero-ace", body, `${bits.join(". ")}.`);
  }

  if (run.length > 0) {
    const path = el("div", "champ-hero-path", body);
    run.forEach((entry) => {
      const node = el("div", `champ-path-node ${entry.won ? "won" : "lost"}`, path);
      el("div", "champ-path-round", node, entry.label);
      el("div", "champ-path-foe", node, entry.walkover ? "bye" : t.players[entry.opponent].name);
      el("div", "champ-path-score", node, entry.score ? `${entry.score[0]}–${entry.score[1]}` : entry.won ? "W" : "L");
    });
  }
}

function renderHallOfFame(scroller: HTMLElement, t: Tournament, stats: TournamentStats): void {
  const mons = stats.mons.filter((mon) => mon.damage > 0).slice(0, 6);
  const lines = stats.attacks.filter((line) => line.damage > 0).slice(0, 6);
  if (mons.length === 0 && lines.length === 0) return;

  if (mons.length > 0) {
    el("div", "results-heading", scroller, "Pokémon Hall of Fame");
    const list = el("div", "hof-list glass", scroller);
    const top = mons[0].damage;
    mons.forEach((mon, i) => {
      const row = el("div", "hof-row", list);
      el("div", "hof-rank", row, ordinal(i + 1));
      const info = el("div", "hof-info", row);
      el("div", "hof-name", info, mon.name);
      el(
        "div",
        "hof-sub",
        info,
        `${t.players[mon.player].name} · ${mon.attacks} attacks · ${mon.kos} KOs · knocked out ${mon.timesKod}×`
      );
      const track = el("div", "hof-track", row);
      const fill = el("div", "hof-fill", track);
      fill.style.width = `${Math.max(4, (mon.damage / top) * 100)}%`;
      el("div", "hof-value", row, String(mon.damage));
    });
  }

  if (lines.length > 0) {
    el("div", "results-heading", scroller, "Signature Attacks");
    const grid = el("div", "attacks-grid", scroller);
    for (const line of lines) {
      const card = el("div", "attack-card glass", grid);
      el("div", "attack-name", card, line.attack);
      el("div", "attack-owner", card, `${line.pokemon} · ${t.players[line.player].name}`);
      const row = el("div", "attack-numbers", card);
      const cell = (value: string, label: string) => {
        const box = el("div", "attack-num", row);
        el("div", "attack-num-value", box, value);
        el("div", "attack-num-label", box, label);
      };
      cell(String(line.uses), "uses");
      cell(String(line.damage), "damage");
      cell(String(Math.round(line.damage / Math.max(1, line.uses))), "avg");
      cell(String(line.best), "best");
      cell(String(line.kos), "KOs");
    }
  }
}

function renderDamageRace(scroller: HTMLElement, t: Tournament, stats: TournamentStats): void {
  const rows = stats.aggs
    .map((agg, player) => ({ agg, player }))
    .filter((entry) => entry.agg.damage > 0)
    .sort((x, y) => y.agg.damage - x.agg.damage);
  if (rows.length < 2) return;
  el("div", "results-heading", scroller, "Damage Race");
  const chart = el("div", "race-chart glass", scroller);
  const top = rows[0].agg.damage;
  for (const { agg, player } of rows) {
    const row = el("div", "race-row", chart);
    el("div", "race-name", row, t.players[player].name);
    const track = el("div", "race-track", row);
    const fill = el("div", "race-fill", track);
    fill.style.width = `${Math.max(2, (agg.damage / top) * 100)}%`;
    el("div", "race-ko", track, `${agg.kos} KO`);
    el("div", "race-value", row, String(agg.damage));
  }
}

function renderMostPlayed(scroller: HTMLElement, stats: TournamentStats): void {
  const cards = stats.cards.slice(0, 10);
  if (cards.length === 0) return;
  el("div", "results-heading", scroller, "Most Played Cards");
  const cloud = el("div", "card-cloud", scroller);
  const top = cards[0].count;
  for (const card of cards) {
    const chip = el("div", "card-chip glass", cloud);
    el("span", "card-chip-name", chip, card.name);
    el("span", "card-chip-count", chip, `×${card.count}`);
    chip.style.opacity = String(0.55 + 0.45 * (card.count / top));
  }
}

function renderBracketRow(t: Tournament, label: string, cols: number[][], nextIndex: number): HTMLElement {
  const section = el("div", "bracket-section");
  if (label) el("div", "bracket-row-label", section, label);
  const bracket = el("div", "bracket", section);
  bracket.style.minHeight = `${cols[0].length * 108}px`;

  cols.forEach((matchIndexes, colIdx) => {
    const joinNext = colIdx + 1 < cols.length && cols[colIdx + 1].length * 2 === matchIndexes.length;
    const hasIn = colIdx > 0;
    const hasOut = colIdx + 1 < cols.length;

    const column = el("div", "b-round", bracket);
    el("div", "b-round-title", column, roundTitle(t, matchIndexes));
    const body = el("div", "b-col-body", column);

    const groupSize = joinNext ? 2 : 1;
    for (let g = 0; g < matchIndexes.length; g += groupSize) {
      const group = el("div", `b-group ${joinNext ? "joined" : ""}`, body);
      for (let i = g; i < Math.min(g + groupSize, matchIndexes.length); i++) {
        const wrap = el(
          "div",
          `b-wrap ${hasIn ? "link-in" : ""} ${hasOut ? "link-out" : ""}`,
          group
        );
        wrap.appendChild(renderMatchCard(t, matchIndexes[i], nextIndex));
      }
    }
  });
  return section;
}

function renderMatchCard(t: Tournament, index: number, nextIndex: number): HTMLElement {
  const match = t.matches[index];
  const card = el("div", "b-match glass");
  if (index === nextIndex) card.classList.add("next");
  if (match.result && !match.result.walkover) card.classList.add("done");
  if (match.result?.walkover) card.classList.add("wo");
  if (match.voided) card.classList.add("void");
  if (index === t.resetIndex && !match.result && !match.voided) {
    const gf = t.matches[t.gfIndex];
    if (!gf.result) card.classList.add("maybe");
  }

  ([0, 1] as const).forEach((side) => {
    const participant = resolveSource(t, match.sources[side]);
    const slot = el("div", "b-slot", card);
    if (participant === null) {
      slot.classList.add("bye");
      el("span", "b-name", slot, "— bye —");
      return;
    }
    if (participant === undefined) {
      slot.classList.add("tbd");
      el("span", "b-name", slot, card.classList.contains("maybe") ? "if needed" : "TBD");
      return;
    }
    const player = t.players[participant];
    el("span", "b-sd", slot, String(participant + 1));
    const info = el("span", "b-info", slot);
    el("span", "b-name", info, player.name);
    el("span", "b-deck", info, player.deck);
    if (match.result) {
      const won = match.result.winnerSide === side;
      slot.classList.add(won ? "win" : "loss");
      const scoreText = match.result.score ? String(match.result.score[side]) : won ? "✓" : "";
      el("span", "b-score", slot, scoreText);
    }
  });
  return card;
}
