import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Heart, Pause, Play, Shuffle, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { FALLBACK_SONG_ID, Song, songs } from "@/data/songs";

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
};

const QUEUE_SIZE = 10;
const ONE_HOUR_MS = 60 * 60 * 1000; // 1 hour anti-repeat window

/** Select a unique unplayed song not played within 1 hour and not in current queue */
const getNextUniqueSong = (
  history: Map<string, number>,
  currentQueue: Song[],
  currentTrackId?: string
): Song => {
  const now = Date.now();
  const queuedIds = new Set(currentQueue.map((s) => s.id));
  if (currentTrackId) queuedIds.add(currentTrackId);

  // Filter candidate songs not played in 1 hour and not currently queued
  const validCandidates = songs.filter((s) => {
    if (queuedIds.has(s.id)) return false;
    const lastPlayed = history.get(s.id);
    return !lastPlayed || now - lastPlayed >= ONE_HOUR_MS;
  });

  if (validCandidates.length > 0) {
    const rand = Math.floor(Math.random() * validCandidates.length);
    return validCandidates[rand]!;
  }

  // Fallback: pick oldest played song not in current queue
  let oldestSong = songs[0]!;
  let oldestTime = Infinity;
  for (const s of songs) {
    if (queuedIds.has(s.id)) continue;
    const t = history.get(s.id) ?? 0;
    if (t < oldestTime) {
      oldestTime = t;
      oldestSong = s;
    }
  }
  return oldestSong;
};

/** Populate initial 10-song queue in advance */
const fillInitialQueue = (
  initialTrackId: string,
  history: Map<string, number>
): Song[] => {
  const queue: Song[] = [];
  for (let i = 0; i < QUEUE_SIZE; i++) {
    const nextSong = getNextUniqueSong(history, queue, initialTrackId);
    queue.push(nextSong);
  }
  return queue;
};

const getInitialSongIndex = (): number => {
  if (typeof window === "undefined") return 0;
  try {
    const saved = localStorage.getItem("bhopuriyaghulam_last_song_idx");
    if (saved !== null) {
      const lastIdx = parseInt(saved, 10);
      if (!isNaN(lastIdx) && lastIdx >= 0 && lastIdx < songs.length) {
        let rand = Math.floor(Math.random() * songs.length);
        if (rand === lastIdx) rand = (rand + 1) % songs.length;
        return rand;
      }
    }
  } catch (e) {
    // localStorage fallback
  }
  return Math.floor(Math.random() * songs.length);
};

interface JukeboxPlayerProps {
  currentIndex?: number;
  onTrackChange?: (index: number) => void;
}

