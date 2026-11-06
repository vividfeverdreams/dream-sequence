import Link from "next/link";
import { LoopVisual } from "@/components/landing/loop-visual";
import { AudienceMock, AudioBars, QueueMock, SetupMock } from "@/components/landing/mocks";
import { Reveal } from "@/components/landing/reveal";

const bookingHref = "mailto:vividfeverdreams@gmail.com?subject=Dream%20Sequence%20demo";

const chapters = [
  {
    number: "02",
    source: "From the QR page",
    idea: "The whale opens one giant eye.",
    author: "maya",
    visual: "chapter-2",
    alt: "A giant whale eye opens and glows beneath the lighthouse at night."
  },
  {
    number: "03",
    source: "From the QR page",
    idea: "It swims straight up into the sky.",
    author: "tomas",
    visual: "chapter-3",
    alt: "The whale carries the lighthouse upward through the clouds into a field of stars."
  },
  {
    number: "04",
    source: "From Twitch chat",
    idea: "Every star turns into a disco ball.",
    author: "bassgoblin",
    visual: "chapter-4",
    alt: "The whale swims through a night sky full of slowly spinning disco balls."
  }
];

const steps = [
  {
    number: "1",
    title: "You write the opening",
    body: "Describe how the story begins, then choose a clip length and quality. That's the whole setup.",
    mock: <SetupMock />
  },
  {
    number: "2",
    title: "The crowd sends ideas",
    body: "In the room, people scan a QR code and answer one question. On a stream, viewers type !next in Twitch chat. Nobody installs anything.",
    mock: <AudienceMock />
  },
  {
    number: "3",
    title: "The next chapter plays",
    body: "Each idea is moderated, then turned into video from the last frame of the story. The current scene stays up until the new one is ready.",
    mock: <QueueMock />
  }
];

const features = [
  {
    title: "QR code or Twitch",
    body: "Put a QR code on screen for the room, or take ideas from chat with !next on a stream."
  },
  {
    title: "Credit on screen",
    body: "The idea plays with the nickname or Twitch username of whoever sent it."
  },
  {
    title: "Moderation first",
    body: "Every idea is checked before it can reach the screen, with limits per device."
  },
  {
    title: "Always something playing",
    body: "The latest three clips keep cycling while the next one is being made."
  },
  {
    title: "Keeps itself going",
    body: "After a quiet minute, the story writes its own next chapter. Audience ideas always go first."
  },
  {
    title: "Moves with the music",
    body: "Audio-reactive effects sit on top of the video, driven by your live sound.",
    extra: <AudioBars />
  },
  {
    title: "You stay in control",
    body: "Pause selection, replay an earlier clip or stop the story from the dashboard."
  },
  {
    title: "Runs in a browser",
    body: "Open the show window on a projector, LED wall or stream. Clips run 5 to 15 seconds, up to 1080P."
  }
];

const buttonPrimary =
  "inline-flex min-h-12 items-center justify-center rounded-full bg-plasma px-7 py-3 text-[15px] font-semibold text-ink transition hover:bg-[#d8ff5e]";
const buttonSecondary =
  "inline-flex min-h-12 items-center justify-center rounded-full border border-white/20 px-7 py-3 text-[15px] font-semibold text-haze transition hover:border-white/50";

function Caption({ idea, author }: { idea: string; author: string }) {
  return (
    <p className="subtitle text-balance text-center text-[17px] font-medium leading-6 text-haze sm:text-xl sm:leading-7">
      {idea}
      <span className="ml-2.5 whitespace-nowrap font-mono text-sm text-plasma">{author}</span>
    </p>
  );
}

