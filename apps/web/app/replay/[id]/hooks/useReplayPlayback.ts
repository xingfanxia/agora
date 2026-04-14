'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export interface ReplayEventEnvelope {
  index: number
  timestamp: number
  event: { type: string; [k: string]: unknown }
}

export type PlaybackSpeed = 0.5 | 1 | 2 | 5 | 10 | 'instant'

export interface PlaybackState {
  /** Events that should be visible at the current virtual time. */
  visibleEvents: ReplayEventEnvelope[]
  /** 0..1 progress through the total event stream. */
  progress: number
  /** Virtual clock as wall-time ms relative to first event. */
  virtualMs: number
  /** Total duration in ms (last event − first event). */
  totalMs: number
  /** Event index currently at the playback head. */
  eventIndex: number
  totalEvents: number
  /** Whether playback is currently running. */
  playing: boolean
  speed: PlaybackSpeed
}

export interface PlaybackControls {
  play: () => void
  pause: () => void
  toggle: () => void
  setSpeed: (speed: PlaybackSpeed) => void
  /** Seek to a 0..1 fraction of total duration. */
  seekFraction: (fraction: number) => void
  /** Seek to an event index (0..events.length). */
  seekToIndex: (index: number) => void
  restart: () => void
  /** Skip ahead to show all events instantly. */
  jumpToEnd: () => void
}

/**
 * Animated replay player. Maintains a virtual clock that advances at
 * the configured speed; events with timestamp ≤ virtualClock are
 * returned as `visibleEvents`. Caps the max step per RAF tick so
 * long idle gaps (e.g. between phases) are compressed to a short
 * fast-forward instead of a real-time wait.
 */
export function useReplayPlayback(
  events: readonly ReplayEventEnvelope[],
  initialSpeed: PlaybackSpeed = 2,
): [PlaybackState, PlaybackControls] {
  const firstTimestamp = events[0]?.timestamp ?? 0
  const lastTimestamp = events[events.length - 1]?.timestamp ?? firstTimestamp
  const totalMs = Math.max(1, lastTimestamp - firstTimestamp)

  const [virtualMs, setVirtualMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeedState] = useState<PlaybackSpeed>(initialSpeed)

  // Auto-start once we actually have events
  const hasAutoStartedRef = useRef(false)
  useEffect(() => {
    if (!hasAutoStartedRef.current && events.length > 0) {
      hasAutoStartedRef.current = true
      setPlaying(true)
    }
  }, [events.length])

  const lastFrameRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)

  // Drive the virtual clock from rAF.
  useEffect(() => {
    if (!playing || events.length === 0) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      lastFrameRef.current = null
      return
    }
    if (speed === 'instant') {
      setVirtualMs(totalMs)
      setPlaying(false)
      return
    }

    const step = (now: number) => {
      if (lastFrameRef.current == null) {
        lastFrameRef.current = now
      }
      const delta = now - lastFrameRef.current
      lastFrameRef.current = now

      setVirtualMs((prev) => {
        // Compress long idle gaps — if the next event is more than 2s
        // away at 1×, only advance by 500ms of "real" time to keep the
        // playhead moving without waiting forever.
        const nextEv = eventAtOrAfter(events, firstTimestamp + prev)
        const nextBoundary = nextEv ? nextEv.timestamp - firstTimestamp : totalMs
        const gapToNext = Math.max(0, nextBoundary - prev)
        const cappedDelta = Math.min(delta * speed, gapToNext || delta * speed, 2_000)
        const next = Math.min(prev + cappedDelta, totalMs)
        return next
      })

      rafRef.current = requestAnimationFrame(step)
    }

    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      lastFrameRef.current = null
    }
  }, [playing, speed, events, firstTimestamp, totalMs])

  // Auto-pause at the end
  useEffect(() => {
    if (virtualMs >= totalMs && playing) {
      setPlaying(false)
    }
  }, [virtualMs, totalMs, playing])

  const visibleEvents = useMemo(() => {
    const cutoff = firstTimestamp + virtualMs
    return events.filter((e) => e.timestamp <= cutoff)
  }, [events, virtualMs, firstTimestamp])

  const controls: PlaybackControls = {
    play: useCallback(() => {
      if (virtualMs >= totalMs) setVirtualMs(0)
      setPlaying(true)
    }, [virtualMs, totalMs]),
    pause: useCallback(() => setPlaying(false), []),
    toggle: useCallback(() => {
      setPlaying((p) => {
        if (p) return false
        if (virtualMs >= totalMs) setVirtualMs(0)
        return true
      })
    }, [virtualMs, totalMs]),
    setSpeed: useCallback((s: PlaybackSpeed) => {
      setSpeedState(s)
      if (s === 'instant') {
        setVirtualMs(totalMs)
        setPlaying(false)
      }
    }, [totalMs]),
    seekFraction: useCallback(
      (fraction: number) => {
        const clamped = Math.max(0, Math.min(1, fraction))
        setVirtualMs(clamped * totalMs)
      },
      [totalMs],
    ),
    seekToIndex: useCallback(
      (index: number) => {
        const target = events[Math.max(0, Math.min(events.length - 1, index))]
        if (!target) return
        setVirtualMs(target.timestamp - firstTimestamp)
      },
      [events, firstTimestamp],
    ),
    restart: useCallback(() => {
      setVirtualMs(0)
      setPlaying(true)
    }, []),
    jumpToEnd: useCallback(() => {
      setVirtualMs(totalMs)
      setPlaying(false)
    }, [totalMs]),
  }

  const state: PlaybackState = {
    visibleEvents,
    progress: totalMs > 0 ? virtualMs / totalMs : 0,
    virtualMs,
    totalMs,
    eventIndex: visibleEvents.length,
    totalEvents: events.length,
    playing,
    speed,
  }

  return [state, controls]
}

/** Binary-search helper — finds the first event whose timestamp > minTimestamp. */
function eventAtOrAfter(
  events: readonly ReplayEventEnvelope[],
  minTimestamp: number,
): ReplayEventEnvelope | null {
  let lo = 0
  let hi = events.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    const evAtMid = events[mid]
    if (!evAtMid) break
    if (evAtMid.timestamp <= minTimestamp) lo = mid + 1
    else hi = mid
  }
  const found = events[lo]
  return found ?? null
}
