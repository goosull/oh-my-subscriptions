// Our vocabulary. Nothing from a vendor package appears here on purpose: this is the
// shape the rest of the program is written against, and swapping what carries the bytes
// underneath should not reach it.

/** One entry in a conversation. Transcripts are plain data and outlive any one model. */
export type Entry =
  | { from: "user"; text: string }
  | { from: "model"; by: Engine; said: string; calls: Call[] }
  | { from: "tool"; callId: string; tool: string; result: string; failed?: boolean };

/** A model call this turn asked for. */
export interface Call {
  id: string;
  tool: string;
  input: Record<string, unknown>;
}

/** Who answered, and on whose dime. */
export interface Engine {
  /** Stable id we route by, e.g. "codex:gpt-5-codex". */
  id: string;
  /** The subscription this spends, as oms names it. Undefined for anything unmetered. */
  account?: string;
}

export interface Tool {
  name: string;
  describe: string;
  /** JSON Schema for the input. */
  input: Record<string, unknown>;
  run(input: any, signal?: AbortSignal): Promise<{ result: string; failed?: boolean }>;
}

/**
 * Everything the router is told before a single request. It is asked again before every
 * request, not once per turn — so a cheap engine can take the tool-calling and a strong
 * one can take the answer, inside one turn.
 */
export interface Ask {
  /** The conversation so far, oldest first. */
  transcript: readonly Entry[];
  /** Tool results arrived since the last model request. Empty on the first request. */
  since: readonly Entry[];
  /** How many requests this turn has already made. */
  step: number;
  /** Who answered the previous request, if anyone has yet. */
  current?: string;
  /**
   * Characters `engine` would be sent with no cache behind them, because it has not
   * been shown them. Two different things land in here: what is simply new since the
   * last request, which every engine pays for, and what went to somebody else, which
   * only a newcomer pays for.
   */
  priceOf(engine: string): number;
  /**
   * What moving to `engine` costs over staying where we are — `priceOf(engine)` less
   * what the current engine would be charged anyway. This is the number a router is
   * actually deciding on, and it is zero on the first request of a conversation, when
   * nobody is warm and there is nothing to leave.
   */
  penaltyOf(engine: string): number;
}

/** The decision this whole project is about. */
export type Router = (ask: Ask) => Engine | Promise<Engine>;

/** What one request actually put on the wire, and how much of it was already sent once. */
export interface Sent {
  /** Characters of transcript in this request. */
  size: number;
  /** Of those, characters this engine had never seen, so no cache could have covered them. */
  cold: number;
  /** True when the previous request went to a different engine. */
  switched: boolean;
}

export type Event =
  | { at: "turn_start" }
  | { at: "routed"; engine: Engine; step: number; sent: Sent }
  | { at: "text"; chunk: string }
  | { at: "call"; call: Call }
  | { at: "result"; callId: string; result: string; failed?: boolean }
  | { at: "turn_end"; transcript: readonly Entry[]; cost: Cost };

/**
 * How much of the transcript each engine has already been shown, and what routing has
 * cost so far. A provider's prompt cache outlives a single turn, so this has to be held
 * by whoever owns the conversation — kept inside one turn it would forget between them
 * and report every turn as a fresh switch.
 */
export interface Ledger {
  seen: Map<string, number>;
  cost: Cost;
}

export const ledger = (): Ledger => ({ seen: new Map(), cost: { sent: 0, resent: 0, switches: 0 } });

/** What routing cost. */
export interface Cost {
  /** Characters sent across every request this turn. */
  sent: number;
  /** Of those, characters resent only because a request went to an engine that had not
   *  seen them. Staying on one engine makes this zero. */
  resent: number;
  switches: number;
}