export default function HomePage() {
  return (
    <main className="overflow-x-clip bg-ink text-haze">
      <header className="absolute inset-x-0 top-0 z-20">
        <nav
          aria-label="Main"
          className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-5 sm:px-8 lg:px-12"
        >
          <Link href="/" className="inline-flex min-h-11 items-center gap-1.5 font-display text-2xl leading-none text-haze">
            Dream <em>Sequence</em>
          </Link>
          <div className="flex items-center gap-2 sm:gap-7">
            <a href="#how" className="hidden min-h-11 items-center text-sm font-medium text-haze/80 transition hover:text-haze md:inline-flex">
              How it works
            </a>
            <a href="#features" className="hidden min-h-11 items-center text-sm font-medium text-haze/80 transition hover:text-haze md:inline-flex">
              Features
            </a>
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center px-3 text-sm font-medium text-haze/80 transition hover:text-haze"
            >
              Log in
            </Link>
            <a
              href={bookingHref}
              className="inline-flex min-h-11 items-center rounded-full bg-plasma px-5 text-sm font-semibold text-ink transition hover:bg-[#d8ff5e]"
            >
              Book a demo
            </a>
          </div>
        </nav>
      </header>

      <section className="relative isolate flex min-h-[100svh] flex-col justify-end overflow-hidden">
        <LoopVisual
          name="hero"
          eager
          alt="A lighthouse stands on the back of a sleeping whale, its beam sweeping through clouds at night."
          className="absolute inset-0 -z-10 h-full w-full object-cover object-[center_40%]"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-ink via-ink/25 to-ink/40" />
        <div className="film-grain absolute inset-0 -z-10" />

        <div className="mx-auto w-full max-w-7xl px-4 pb-10 pt-32 sm:px-8 sm:pb-14 lg:px-12">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-haze/85 sm:text-[13px]">
            Live AI visuals, written by the crowd
          </p>
          <h1 className="mt-4 max-w-5xl text-balance font-display text-[3.4rem] leading-[0.98] tracking-[-0.01em] text-haze sm:text-7xl lg:text-[6.5rem]">
            Your audience decides <em>what happens next.</em>
          </h1>
          <div className="mt-7 flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
            <p className="max-w-xl text-pretty text-[17px] leading-7 text-haze/90 sm:text-lg sm:leading-8">
              Dream Sequence turns a room full of ideas into one continuing film, generated live on your
              screens. You write the first scene. The crowd takes it from there.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row lg:shrink-0">
              <a href={bookingHref} className={buttonPrimary}>
                Book a demo
              </a>
              <a href="#how" className={buttonSecondary}>
                See how it works
              </a>
            </div>
          </div>
        </div>
      </section>

      <section id="story" className="mx-auto max-w-7xl px-4 pb-24 pt-20 sm:px-8 sm:pb-32 sm:pt-28 lg:px-12">
        <Reveal className="max-w-3xl">
          <h2 className="text-balance font-display text-5xl leading-[1.02] text-haze sm:text-6xl lg:text-7xl">
            One story. Everyone has a part in it.
          </h2>
          <p className="mt-6 max-w-2xl text-pretty text-[17px] leading-7 text-haze/80 sm:text-lg sm:leading-8">
            Show visuals are usually finished weeks before doors open. These get made during the set. Each
            idea becomes the next clip, and each clip picks up from the last frame of the one before it.
          </p>
        </Reveal>

        <p className="mt-14 border-l-2 border-plasma pl-4 text-[15px] leading-6 text-haze/80 sm:mt-20">
          <span className="font-mono text-xs uppercase tracking-[0.16em] text-haze/60">Chapter 01, the host</span>
          <br />A lighthouse on the back of a sleeping whale, drifting through clouds at night.
        </p>

        <ol className="mt-10 space-y-14 sm:mt-14 sm:space-y-24">
          {chapters.map((chapter, index) => (
            <li key={chapter.number}>
              <Reveal
                className={`grid items-center gap-5 lg:grid-cols-12 lg:gap-10 ${
                  index % 2 === 1 ? "lg:[&>figure]:order-2" : ""
                }`}
              >
                <figure className="relative overflow-hidden rounded-3xl bg-black lg:col-span-9">
                  <LoopVisual name={chapter.visual} alt={chapter.alt} className="aspect-[2/1] w-full object-cover" />
                  <div className="film-grain absolute inset-0" />
                  <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-4 pt-14 sm:pb-6">
                    <Caption idea={chapter.idea} author={chapter.author} />
                  </figcaption>
                </figure>
                <div className="order-first flex items-baseline gap-3 lg:order-1 lg:col-span-3 lg:block">
                  <p className="font-display text-5xl leading-none text-haze sm:text-7xl">{chapter.number}</p>
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-haze/70 lg:mt-3">{chapter.source}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </section>

      <section id="how" className="scroll-mt-6 border-t border-white/10 bg-[#0d0d10]">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8 sm:py-28 lg:px-12">
          <Reveal>
            <h2 className="max-w-3xl text-balance font-display text-5xl leading-[1.02] text-haze sm:text-6xl lg:text-7xl">
              How a show runs
            </h2>
          </Reveal>
          <div className="mt-12 grid gap-12 sm:mt-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-x-16 lg:gap-y-20">
            {steps.map((step, index) => (
              <div key={step.number} className="contents">
                <Reveal delay={index === 0 ? 0 : 60}>
                  <p className="font-mono text-sm text-plasma">Step {step.number}</p>
                  <h3 className="mt-2 font-display text-4xl leading-tight text-haze sm:text-[2.75rem]">{step.title}</h3>
                  <p className="mt-3 max-w-md text-pretty text-[17px] leading-7 text-haze/80">{step.body}</p>
                </Reveal>
                <Reveal delay={120} className="-mt-6 lg:mt-0">
                  {step.mock}
                </Reveal>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="scroll-mt-6 mx-auto max-w-7xl px-4 py-20 sm:px-8 sm:py-28 lg:px-12">
        <Reveal>
          <h2 className="max-w-3xl text-balance font-display text-5xl leading-[1.02] text-haze sm:text-6xl lg:text-7xl">
            Built to survive a live night
          </h2>
        </Reveal>
        <dl className="mt-12 grid gap-x-8 sm:mt-16 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <div key={feature.title} className="border-t border-white/15 py-6">
              <dt className="text-lg font-semibold leading-6 text-haze">{feature.title}</dt>
              <dd className="mt-2 text-[15px] leading-6 text-haze/75">{feature.body}</dd>
              {feature.extra ? <dd className="mt-4">{feature.extra}</dd> : null}
            </div>
          ))}
        </dl>
      </section>

      <section className="relative isolate overflow-hidden">
        <LoopVisual
          name="room"
          alt="A crowd in a dark room holds up phones in front of a giant screen showing the story."
          className="absolute inset-0 -z-10 h-full w-full object-cover"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-ink via-ink/20 to-ink" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-ink/75 via-ink/25 to-transparent" />
        <div className="film-grain absolute inset-0 -z-10" />
        <div className="mx-auto flex min-h-[85svh] max-w-7xl flex-col items-start justify-end px-4 py-20 sm:px-8 sm:py-28 lg:px-12">
          <Reveal>
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-haze/85 sm:text-[13px]">
              DJ sets, clubs, pop-ups, experimental live shows and Twitch streams
            </p>
            <h2 className="mt-4 max-w-4xl text-balance font-display text-5xl leading-[1.02] text-haze sm:text-6xl lg:text-8xl">
              Bring Dream Sequence to your next show.
            </h2>
            <p className="mt-5 max-w-xl text-pretty text-[17px] leading-7 text-haze/90 sm:text-lg sm:leading-8">
              Tell us about the night, and we'll set up a demo with a story of your own.
            </p>
            <a href={bookingHref} className={`${buttonPrimary} mt-8`}>
              Book a demo
            </a>
          </Reveal>
        </div>
      </section>

      <footer className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-8 text-[13px] leading-5 text-haze/65 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
        <p>
          Dream Sequence is a{" "}
          <a
            href="https://vivid-fever-dreams.vercel.app"
            className="underline decoration-white/30 underline-offset-4 transition hover:text-haze"
          >
            Vivid Fever Dreams
          </a>{" "}
          project.
        </p>
        <p>The example story and visuals on this page are illustrative.</p>
      </footer>
    </main>
  );
}
