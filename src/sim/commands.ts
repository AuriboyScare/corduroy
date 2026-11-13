/**
 * Everything a player can do to the world goes through one of these. The world validates and
 * applies them; later the same objects are journalled for crash recovery and sent over the
 * network in multiplayer.
 */
export type Command =
  | { readonly type: 'buyMachine'; readonly model: string }
  | { readonly type: 'buyUpgrade'; readonly machine: number; readonly upgrade: string }
  | { readonly type: 'switchMachine'; readonly machine: number }
  | { readonly type: 'winch'; readonly machine: number; readonly hook: boolean };

export type CommandResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export const OK: CommandResult = { ok: true };
export const fail = (reason: string): CommandResult => ({ ok: false, reason });
