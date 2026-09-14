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
}

/** The decision this whole project is about. */
export type Router = (ask: Ask) => Engine | Promise<Engine>;

export type Event =
  | { at: "turn_start" }
  | { at: "routed"; engine: Engine; step: number }
  | { at: "text"; chunk: string }
  | { at: "call"; call: Call }
  | { at: "result"; callId: string; result: string; failed?: boolean }
  | { at: "turn_end"; transcript: readonly Entry[] };
