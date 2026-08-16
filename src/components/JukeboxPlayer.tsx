import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Heart, Pause, Play, Search, Shuffle, SkipBack, SkipForward, Volume2, X, Music, Sparkles } from "lucide-react";
import { DEFAULT_HINDI_SAD_QUERY, FALLBACK_SONG_ID, Song, songs as initialStaticSongs } from "@/data/songs";
import { searchYouTubeSongs } from "@/services/youtubeApi";

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
};

const QUEUE_SIZE = 15;
const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000; // 15 days in milliseconds
const LOCAL_STORAGE_HISTORY_KEY = "songssite_15day_play_history";

/** Get 15-day play history from persistent localStorage */
const getPersistentPlayHistory = (): Map<string, number> => {
  const history = new Map<string, number>();
  if (typeof window === "undefined") return history;
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_HISTORY_KEY);
    if (raw) {
      const parsed: Record<string, number> = JSON.parse(raw);
      const now = Date.now();
      Object.entries(parsed).forEach(([id, time]) => {
        if (now - time < FIFTEEN_DAYS_MS) {
          history.set(id, time);
        }
      });
    }
  } catch (e) {
    // storage fallback
  }
  return history;
};

/** Record song play event in persistent 15-day localStorage */
const recordPersistentPlay = (songId: string) => {
  if (typeof window === "undefined") return;
  try {
    const historyMap = getPersistentPlayHistory();
    historyMap.set(songId, Date.now());
    const obj: Record<string, number> = {};
    historyMap.forEach((time, id) => {
      obj[id] = time;
    });
    localStorage.setItem(LOCAL_STORAGE_HISTORY_KEY, JSON.stringify(obj));
  } catch (e) {
    // storage fallback
  }
};

/** Pick initial song strictly unique within 15 days for visiting user */
const getInitial15DayUniqueSong = (catalog: Song[]): Song => {
  if (!catalog || catalog.length === 0) return initialStaticSongs[0]!;
  const historyMap = getPersistentPlayHistory();
  const now = Date.now();

  // Filter candidate songs not played in the last 15 days
  const unplayedIn15Days = catalog.filter((song) => {
    const lastPlayed = historyMap.get(song.id);
    return !lastPlayed || now - lastPlayed >= FIFTEEN_DAYS_MS;
  });

  if (unplayedIn15Days.length > 0) {
    const rand = Math.floor(Math.random() * unplayedIn15Days.length);
    const chosen = unplayedIn15Days[rand]!;
    recordPersistentPlay(chosen.id);
    return chosen;
  }

  // Fallback: pick song played longest ago (oldest lastPlayed timestamp)
  let oldestSong = catalog[0]!;
  let oldestTime = Infinity;
  for (const s of catalog) {
    const t = historyMap.get(s.id) ?? 0;
    if (t < oldestTime) {
      oldestTime = t;
      oldestSong = s;
    }
  }
  recordPersistentPlay(oldestSong.id);
  return oldestSong;
};

/** Select a unique unplayed song from catalog not played within 15 days and not in current queue */
const getNextUniqueSong = (
  songCatalog: Song[],
  history: Map<string, number>,
  currentQueue: Song[],
  currentTrackId?: string
): Song => {
  const catalog = songCatalog && songCatalog.length > 0 ? songCatalog : initialStaticSongs;
  const now = Date.now();
  const queuedIds = new Set(currentQueue.map((s) => s.id));
  if (currentTrackId) queuedIds.add(currentTrackId);

  // Filter candidate songs not played in 15 days and not currently queued
  const valid15DayCandidates = catalog.filter((s) => {
    if (queuedIds.has(s.id)) return false;
    const lastPlayed = history.get(s.id);
    return !lastPlayed || now - lastPlayed >= FIFTEEN_DAYS_MS;
  });

  if (valid15DayCandidates.length > 0) {
    const rand = Math.floor(Math.random() * valid15DayCandidates.length);
    return valid15DayCandidates[rand]!;
  }

  // Fallback: pick oldest played song
  let oldestSong = catalog[0]!;
  let oldestTime = Infinity;
  for (const s of catalog) {
    if (queuedIds.has(s.id)) continue;
    const t = history.get(s.id) ?? 0;
    if (t < oldestTime) {
      oldestTime = t;
      oldestSong = s;
    }
  }
  return oldestSong;
};

/** Populate initial 15-song queue in advance */
const fillInitialQueue = (
  songCatalog: Song[],
  initialTrackId: string,
  history: Map<string, number>
): Song[] => {
  const queue: Song[] = [];
  for (let i = 0; i < QUEUE_SIZE; i++) {
    const nextSong = getNextUniqueSong(songCatalog, history, queue, initialTrackId);
    queue.push(nextSong);
  }
  return queue;
};

