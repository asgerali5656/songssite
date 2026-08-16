import { createFileRoute } from "@tanstack/react-router";
import hero from "@/assets/sad-songs-hero.jpg";
import { JukeboxPlayer } from "@/components/JukeboxPlayer";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "दर्द-ए-दिल · Non-stop Hindi Sad Songs Radio" },
      {
        name: "description",
        content:
          "All-time-hit Hindi Sad Songs, Heartbreak Classics, and Emotional Melodies — Arijit Singh, KK, Kumar Sanu, Sonu Nigam, B Praak & more.",
      },
      { property: "og:title", content: "दर्द-ए-दिल · Non-stop Hindi Sad Songs Radio" },
      {
        property: "og:description",
        content: "All-time-hit Hindi Sad Songs and Emotional Melodies.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="relative flex min-h-dvh flex-1 flex-col items-center justify-between overflow-hidden">
      {/* Full-screen Background Image */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        <img
          src={hero}
          alt="Hindi Sad Songs hero background"
          className="h-full w-full object-cover object-center scale-105"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-slate-950/70 via-slate-900/35 to-black/90" />
        <div className="pointer-events-none absolute inset-0 grain-overlay opacity-40" />
      </div>

      {/* Header Equalizer Indicator */}
      <header className="relative z-10 flex w-full items-center justify-between px-5 py-5 sm:px-10">
        <span className="flex items-center gap-2 text-xs uppercase tracking-[0.28em] text-white/90 drop-shadow-md">
          <span className="flex h-4 items-end gap-[3px]">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-[3px] origin-bottom rounded-full bg-rose-500"
                style={{
                  height: "100%",
                  animation: `eq-bounce 900ms ${i * 140}ms ease-in-out infinite`,
                }}
              />
            ))}
          </span>
        </span>
      </header>

      {/* Center Hero Title Section */}
      <section className="relative z-10 my-auto flex flex-col items-center px-4 text-center">
        <h1 className="text-display text-5xl font-black text-white drop-shadow-[0_4px_28px_rgba(0,0,0,0.9)] sm:text-7xl md:text-8xl lg:text-[9rem] leading-none tracking-tight">
          दर्द-ए-दिल
        </h1>
      </section>

      {/* Bottom Controls & Centered Credit */}
      <div className="relative z-10 mb-[4vh] sm:mb-[6vh] flex w-full flex-col items-center justify-center px-3">
        <JukeboxPlayer />
      </div>
    </main>
  );
}
