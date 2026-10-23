/** A scenario's state is shared through the callback's explicitly typed `this`. */
export type StepFunction<World, Arguments extends unknown[]> =
  (this: World, ...args: Arguments) => unknown;

export interface StepOptions { timeout?: number }
export interface HookOptions extends StepOptions { tags?: string }

export interface StepRegistration {
  <World = Record<string, unknown>, Arguments extends unknown[] = unknown[]>(
    pattern: string | RegExp, fn: StepFunction<World, Arguments>,
  ): void;
  <World = Record<string, unknown>, Arguments extends unknown[] = unknown[]>(
    pattern: string | RegExp, options: StepOptions, fn: StepFunction<World, Arguments>,
  ): void;
}

export interface HookRegistration {
  <World = Record<string, unknown>>(fn: (this: World) => unknown): void;
  <World = Record<string, unknown>>(options: HookOptions, fn: (this: World) => unknown): void;
}

/** Table arguments are supplied by the runner; there is no public constructor. */
export interface DataTable {
  raw(): string[][];
  rows(): string[][];
  hashes(): Record<string, string>[];
  rowsHash(): Record<string, string>;
}

export const Given: StepRegistration;
export const When: StepRegistration;
export const Then: StepRegistration;
export const Before: HookRegistration;
export const After: HookRegistration;
export function setDefaultTimeout(milliseconds: number): void;