interface JukeboxPlayerProps {
  currentIndex?: number;
  onTrackChange?: (index: number) => void;
}

/** Synchronous Mobile Player Engine with 15-Day Unique Rule & Minimalist Transparent Search for songssite */
export function JukeboxPlayer({ currentIndex, onTrackChange }: JukeboxPlayerProps) {
  const [catalog, setCatalog] = useState<Song[]>(initialStaticSongs);

  // Persistent 15-day history map
  const playedHistoryRef = useRef<Map<string, number>>(getPersistentPlayHistory());

  // Active playing track (Enforces 15-Day Unique Rule on Site Visit)
  const [currentTrack, setCurrentTrack] = useState<Song>(() => {
    return getInitial15DayUniqueSong(catalog);
  });

  // Unlimited Auto-Expanding Live YouTube Data API Streamer for Hindi Sad Songs
  useEffect(() => {
    let isCancelled = false;

    searchYouTubeSongs(DEFAULT_HINDI_SAD_QUERY, 50).then(({ songs: liveSongs }) => {
      if (isCancelled || !liveSongs.length) return;

      setCatalog((prev) => {
        const existingIds = new Set(prev.map((s) => s.id));
        const newUnique = liveSongs.filter((s) => !existingIds.has(s.id));
        return [...prev, ...newUnique];
      });
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);

  const bufferWatchdogRef = useRef<any>(null);
  const consecutiveErrorCountRef = useRef<number>(0);
  const userTouchedRef = useRef<boolean>(false);

  // Minimalist Transparent Search State
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [searchQueryInput, setSearchQueryInput] = useState("");
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // 15-Song Pre-Buffered Queue Array
  const [upcomingQueue, setUpcomingQueue] = useState<Song[]>(() => {
    return fillInitialQueue(catalog, currentTrack.id, playedHistoryRef.current);
  });

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [requiresUserTap, setRequiresUserTap] = useState(false);

  // Play a specific song directly from search results
  const playDirectSong = (song: Song) => {
    userTouchedRef.current = true;
    setCurrentTrack(song);
    playedHistoryRef.current.set(song.id, Date.now());
    recordPersistentPlay(song.id);

    setCatalog((prev) => {
      if (prev.some((s) => s.id === song.id)) return prev;
      return [song, ...prev];
    });

    try {
      const p = playerRef.current;
      if (p?.loadVideoById) {
        p.unMute?.();
        p.setVolume?.(100);
        p.loadVideoById({
          videoId: song.id || FALLBACK_SONG_ID,
          startSeconds: 0,
        });
        p.playVideo?.();
      }
    } catch (e) {
      // ignore
    }
  };

  // Perform live YouTube API search for minimalist transparent search bar
  const handleMinimalSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQueryInput.trim()) return;
    setIsSearching(true);
    const { songs: results } = await searchYouTubeSongs(searchQueryInput.trim(), 25);
    setSearchResults(results);
    setIsSearching(false);
  };

  // Advance to next song by popping front of queue & replenishing back of queue
  const advanceToNextTrack = useCallback(() => {
    if (bufferWatchdogRef.current) {
      clearTimeout(bufferWatchdogRef.current);
    }
    consecutiveErrorCountRef.current = 0;

    setUpcomingQueue((prevQueue) => {
      let queue = prevQueue;
      if (queue.length === 0) {
        queue = fillInitialQueue(catalog, currentTrack.id, playedHistoryRef.current);
      }

      const [nextSong, ...restQueue] = queue;
      if (nextSong) {
        setCurrentTrack(nextSong);
        playedHistoryRef.current.set(nextSong.id, Date.now());
        recordPersistentPlay(nextSong.id);

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
          const songIdx = catalog.findIndex((s) => s.id === nextSong.id);
          if (songIdx >= 0) {
            onTrackChange?.(songIdx);
          }
        } catch (e) {
          // ignore storage errors
        }

        // Replenish queue to keep exactly 15 songs in advance
        const newReplenishment = getNextUniqueSong(
          catalog,
          playedHistoryRef.current,
          restQueue,
          nextSong.id
        );
        return [...restQueue, newReplenishment];
      }
      return prevQueue;
    });
  }, [catalog, currentTrack.id, onTrackChange]);

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
      recordPersistentPlay(currentTrack.id);
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
          className="fixed bottom-36 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-rose-500/50 bg-rose-600/95 px-5 py-2.5 text-xs font-bold text-white shadow-2xl backdrop-blur-md transition-transform hover:scale-105 active:scale-95 animate-pulse"
        >
          <Volume2 className="h-4 w-4 shrink-0" />
          <span>गाना बजाईं (Tap to Play Radio)</span>
        </button>
      )}

      {/* Container for Player, Transparent Search, and Credit */}
      <div className="flex w-full flex-col items-center justify-center gap-2.5">
        {/* Minimalist Transparent Search Tray (seamlessly blends into background) */}
        {isSearchExpanded && (
          <div className="w-[min(94vw,36rem)] overflow-hidden rounded-2xl bg-black/40 p-3 backdrop-blur-md transition-all duration-300 animate-in fade-in slide-in-from-bottom-2">
            <form onSubmit={handleMinimalSearchSubmit} className="flex items-center gap-2 border-b border-white/20 pb-2">
              <Search className="h-4 w-4 text-white/50 shrink-0 ml-1" />
              <input
                type="text"
                autoFocus
                value={searchQueryInput}
                onChange={(e) => setSearchQueryInput(e.target.value)}
                placeholder="Search any sad song or singer..."
                className="flex-1 bg-transparent px-1 py-1 text-xs text-white placeholder-white/40 focus:outline-none"
              />
              {isSearching ? (
                <span className="text-[10px] text-white/60 animate-pulse">Searching...</span>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsSearchExpanded(false)}
                  className="p-1 text-white/50 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </form>

            <div className="max-h-60 overflow-y-auto space-y-1 pt-2 pr-1">
              {searchResults.length === 0 && !isSearching && (
                <p className="text-center text-[10px] text-white/40 py-2">
                  Type a song name above to search live from YouTube.
                </p>
              )}
              {searchResults.map((song) => (
                <div
                  key={song.id}
                  onClick={() => playDirectSong(song)}
                  className="flex items-center justify-between rounded-lg px-2.5 py-1.5 cursor-pointer transition-colors hover:bg-white/10"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Music className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-white">{song.title}</p>
                      <p className="truncate text-[10px] text-white/50">{song.artist}</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold text-rose-300 shrink-0 ml-2">
                    PLAY ▶
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Centered Creator Credit positioned comfortably above player bar */}
        <div className="mb-0.5 flex items-center justify-center gap-1.5 text-xs text-white/95 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] sm:text-xs">
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
        <div className="surface-glass flex w-[min(94vw,36rem)] items-center gap-3 rounded-full px-4 py-2.5 sm:px-5 sm:py-3 shadow-2xl backdrop-blur-2xl border border-white/15">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500 animate-pulse" />
              <p className="truncate text-xs font-bold text-foreground sm:text-base">{currentTrack.title}</p>
            </div>
            <div className="flex items-center gap-2">
              <p className="truncate text-[11px] text-muted-foreground sm:text-xs">{currentTrack.artist}</p>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-bold text-rose-300 uppercase tracking-wider">
                {catalog.length} Songs Stream
              </span>
            </div>
            
            <div
              onClick={seek}
              className="mt-1.5 h-1.5 cursor-pointer rounded-full bg-muted/60"
              role="presentation"
            >
              <div
                className="h-full rounded-full bg-rose-500 transition-[width] duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground">
              <span>{fmt(time)}</span>
              <span>{fmt(duration)}</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
            {/* Minimalist Transparent Search Button */}
            <button
              onClick={() => setIsSearchExpanded((prev) => !prev)}
              title="Search Any Hindi Sad Song (कोई भी गाना खोजीं)"
              className={`rounded-full p-1.5 sm:p-2 transition-all ${
                isSearchExpanded
                  ? "bg-white/20 text-white"
                  : "text-white/70 hover:text-white hover:bg-white/10"
              }`}
            >
              <Search className="h-4 w-4 sm:h-4 sm:w-4" />
            </button>
            <button
              onClick={shuffle}
              title="Random Unplayed Song (बिना रीपीट नया गाना)"
              className="rounded-full p-1.5 sm:p-2 text-foreground/80 transition-colors hover:bg-white/10 hover:text-rose-400"
            >
              <Shuffle className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>
            <button
              onClick={prev}
              aria-label="Previous song"
              className="rounded-full p-1.5 sm:p-2 text-foreground/80 transition-colors hover:bg-white/10 hover:text-rose-400"
            >
              <SkipBack className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>
            <button
              onClick={toggle}
              aria-label={playing ? "Pause" : "Play"}
              className="grid h-10 w-10 sm:h-11 sm:w-11 place-items-center rounded-full bg-rose-500 text-white shadow-md transition-transform hover:scale-105 active:scale-95"
            >
              {playing ? <Pause className="h-4 w-4 sm:h-5 sm:w-5" /> : <Play className="h-4 w-4 sm:h-5 sm:w-5 ml-0.5" />}
            </button>
            <button
              onClick={advanceToNextTrack}
              aria-label="Next song"
              className="rounded-full p-1.5 sm:p-2 text-foreground/80 transition-colors hover:bg-white/10 hover:text-rose-400"
            >
              <SkipForward className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
