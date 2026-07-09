export type EventCat =
  | "turn"
  | "attack"
  | "power"
  | "damage"
  | "ko"
  | "status"
  | "heal"
  | "energy"
  | "evolve"
  | "draw"
  | "prize"
  | "coin"
  | "switch"
  | "trainer"
  | "bench"
  | "win"
  | "info";

export interface GameEvent {
  seq: number;
  cat: EventCat;
  text: string;
  turn: number;
  player?: number;
  uid?: number;
  amount?: number;
}
