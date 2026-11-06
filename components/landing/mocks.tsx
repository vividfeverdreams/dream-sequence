const labelClass = "font-mono text-[11px] uppercase tracking-[0.16em] text-white/60";

function Segment({ options, active }: { options: string[]; active: string }) {
  return (
    <div className="flex rounded-full border border-white/10 p-1" aria-hidden="true">
      {options.map((option) => (
        <span
          key={option}
          className={`flex-1 rounded-full px-2 py-1.5 text-center font-mono text-[11px] ${
            option === active ? "bg-haze text-ink" : "text-white/60"
          }`}
        >
          {option}
        </span>
      ))}
    </div>
  );
}

export function SetupMock() {
  return (
    <div className="rounded-[1.75rem] border border-white/10 bg-[#111114] p-5" aria-hidden="true">
      <p className={labelClass}>How does your story begin?</p>
      <p className="mt-3 min-h-[5.5rem] rounded-2xl border border-white/10 bg-black/40 p-4 text-[15px] leading-6 text-haze">
        A lighthouse on the back of a sleeping whale, drifting through clouds at night.
        <span className="caret ml-0.5 inline-block h-4 w-px translate-y-0.5 bg-plasma" />
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <p className={`${labelClass} mb-2`}>Clip length</p>
          <Segment options={["5s", "10s", "15s"]} active="5s" />
        </div>
        <div>
          <p className={`${labelClass} mb-2`}>Quality</p>
          <Segment options={["480P", "768P", "1080P"]} active="768P" />
        </div>
      </div>
      <div className="mt-3">
        <p className={`${labelClass} mb-2`}>Audience joins by</p>
        <Segment options={["QR code", "Twitch chat"]} active="QR code" />
      </div>
    </div>
  );
}

export function AudienceMock() {
  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" aria-hidden="true">
      <div className="rounded-[1.75rem] border border-white/10 bg-[#111114] p-5">
        <p className={labelClass}>On a phone</p>
        <p className="mt-3 font-display text-3xl leading-none text-haze">What happens next?</p>
        <p className="mt-3 min-h-[4.5rem] rounded-2xl border border-white/10 bg-black/40 p-3 text-sm leading-5 text-haze">
          The whale opens one giant eye
          <span className="caret ml-0.5 inline-block h-3.5 w-px translate-y-0.5 bg-plasma" />
        </p>
        <p className="mt-3 rounded-full bg-haze py-2 text-center text-sm font-semibold text-ink">Send my idea</p>
      </div>
      <div className="rounded-[1.75rem] border border-white/10 bg-[#111114] p-5">
        <p className={labelClass}>In Twitch chat</p>
        <div className="mt-3 space-y-3 text-sm leading-5">
          <p className="text-white/55">
            <span className="font-semibold text-white/70">nightbus</span> this drop is unreal
          </p>
          <p className="text-haze">
            <span className="font-semibold text-plasma">bassgoblin</span>{" "}
            <span className="font-mono text-plasma">!next</span> every star turns into a disco ball
          </p>
          <p className="text-white/55">
            <span className="font-semibold text-white/70">kit_kat</span> LOL
          </p>
          <p className="text-haze">
            <span className="font-semibold text-plasma">mothman</span>{" "}
            <span className="font-mono text-plasma">!next</span> the moon starts to dance
          </p>
        </div>
      </div>
    </div>
  );
}

export function QueueMock() {
  const steps = [
    { label: "Moderated", detail: "Checked before it can reach the screen", state: "done" },
    { label: "Generating", detail: "Starts from the last frame on screen", state: "active" },
    { label: "Up next", detail: "Plays as soon as it's ready", state: "waiting" }
  ];

  return (
    <div className="rounded-[1.75rem] border border-white/10 bg-[#111114] p-5" aria-hidden="true">
      <p className="subtitle text-center text-[15px] font-medium leading-6 text-haze">
        Every star turns into a disco ball
        <span className="ml-2 font-mono text-xs text-plasma">bassgoblin</span>
      </p>
      <div className="mt-5 space-y-3">
        {steps.map((step) => (
          <div key={step.label} className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/40 px-4 py-3">
            {step.state === "active" ? (
              <span className="render-sweep absolute inset-y-0 left-0 w-full bg-gradient-to-r from-transparent via-plasma/15 to-transparent" />
            ) : null}
            <div className="relative flex items-center gap-3">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  step.state === "waiting" ? "bg-white/25" : "bg-plasma"
                }`}
              />
              <div>
                <p className="text-sm font-semibold text-haze">{step.label}</p>
                <p className="text-[13px] leading-5 text-white/60">{step.detail}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AudioBars() {
  const delays = [0, 180, 360, 90, 270, 450, 130, 320];

  return (
    <div className="flex h-8 items-end gap-1" aria-hidden="true">
      {delays.map((delay) => (
        <span
          key={delay}
          className="audio-bar h-full w-1.5 rounded-full bg-plasma"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}
