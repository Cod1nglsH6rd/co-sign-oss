/**
 * startOcrWorkerLoop (lib/ocrWorkerLoop.js): runs an injected tick right away
 * and then every intervalMs, never two at once, logging (not throwing) a
 * failed tick. Driven by Jest fake timers.
 */

function loadStart() {
  let mod = {};
  try {
    // eslint-disable-next-line global-require
    mod = require('../../lib/ocrWorkerLoop');
  } catch (e) {
    mod = {};
  }
  expect(typeof mod.startOcrWorkerLoop).toBe('function');
  return mod.startOcrWorkerLoop;
}

const silentLog = () => ({ error: jest.fn(), warn: jest.fn(), log: jest.fn() });

describe('startOcrWorkerLoop', () => {
  let loop;

  beforeEach(() => {
    jest.useFakeTimers();
    loop = null;
  });

  afterEach(() => {
    if (loop) loop.stop();
    jest.useRealTimers();
  });

  it('runs the first tick at start', async () => {
    const start = loadStart();
    const tick = jest.fn().mockResolvedValue(undefined);
    loop = start({ intervalMs: 1000, tick, log: silentLog() });
    expect(tick).toHaveBeenCalledTimes(1);
    expect(typeof loop.stop).toBe('function');
  });

  it('runs a tick every intervalMs', async () => {
    const start = loadStart();
    const tick = jest.fn().mockResolvedValue(undefined);
    loop = start({ intervalMs: 1000, tick, log: silentLog() });
    await jest.advanceTimersByTimeAsync(999);
    expect(tick).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(2000);
    expect(tick).toHaveBeenCalledTimes(4);
  });

  it('does not start a tick while the previous one is still running', async () => {
    const start = loadStart();
    let running = 0;
    let maxRunning = 0;
    const tick = jest.fn(async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      running -= 1;
    });
    loop = start({ intervalMs: 1000, tick, log: silentLog() });
    // First tick runs 0..2500; the ticks due at 1000 and 2000 are skipped.
    await jest.advanceTimersByTimeAsync(2000);
    expect(tick).toHaveBeenCalledTimes(1);
    // At 3000 the first tick has finished, so a new one starts.
    await jest.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(maxRunning).toBe(1);
  });

  it('logs a throwing tick once and still runs the next tick', async () => {
    const start = loadStart();
    const log = silentLog();
    const boom = new Error('boom');
    const tick = jest
      .fn()
      .mockImplementationOnce(() => {
        throw boom;
      })
      .mockRejectedValueOnce(boom)
      .mockResolvedValue(undefined);
    expect(() => {
      loop = start({ intervalMs: 1000, tick, log });
    }).not.toThrow();
    await jest.advanceTimersByTimeAsync(0);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0]).toContain(boom);

    await jest.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(log.error).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(3);
    expect(log.error).toHaveBeenCalledTimes(2);
  });

  it('logs through console when no log is given', async () => {
    const start = loadStart();
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const tick = jest.fn().mockRejectedValue(new Error('nope'));
      loop = start({ intervalMs: 1000, tick });
      await jest.advanceTimersByTimeAsync(0);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('starts no tick after stop()', async () => {
    const start = loadStart();
    const tick = jest.fn().mockResolvedValue(undefined);
    loop = start({ intervalMs: 1000, tick, log: silentLog() });
    await jest.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(2);
    loop.stop();
    await jest.advanceTimersByTimeAsync(5000);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not start a skipped tick when stop() is called mid-tick', async () => {
    const start = loadStart();
    const tick = jest.fn(() => new Promise((resolve) => setTimeout(resolve, 1500)));
    loop = start({ intervalMs: 1000, tick, log: silentLog() });
    await jest.advanceTimersByTimeAsync(500);
    loop.stop();
    await jest.advanceTimersByTimeAsync(5000);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('puts the loop on an unref\'d timer', () => {
    const start = loadStart();
    const unref = jest.fn();
    const realSetInterval = global.setInterval;
    const spy = jest.spyOn(global, 'setInterval').mockImplementation((fn, ms) => {
      const handle = realSetInterval(fn, ms);
      const original = handle.unref ? handle.unref.bind(handle) : () => handle;
      handle.unref = () => {
        unref();
        return original();
      };
      return handle;
    });
    try {
      loop = start({ intervalMs: 1000, tick: jest.fn().mockResolvedValue(undefined), log: silentLog() });
      expect(spy).toHaveBeenCalledWith(expect.any(Function), 1000);
      expect(unref).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
