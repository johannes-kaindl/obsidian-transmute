// vendored from code-kit@0.75.0, src/ts/web/macrotask-pause.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** A pause that lets the event loop turn once, without a timer: `createMacrotaskPause()` → `{ pause(), close() }`.
 *
 *  ── What it is for ──────────────────────────────────────────────────────────────────────
 *  A long loop has to hand the thread back now and then, or the interface freezes (see `pure/cooperative-yield`, which takes the pause
 *  as `yieldToUi`). The usual pause, `new Promise((r) => window.setTimeout(r, 0))`, is throttled by Chromium in a window that is not in
 *  the foreground: 250 ms to 1 s per call, in the worst case a minute. A loop that pauses every 250 ms and waits a second each time is
 *  mostly waiting. Measured in docs-mirror (commit 1995edb, a real scan of 127 177 entries): with the timer at 250 ms delay 11 559
 *  entries in 20 s (about 3.7 minutes in all), at 1000 ms 10 103 in 20 s; through a `MessageChannel` the same load took 2.4 s in all.
 *  A message on a channel is a task of its own that no throttling delays, and the interface still gets its turn between two of them.
 *
 *  ── The contract ────────────────────────────────────────────────────────────────────────
 *  - `pause()` resolves in a LATER macrotask: every microtask that is queued when it is called, and at least one turn of the event loop,
 *    come before it. It reads no clock and sets no timer.
 *  - Several open pauses resolve in the order they were called.
 *  - `close()` resolves every open pause at once and closes the ports. After `close()`, `pause()` resolves as a microtask and never
 *    hangs, so a loop that is still running when its plugin unloads ends instead of waiting for a message that never comes. `close()`
 *    may be called again.
 *  - An open channel does not keep a Node process alive: while no pause is waiting the ports are `unref`'d, while one is waiting they
 *    are `ref`'d (a pause that is waiting must get its message). A browser has neither method and needs neither.
 *  - Nothing reads `window`. `MessageChannel` is read as the global of the host; a test (or a host without one) passes its own:
 *    `createMacrotaskPause({ MessageChannel })`. Without any it throws at creation, not at the first pause in the middle of a loop.
 *
 *  ── Taking it over ──────────────────────────────────────────────────────────────────────
 *  One instance per plugin or per run, not one per call: it creates its channel at the first `pause()` and keeps it. Call `close()` on
 *  unload. Use it as the pause of `cooperative-yield`: `createCooperativeYield({ yieldToUi: () => pause.pause() })`. `cooperative-yield`
 *  stamps its barrier BEFORE the `await` (its point 4), so a pause that takes a second, as the throttled timer does, makes the next tick
 *  due at once; a pause that takes a message does not.
 *
 *  Origin: docs-mirror `src/main.ts` (`createMacrotaskPause`, commit 1995edb, Welle 33), n = 1. Differences from that copy: the channel
 *  class is injectable, `close()` also covers a `pause()` after it, and the ports are `unref`'d while nothing waits (the copy kept the
 *  process alive in Node). */

/** The part of a message port this module uses. The `ref`/`unref` pair exists in Node only. */
export interface MacrotaskPort {
  onmessage: ((event: unknown) => void) | null;
  postMessage(message: unknown): void;
  close(): void;
  ref?(): void;
  unref?(): void;
}

/** The part of a `MessageChannel` this module uses. */
export interface MacrotaskChannel {
  port1: MacrotaskPort;
  port2: MacrotaskPort;
}

export interface MacrotaskPauseOptions {
  /** The channel class. Default: the global `MessageChannel`. */
  MessageChannel?: (new () => MacrotaskChannel) | undefined;
}

export interface MacrotaskPause {
  /** Resolves in a later macrotask (see the module header). */
  pause(): Promise<void>;
  /** Resolves every open pause now, closes the ports; a later `pause()` resolves as a microtask. Idempotent. */
  close(): void;
}

export function createMacrotaskPause(opts: MacrotaskPauseOptions = {}): MacrotaskPause {
  const Channel = opts.MessageChannel ?? (typeof MessageChannel === "undefined" ? undefined : (MessageChannel as unknown as new () => MacrotaskChannel));
  if (Channel === undefined) throw new Error("createMacrotaskPause: no MessageChannel in this host; pass one as an option");

  let channel: MacrotaskChannel | null = null;
  let closed = false;
  const waiting: (() => void)[] = [];

  const hold = (on: boolean): void => {
    if (channel === null) return;
    if (on) { channel.port1.ref?.(); channel.port2.ref?.(); }
    else { channel.port1.unref?.(); channel.port2.unref?.(); }
  };

  return {
    pause: () => {
      if (closed) return Promise.resolve();
      return new Promise<void>((resolve) => {
        if (channel === null) {
          channel = new Channel();
          channel.port1.onmessage = () => {
            waiting.shift()?.();
            if (waiting.length === 0) hold(false);
          };
        }
        waiting.push(resolve);
        hold(true);
        channel.port2.postMessage(null);
      });
    },
    close: () => {
      closed = true;
      const open = channel;
      channel = null;
      if (open !== null) {
        open.port1.onmessage = null;
        open.port1.close();
        open.port2.close();
      }
      for (const resolve of waiting.splice(0)) resolve();
    },
  };
}
