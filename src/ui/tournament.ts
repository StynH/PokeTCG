import { type AIProfile, PRESETS, allProfiles, findProfile } from "../ai/profiles";
import type { GameEvent } from "../engine/game";

export interface TournamentPlayer {
  name: string;
  deck: string;
  profile: AIProfile;
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
}

export interface GameStats {
  turns: number;
  suddenDeath: boolean;
  winReason: string;
  totalDamage: number;
  biggestHit: { amount: number; text: string } | null;
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
  };
}

export function collectGameStats(source: {
  events: GameEvent[];
  turnNumber: number;
  suddenDeath: boolean;
  winReason: string;
}): GameStats {
  const perSide: [SideStats, SideStats] = [emptySideStats(), emptySideStats()];
  let owner = 0;
  let totalDamage = 0;
  let coinFlips = 0;
  let coinHeads = 0;
  let biggestHit: { amount: number; text: string } | null = null;
  for (const ev of source.events) {
    if (ev.player !== undefined && (ev.cat === "turn" || ev.cat === "attack")) owner = ev.player;
    switch (ev.cat) {
      case "attack":
        perSide[ev.player ?? owner].attacks++;
        break;
      case "ko":
        if (ev.player !== undefined) perSide[1 - ev.player].kos++;
        break;
      case "prize":
        if (ev.player !== undefined) perSide[ev.player].prizes += ev.amount ?? 1;
        break;
      case "trainer":
        if (ev.player !== undefined) perSide[ev.player].trainers++;
        break;
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
        if (amount > 0 && (!biggestHit || amount > biggestHit.amount)) {
          biggestHit = { amount, text: ev.text };
        }
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
  return {
    turns: source.turnNumber,
    suddenDeath: source.suddenDeath,
    winReason: source.winReason,
    totalDamage,
    biggestHit,
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
}

interface RecordMoment {
  value: number;
  label: string;
  detail: string;
}

interface TournamentStats {
  aggs: PlayerAgg[];
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
  coinFlips: number;
  coinHeads: number;
  fastestGame: RecordMoment | null;
  longestGame: RecordMoment | null;
  bloodiestMatch: RecordMoment | null;
  hardestHit: { amount: number; text: string; detail: string } | null;
}

function computeStats(t: Tournament): TournamentStats {
  const aggs: PlayerAgg[] = t.players.map(() => ({ ...emptySideStats(), wins: 0, losses: 0, games: 0 }));
  const stats: TournamentStats = {
    aggs,
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
    coinFlips: 0,
    coinHeads: 0,
    fastestGame: null,
    longestGame: null,
    bloodiestMatch: null,
    hardestHit: null,
  };
  t.matches.forEach((match, index) => {
    if (!match.result || match.result.walkover) return;
    const a = resolveSource(t, match.sources[0]);
    const b = resolveSource(t, match.sources[1]);
    if (typeof a !== "number" || typeof b !== "number") return;
    const sides: [number, number] = [a, b];
    const label = matchTitle(t, index);
    const detail = `${t.players[a].name} vs ${t.players[b].name}`;
    aggs[sides[match.result.winnerSide]].wins++;
    aggs[sides[1 - match.result.winnerSide]].losses++;
    let matchDamage = 0;
    for (const game of match.result.games ?? []) {
      stats.gamesPlayed++;
      if (game.suddenDeath) stats.suddenDeaths++;
      stats.totalTurns += game.turns;
      stats.totalDamage += game.totalDamage;
      stats.coinFlips += game.coinFlips;
      stats.coinHeads += game.coinHeads;
      matchDamage += game.totalDamage;
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
      });
      if (!game.suddenDeath) {
        if (!stats.fastestGame || game.turns < stats.fastestGame.value) {
          stats.fastestGame = { value: game.turns, label, detail };
        }
        if (!stats.longestGame || game.turns > stats.longestGame.value) {
          stats.longestGame = { value: game.turns, label, detail };
        }
      }
      if (game.biggestHit && (!stats.hardestHit || game.biggestHit.amount > stats.hardestHit.amount)) {
        stats.hardestHit = { ...game.biggestHit, detail: `${label} · ${detail}` };
      }
    }
    if (matchDamage > 0 && (!stats.bloodiestMatch || matchDamage > stats.bloodiestMatch.value)) {
      stats.bloodiestMatch = { value: matchDamage, label, detail };
    }
  });
  return stats;
}

interface Award {
  icon: string;
  title: string;
  player: number;
  detail: string;
}

function computeAwards(stats: TournamentStats): Award[] {
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
  const push = (icon: string, title: string, pick: { player: number; value: number } | null, detail: (v: number) => string) => {
    if (pick) awards.push({ icon, title, player: pick.player, detail: detail(pick.value) });
  };
  push("💥", "Damage Dealer", best((a) => a.damage), (v) => `${v} damage dished out`);
  push("☠️", "Executioner", best((a) => a.kos), (v) => `${v} knockouts`);
  push("⚔️", "Most Aggressive", best((a) => a.attacks), (v) => `${v} attacks declared`);
  push("🧠", "Master Tactician", best((a) => a.trainers), (v) => `${v} trainers played`);
  push("🔮", "Power Player", best((a) => a.powers), (v) => `${v} Poké-Powers used`);
  push("🩹", "Field Medic", best((a) => a.heals), (v) => `${v} HP healed`);
  push("🧬", "Evolution Expert", best((a) => a.evolutions), (v) => `${v} evolutions`);
  push("🃏", "Card Shark", best((a) => a.draws), (v) => `${v} cards drawn`);
  const lucky = best((a) => (a.flips >= 4 ? a.heads / a.flips : 0));
  if (lucky && lucky.value > 0) {
    const agg = stats.aggs[lucky.player];
    awards.push({
      icon: "🍀",
      title: "Luckiest Trainer",
      player: lucky.player,
      detail: `${Math.round((agg.heads / agg.flips) * 100)}% heads (${agg.heads}/${agg.flips})`,
    });
  }
  const cursed = best((a) => (a.flips >= 4 ? 1 - a.heads / a.flips : 0));
  if (cursed && cursed.value > 0 && (!lucky || cursed.player !== lucky.player)) {
    const agg = stats.aggs[cursed.player];
    awards.push({
      icon: "🌧️",
      title: "Cursed Coins",
      player: cursed.player,
      detail: `${Math.round((agg.heads / agg.flips) * 100)}% heads (${agg.heads}/${agg.flips})`,
    });
  }
  return awards;
}

interface SetupRow {
  name: string;
  profile: string;
  deck: string;
}

const MAX_PLAYERS = 16;

export function openTournamentSetup(root: HTMLElement, ctx: TournamentCtx): void {
  const decks = ctx.deckNames();
  let format: Format = "single";
  const rows: SetupRow[] = [0, 1, 2, 3].map((i) => ({
    name: "",
    profile: PRESETS[i % PRESETS.length].name,
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
    el("span", "", headerRow, "AI Profile");
    el("span", "", headerRow, "Deck");
    el("span", "", headerRow, "");

    rows.forEach((row, i) => {
      const rowEl = el("div", "tp-row", list);
      el("span", "tp-seed", rowEl, String(i + 1));

      const nameInput = el("input", "", rowEl);
      nameInput.type = "text";
      nameInput.placeholder = row.profile;
      nameInput.value = row.name;
      nameInput.oninput = () => (row.name = nameInput.value);

      const profileSelect = el("select", "", rowEl);
      for (const profile of allProfiles()) {
        const option = el("option", "", profileSelect, profile.name);
        option.value = profile.name;
      }
      profileSelect.value = row.profile;
      profileSelect.onchange = () => {
        row.profile = profileSelect.value;
        nameInput.placeholder = row.profile;
      };

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
    const addButton = el("button", "manage-profiles-btn", manageRow, "＋ Add participant");
    addButton.disabled = rows.length >= MAX_PLAYERS;
    addButton.onclick = () => {
      rows.push({
        name: "",
        profile: PRESETS[rows.length % PRESETS.length].name,
        deck: decks[rows.length % decks.length],
      });
      draw();
    };
    const shuffleButton = el("button", "manage-profiles-btn", manageRow, "🔀 Shuffle seeds");
    shuffleButton.onclick = () => {
      for (let i = rows.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rows[i], rows[j]] = [rows[j], rows[i]];
      }
      draw();
    };
    const backButton = el("button", "manage-profiles-btn", manageRow, "← Back");
    backButton.onclick = ctx.showStartScreen;

    const startButton = el("button", "action-btn start-btn", panel, "Start Tournament");
    startButton.onclick = () => {
      const used = new Map<string, number>();
      const players: TournamentPlayer[] = rows.map((row) => {
        const base = row.name.trim() || row.profile;
        const seen = used.get(base) ?? 0;
        used.set(base, seen + 1);
        return {
          name: seen === 0 ? base : `${base} ${seen + 1}`,
          deck: row.deck,
          profile: findProfile(row.profile),
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
  const backButton = el("button", "manage-profiles-btn", header, "← Menu");
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

function renderResultsScreen(root: HTMLElement, ctx: TournamentCtx, t: Tournament): void {
  root.innerHTML = "";
  const screen = el("div", "tourney-screen", root);
  const stats = computeStats(t);
  const podium = placements(t);
  const awards = computeAwards(stats);

  const header = el("div", "tourney-header glass", screen);
  const backButton = el("button", "manage-profiles-btn", header, "← Menu");
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
  if (stats.fastestGame) {
    moments.push({
      icon: "⚡",
      title: "Quickest Victory",
      value: `${stats.fastestGame.value} turns`,
      sub: `${stats.fastestGame.label} · ${stats.fastestGame.detail}`,
    });
  }
  if (stats.longestGame && stats.longestGame.value !== stats.fastestGame?.value) {
    moments.push({
      icon: "🐢",
      title: "The Marathon",
      value: `${stats.longestGame.value} turns`,
      sub: `${stats.longestGame.label} · ${stats.longestGame.detail}`,
    });
  }
  if (stats.bloodiestMatch) {
    moments.push({
      icon: "🩸",
      title: "Bloodiest Match",
      value: `${stats.bloodiestMatch.value} damage`,
      sub: `${stats.bloodiestMatch.label} · ${stats.bloodiestMatch.detail}`,
    });
  }
  if (stats.hardestHit) {
    moments.push({
      icon: "👊",
      title: "Hardest Hit",
      value: `${stats.hardestHit.amount} damage`,
      sub: `${stats.hardestHit.text} · ${stats.hardestHit.detail}`,
    });
  }
  if (stats.suddenDeaths > 0) {
    moments.push({
      icon: "💀",
      title: "Sudden Death",
      value: `${stats.suddenDeaths}×`,
      sub: "games went to a one-prize overtime",
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
  const avgTurns = stats.gamesPlayed > 0 ? (stats.totalTurns / stats.gamesPlayed).toFixed(1) : "0";
  total(String(stats.gamesPlayed), "games played");
  total(String(stats.totalTurns), "turns of battle");
  total(avgTurns, "avg turns per game");
  total(String(stats.totalDamage), "total damage");
  total(String(stats.totalKos), "knockouts");
  total(String(stats.totalPrizes), "prize cards taken");
  total(String(stats.totalAttacks), "attacks declared");
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
  for (const h of ["#", "Trainer", "Deck", "W–L", "KOs", "Prizes", "Damage", "Attacks"]) {
    el("th", "", head, h);
  }
  const tbody = el("tbody", "", table);
  order.forEach((p, rank) => {
    const agg = stats.aggs[p];
    const row = el("tr", rank === 0 ? "champ-row" : "", tbody);
    el("td", "", row, rank === 0 ? "🥇" : rank === 1 ? "🥈" : podium.thirds.includes(p) ? "🥉" : String(rank + 1));
    el("td", "st-name", row, t.players[p].name);
    el("td", "st-deck", row, t.players[p].deck);
    el("td", "", row, `${agg.wins}–${agg.losses}`);
    el("td", "", row, String(agg.kos));
    el("td", "", row, String(agg.prizes));
    el("td", "", row, String(agg.damage));
    el("td", "", row, String(agg.attacks));
  });

  const footer = el("div", "tourney-footer glass", screen);
  el("div", "tourney-next-label", footer, "GG! Run it back?");
  const againButton = el("button", "action-btn next-game-btn", footer, "New Tournament");
  againButton.onclick = () => openTournamentSetup(root, ctx);
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
