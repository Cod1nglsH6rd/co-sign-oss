import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const BASE_DELAYS_MS = [0, 1500, 2500, 4000, 6500, 10000, 15000];

function getDelayMs(attemptIndex) {
  if (attemptIndex < BASE_DELAYS_MS.length) return BASE_DELAYS_MS[attemptIndex];
  return 15000;
}

function withJitter(delayMs) {
  if (!delayMs) return 0;
  const jitter = 0.2; // +-20%
  const randomFactor = 1 + ((Math.random() * 2) - 1) * jitter;
  return Math.max(250, Math.round(delayMs * randomFactor));
}

export function useNotReadyRecovery({
  maxAttempts = 45,
  maxDurationMs = 10 * 60 * 1000,
} = {}) {
  const [state, setState] = useState({
    active: false,
    timedOut: false,
    attempt: 0,
    nextRetryAt: null,
    lastMessage: '',
  });

  const [nowMs, setNowMs] = useState(Date.now());

  const startedAtRef = useRef(0);
  const attemptRef = useRef(0);
  const timerRef = useRef(null);
  const cancelledRef = useRef(false);
  const onTryRef = useRef(null);
  const callbacksRef = useRef({
    onRecovered: null,
    onTerminal: null,
    onTimeout: null,
  });

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    cancelledRef.current = true;
    clearTimer();
    setState((prev) => ({
      ...prev,
      active: false,
      nextRetryAt: null,
    }));
  }, [clearTimer]);

  const runAttempt = useCallback(async () => {
    if (cancelledRef.current) return;
    const currentAttempt = attemptRef.current + 1;
    attemptRef.current = currentAttempt;

    setState((prev) => ({
      ...prev,
      active: true,
      timedOut: false,
      attempt: currentAttempt,
      nextRetryAt: null,
    }));

    let result;
    try {
      result = await onTryRef.current?.({ attempt: currentAttempt });
    } catch (error) {
      result = {
        state: 'retry',
        message: error?.message || 'Retry failed',
      };
    }

    if (cancelledRef.current) return;

    if (result?.state === 'ready') {
      stop();
      callbacksRef.current.onRecovered?.(result);
      return;
    }

    if (result?.state === 'terminal') {
      stop();
      callbacksRef.current.onTerminal?.(result);
      return;
    }

    const elapsed = Date.now() - startedAtRef.current;
    if (currentAttempt >= maxAttempts || elapsed >= maxDurationMs) {
      stop();
      setState((prev) => ({
        ...prev,
        timedOut: true,
        active: false,
      }));
      callbacksRef.current.onTimeout?.({
        attempt: currentAttempt,
        elapsed,
      });
      return;
    }

    const delayMs = withJitter(getDelayMs(currentAttempt));
    const nextRetryAt = Date.now() + delayMs;
    setState((prev) => ({
      ...prev,
      active: true,
      attempt: currentAttempt,
      nextRetryAt,
      lastMessage: result?.message || '',
    }));

    clearTimer();
    timerRef.current = setTimeout(runAttempt, delayMs);
  }, [clearTimer, maxAttempts, maxDurationMs, stop]);

  const start = useCallback(({ onTry, onRecovered, onTerminal, onTimeout }) => {
    if (typeof onTry !== 'function') return;

    cancelledRef.current = false;
    clearTimer();
    startedAtRef.current = Date.now();
    attemptRef.current = 0;
    onTryRef.current = onTry;
    callbacksRef.current = {
      onRecovered: onRecovered || null,
      onTerminal: onTerminal || null,
      onTimeout: onTimeout || null,
    };

    setState({
      active: true,
      timedOut: false,
      attempt: 0,
      nextRetryAt: null,
      lastMessage: '',
    });

    void runAttempt();
  }, [clearTimer, runAttempt]);

  const retryNow = useCallback(() => {
    if (!state.active) return;
    clearTimer();
    setState((prev) => ({ ...prev, nextRetryAt: null }));
    void runAttempt();
  }, [clearTimer, runAttempt, state.active]);

  useEffect(() => {
    if (!state.active || !state.nextRetryAt) return undefined;

    const id = setInterval(() => {
      setNowMs(Date.now());
    }, 250);

    return () => clearInterval(id);
  }, [state.active, state.nextRetryAt]);

  useEffect(() => () => {
    cancelledRef.current = true;
    clearTimer();
  }, [clearTimer]);

  const secondsUntilNextRetry = useMemo(() => {
    if (!state.nextRetryAt) return null;
    return Math.max(0, Math.ceil((state.nextRetryAt - nowMs) / 1000));
  }, [state.nextRetryAt, nowMs]);

  return {
    ...state,
    secondsUntilNextRetry,
    start,
    stop,
    retryNow,
  };
}