/** Synchronous Mobile Player Engine with Zero-Delay Touch Execution */
export function JukeboxPlayer({ currentIndex, onTrackChange }: JukeboxPlayerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);

  const bufferWatchdogRef = useRef<any>(null);
  const consecutiveErrorCountRef = useRef<number>(0);
  const userTouchedRef = useRef<boolean>(false);

  // Map of song ID -> timestamp played (in ms) to enforce 1-hour anti-repeat
  const playedHistoryRef = useRef<Map<string, number>>(new Map());

  // Active playing track
  const [currentTrack, setCurrentTrack] = useState<Song>(() => {
    const initIdx = typeof currentIndex === "number" && currentIndex >= 0 && currentIndex < songs.length
      ? currentIndex
      : getInitialSongIndex();
    const s = songs[initIdx] || songs[0]!;
    playedHistoryRef.current.set(s.id, Date.now());
    return s;
  });

  // 10-Song Pre-Buffered Queue Array
  const [upcomingQueue, setUpcomingQueue] = useState<Song[]>(() => {
    return fillInitialQueue(currentTrack.id, playedHistoryRef.current);
  });

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [requiresUserTap, setRequiresUserTap] = useState(false);

  // Advance to next song by popping front of 10-song queue & replenishing back of queue
  const advanceToNextTrack = useCallback(() => {
    if (bufferWatchdogRef.current) {
      clearTimeout(bufferWatchdogRef.current);
    }
    consecutiveErrorCountRef.current = 0;

    setUpcomingQueue((prevQueue) => {
      let queue = prevQueue;
      if (queue.length === 0) {
        queue = fillInitialQueue(currentTrack.id, playedHistoryRef.current);
      }

      const [nextSong, ...restQueue] = queue;
      if (nextSong) {
        setCurrentTrack(nextSong);
        playedHistoryRef.current.set(nextSong.id, Date.now());

        // Synchronous mobile video loading directly inside user-triggered event callstack
        try {
          const p = playerRef.current;
          if (p?.loadVideoById) {
            p.unMute?.();
            p.setVolume?.(100);
            p.loadVideoById({
              videoId: nextSong.id || FALLBACK_SONG_ID,
              startSeconds: 0,
            });
            p.playVideo?.();
          }
        } catch (e) {
          // ignore
        }

        try {
          const songIdx = songs.findIndex((s) => s.id === nextSong.id);
          if (songIdx >= 0) {
            localStorage.setItem("bhopuriyaghulam_last_song_idx", songIdx.toString());
            onTrackChange?.(songIdx);
          }
        } catch (e) {
          // ignore storage errors
        }

        // Replenish queue to keep exactly 10 songs in advance
        const newReplenishment = getNextUniqueSong(
          playedHistoryRef.current,
          restQueue,
          nextSong.id
        );
        return [...restQueue, newReplenishment];
      }
      return prevQueue;
    });
  }, [currentTrack.id, onTrackChange]);

  const prev = useCallback(() => {
    userTouchedRef.current = true;
    advanceToNextTrack();
  }, [advanceToNextTrack]);

  const shuffle = useCallback(() => {
    userTouchedRef.current = true;
    advanceToNextTrack();
  }, [advanceToNextTrack]);

  // Mobile User Touch Listener to unlock mobile browser audio autoplay
  useEffect(() => {
    const handleTouch = () => {
      userTouchedRef.current = true;
      const p = playerRef.current;
      if (p?.playVideo && !playing) {
        try {
          p.unMute?.();
          p.setVolume?.(100);
          p.playVideo?.();
          setRequiresUserTap(false);
        } catch (e) {
          // ignore
        }
      }
    };

    window.addEventListener("touchstart", handleTouch, { passive: true });
    window.addEventListener("click", handleTouch, { passive: true });
    return () => {
      window.removeEventListener("touchstart", handleTouch);
      window.removeEventListener("click", handleTouch);
    };
  }, [playing]);

  // Record history on track change
  useEffect(() => {
    if (currentTrack) {
      playedHistoryRef.current.set(currentTrack.id, Date.now());
    }
  }, [currentTrack]);

  // Initialize YouTube iFrame API with Buffer Watchdog for Mobile Recovery
  useEffect(() => {
    let cancelled = false;

    const boot = () => {
      if (cancelled || !hostRef.current) return;
      try {
        playerRef.current = new (window as any).YT.Player(hostRef.current, {
          videoId: currentTrack.id || FALLBACK_SONG_ID,
          playerVars: {
            controls: 0,
            disablekb: 1,
            playsinline: 1,
            origin: window.location.origin,
            autoplay: 1,
            enablejsapi: 1,
            rel: 0,
            modestbranding: 1,
          },
          events: {
            onReady: (e: any) => {
              setReady(true);
              try {
                e.target.unMute();
                e.target.setVolume(100);
                e.target.playVideo();
              } catch (err) {
                setRequiresUserTap(true);
              }
            },
            onStateChange: (e: any) => {
              const YT = (window as any).YT;
              if (!YT) return;

              const isPlayingState = e.data === YT.PlayerState.PLAYING;
              setPlaying(isPlayingState);

              if (isPlayingState) {
                setRequiresUserTap(false);
                consecutiveErrorCountRef.current = 0;
                if (bufferWatchdogRef.current) clearTimeout(bufferWatchdogRef.current);
                setDuration(playerRef.current?.getDuration?.() ?? 0);
              }

              // Mobile Buffer Recovery Watchdog: if stuck in BUFFERING (3) or UNSTARTED (-1) for >500ms
              if (e.data === YT.PlayerState.BUFFERING || e.data === YT.PlayerState.UNSTARTED) {
                if (bufferWatchdogRef.current) clearTimeout(bufferWatchdogRef.current);
                bufferWatchdogRef.current = setTimeout(() => {
                  try {
                    const p = playerRef.current;
                    if (p?.playVideo) {
                      p.unMute?.();
                      p.setVolume?.(100);
                      p.playVideo?.();
                    }
                  } catch (err) {
                    // ignore
                  }
                }, 500);
              }

              if (e.data === YT.PlayerState.ENDED) {
                advanceToNextTrack();
              }
            },
            onError: (err: any) => {
              console.warn("YouTube Player error for track:", currentTrack.title, err);
              consecutiveErrorCountRef.current += 1;

              if (!userTouchedRef.current) {
                setRequiresUserTap(true);
              }

              if (consecutiveErrorCountRef.current > 2) {
                advanceToNextTrack();
              } else {
                try {
                  const p = playerRef.current;
                  p?.unMute?.();
                  p?.setVolume?.(100);
                  p?.playVideo?.();
                } catch (e) {
                  advanceToNextTrack();
                }
              }
            },
          },
        });
      } catch (err) {
        console.error("Failed to initialize YT Player:", err);
      }
    };

    if ((window as any).YT?.Player) {
      boot();
    } else {
      const prevCb = (window as any).onYouTubeIframeAPIReady;
      (window as any).onYouTubeIframeAPIReady = () => {
        prevCb?.();
        boot();
      };
      if (!document.querySelector("script[data-yt-api]")) {
        const s = document.createElement("script");
        s.src = "https://www.youtube.com/iframe_api";
        s.dataset["ytApi"] = "1";
        document.head.appendChild(s);
      }
    }

    return () => {
      cancelled = true;
      if (bufferWatchdogRef.current) clearTimeout(bufferWatchdogRef.current);
      try {
        playerRef.current?.destroy?.();
      } catch (e) {
        // ignore cleanup errors
      }
      playerRef.current = null;
    };
  }, [advanceToNextTrack]);

  // Synchronize YouTube video playback synchronously without setTimeout disconnect
  useEffect(() => {
    if (!ready) return;
    try {
      const p = playerRef.current;
      if (p?.loadVideoById) {
        p.unMute?.();
        p.setVolume?.(100);
        p.loadVideoById({
          videoId: currentTrack.id || FALLBACK_SONG_ID,
          startSeconds: 0,
        });
        p.playVideo?.();
      }
      setTime(0);
      setDuration(0);
    } catch (e) {
      console.warn("Error loading video for track:", currentTrack.title, e);
      advanceToNextTrack();
    }
  }, [ready, currentTrack.id, advanceToNextTrack]);

  // Time ticker
  useEffect(() => {
    const t = window.setInterval(() => {
      try {
        const p = playerRef.current;
        if (!p?.getCurrentTime) return;
        setTime(p.getCurrentTime() ?? 0);
        const d = p.getDuration?.() ?? 0;
        if (d) setDuration(d);
      } catch (e) {
        // Ignore poll errors
      }
    }, 500);
    return () => window.clearInterval(t);
  }, []);

  const toggle = () => {
    userTouchedRef.current = true;
    const p = playerRef.current;
    if (!p) return;
    try {
      if (playing) {
        p.pauseVideo();
      } else {
        p.unMute?.();
        p.setVolume?.(100);
        p.playVideo();
        setRequiresUserTap(false);
      }
    } catch (e) {
      console.warn("Toggle playback error:", e);
    }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    userTouchedRef.current = true;
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    try {
      playerRef.current?.seekTo?.(ratio * duration, true);
      setTime(ratio * duration);
    } catch (err) {
      console.warn("Seek error:", err);
    }
  };

  const progress = duration ? (time / duration) * 100 : 0;

  return (
    <>
      {/* Kept inside top-0 left-0 1px viewport bounds so mobile browser never suspends iframe audio */}
      <div className="pointer-events-none fixed top-0 left-0 z-[-1] h-1 w-1 opacity-0 overflow-hidden">
        <div ref={hostRef} />
      </div>

      {/* Sleek Mobile Tap-to-Play Unlock Banner if Mobile Browser Blocks Untrusted Autoplay */}
      {requiresUserTap && !playing && (
        <button
          onClick={toggle}
          className="fixed bottom-36 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-primary/50 bg-primary/95 px-5 py-2.5 text-xs font-bold text-primary-foreground shadow-2xl backdrop-blur-md transition-transform hover:scale-105 active:scale-95 animate-pulse"
        >
          <Volume2 className="h-4 w-4 shrink-0" />
          <span>गाना बजाईं (Tap to Play Radio)</span>
        </button>
      )}

      {/* Container for Credit and Player Bar */}
      <div className="flex w-full flex-col items-center justify-center gap-3.5 sm:gap-3">
        {/* Centered Creator Credit positioned comfortably above player bar */}
        <div className="mb-1 flex items-center justify-center gap-1.5 text-xs text-white/95 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] sm:text-xs">
          <span className="inline-flex items-center gap-1 font-medium tracking-wide">
            Made with <Heart className="h-3.5 w-3.5 fill-rose-500 text-rose-500 animate-pulse" /> by
          </span>
          <a
            href="https://asgerali.vercel.app"
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-1 transition-all duration-300 hover:scale-105"
          >
            <span className="bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 bg-clip-text text-xs sm:text-sm font-black tracking-widest text-transparent uppercase drop-shadow-sm group-hover:drop-shadow-[0_0_8px_rgba(245,158,11,0.6)]">
              Asger Ali
            </span>
            <ArrowUpRight className="h-3.5 w-3.5 text-amber-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </a>
        </div>

        {/* Audio Player Bar */}
        <div className="surface-glass flex w-[min(94vw,34rem)] items-center gap-3.5 rounded-full px-4 py-2.5 sm:px-5 sm:py-3 shadow-2xl backdrop-blur-2xl border border-white/15">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full bg-primary animate-pulse" />
              <p className="truncate text-xs font-bold text-foreground sm:text-base">{currentTrack.title}</p>
            </div>
            <p className="truncate text-[11px] text-muted-foreground sm:text-xs">{currentTrack.artist}</p>
            
            <div
              onClick={seek}
              className="mt-1.5 h-1.5 cursor-pointer rounded-full bg-muted/60"
              role="presentation"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground">
              <span>{fmt(time)}</span>
              <span>{fmt(duration)}</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
            <button
              onClick={shuffle}
              title="Random Unplayed Song (बिना रीपीट नया गाना)"
              className="rounded-full p-1.5 sm:p-2 text-foreground/80 transition-colors hover:bg-white/10 hover:text-primary"
            >
              <Shuffle className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>
            <button
              onClick={prev}
              aria-label="Previous song"
              className="rounded-full p-1.5 sm:p-2 text-foreground/80 transition-colors hover:bg-white/10 hover:text-primary"
            >
              <SkipBack className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>
            <button
              onClick={toggle}
              aria-label={playing ? "Pause" : "Play"}
              className="grid h-10 w-10 sm:h-11 sm:w-11 place-items-center rounded-full bg-primary text-primary-foreground shadow-md transition-transform hover:scale-105 active:scale-95"
            >
              {playing ? <Pause className="h-4 w-4 sm:h-5 sm:w-5" /> : <Play className="h-4 w-4 sm:h-5 sm:w-5 ml-0.5" />}
            </button>
            <button
              onClick={advanceToNextTrack}
              aria-label="Next song"
              className="rounded-full p-1.5 sm:p-2 text-foreground/80 transition-colors hover:bg-white/10 hover:text-primary"
            >
              <SkipForward className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
