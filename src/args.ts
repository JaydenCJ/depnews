/**
 * Tiny, strict flag parser. Knows three flag shapes — string, repeatable
 * string, boolean — plus `--flag=value`. Unknown flags are hard errors so a
 * typo can never silently change what gets reported.
 */

import { UsageError } from "./types.js";

export interface FlagSpec {
  /** Flags that take a single value; a repeat is an error. */
  strings?: string[];
  /** Flags that take a value and may repeat (collected in order). */
  lists?: string[];
  /** Presence-only flags. */
  booleans?: string[];
  /** Alias map, e.g. { "-h": "--help" }. */
  aliases?: Record<string, string>;
}

export interface ParsedArgs {
  positionals: string[];
  strings: Map<string, string>;
  lists: Map<string, string[]>;
  booleans: Set<string>;
}

/** Parse argv (already stripped of node + script) against a spec. Throws UsageError. */
export function parseFlags(argv: string[], spec: FlagSpec): ParsedArgs {
  const strings = new Set(spec.strings ?? []);
  const lists = new Set(spec.lists ?? []);
  const booleans = new Set(spec.booleans ?? []);
  const aliases = spec.aliases ?? {};
  const out: ParsedArgs = {
    positionals: [],
    strings: new Map(),
    lists: new Map(),
    booleans: new Set(),
  };

  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i] ?? "";
    if (arg === "--") {
      out.positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "-" || !arg.startsWith("-")) {
      out.positionals.push(arg);
      continue;
    }

    let inlineValue: string | null = null;
    const eq = arg.indexOf("=");
    if (arg.startsWith("--") && eq !== -1) {
      inlineValue = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    }
    const flag = aliases[arg] ?? arg;

    if (booleans.has(flag)) {
      if (inlineValue !== null) throw new UsageError(`${flag} does not take a value`);
      out.booleans.add(flag);
      continue;
    }

    const isString = strings.has(flag);
    const isList = lists.has(flag);
    if (!isString && !isList) throw new UsageError(`unknown flag: ${arg}`);

    let value = inlineValue;
    if (value === null) {
      value = argv[i + 1] ?? null;
      if (value === null) throw new UsageError(`${flag} requires a value`);
      i += 1;
    }

    if (isList) {
      const list = out.lists.get(flag) ?? [];
      list.push(value);
      out.lists.set(flag, list);
    } else {
      if (out.strings.has(flag)) throw new UsageError(`${flag} was given more than once`);
      out.strings.set(flag, value);
    }
  }

  return out;
}

/** Split a comma-separated flag value into trimmed, non-empty parts. */
export function splitList(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Parse a non-negative integer flag value (0 is a valid cap: "show nothing"). */
export function parseNonNegativeInt(flag: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new UsageError(`${flag} expects a non-negative integer, got "${value}"`);
  return n;
}
