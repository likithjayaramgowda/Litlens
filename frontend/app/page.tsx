import Link from "next/link";
import { Button } from "@/components/ui/button";

/* ── Inline SVG icons ─────────────────────────────────────────── */

function ChatIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-6 w-6 text-white"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function NetworkIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-6 w-6 text-white"
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function QuoteIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-6 w-6 text-white"
    >
      <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z" />
      <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function LightbulbIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <line x1="9" y1="18" x2="15" y2="18" />
      <line x1="10" y1="22" x2="14" y2="22" />
      <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
    </svg>
  );
}

/* ── Data ─────────────────────────────────────────────────────── */

const features = [
  {
    icon: <ChatIcon />,
    title: "Cross-Paper Chat",
    description:
      "Ask questions that span your entire research library. LitLens synthesizes findings from multiple papers simultaneously, surfacing connections you'd never find reading alone.",
    gradient: "from-violet-500 to-purple-600",
    glowColor: "group-hover:shadow-violet-500/20",
    delay: "0ms",
  },
  {
    icon: <NetworkIcon />,
    title: "Smart Visualizations",
    description:
      "Explore dynamic knowledge graphs, side-by-side comparison tables, and paper timelines. See the landscape of your research at a glance — patterns emerge instantly.",
    gradient: "from-blue-500 to-cyan-500",
    glowColor: "group-hover:shadow-blue-500/20",
    delay: "120ms",
  },
  {
    icon: <QuoteIcon />,
    title: "Citation Assistant",
    description:
      "Never cite incorrectly again. Real-time citation suggestions with claim verification against source text, and one-click export in APA, MLA, Chicago, or BibTeX.",
    gradient: "from-emerald-500 to-teal-500",
    glowColor: "group-hover:shadow-emerald-500/20",
    delay: "240ms",
  },
];

const steps = [
  {
    number: "01",
    icon: <UploadIcon />,
    title: "Upload Your Papers",
    description:
      "Drag and drop PDFs into a workspace. LitLens extracts, chunks, and indexes every sentence — ready in seconds.",
    color: "text-violet-400",
    borderColor: "border-violet-500/30",
    bgColor: "bg-violet-500/10",
  },
  {
    number: "02",
    icon: <SearchIcon />,
    title: "Ask Any Question",
    description:
      "Type questions in plain English. LitLens searches across all your papers simultaneously using semantic understanding.",
    color: "text-blue-400",
    borderColor: "border-blue-500/30",
    bgColor: "bg-blue-500/10",
  },
  {
    number: "03",
    icon: <LightbulbIcon />,
    title: "Get Cited Answers",
    description:
      "Receive synthesized answers with inline citations that link back to the exact paragraph in the source paper.",
    color: "text-emerald-400",
    borderColor: "border-emerald-500/30",
    bgColor: "bg-emerald-500/10",
  },
];

/* ── Page ─────────────────────────────────────────────────────── */

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white overflow-x-hidden">

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center px-4 text-center">

        {/* Subtle grid background */}
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #94a3b8 1px, transparent 1px), linear-gradient(to bottom, #94a3b8 1px, transparent 1px)",
            backgroundSize: "72px 72px",
          }}
        />

        {/* Glow orbs */}
        <div className="absolute -top-32 left-1/3 h-[500px] w-[500px] rounded-full bg-violet-600/20 blur-3xl animate-glow-pulse" />
        <div
          className="absolute -bottom-20 right-1/4 h-96 w-96 rounded-full bg-blue-600/15 blur-3xl animate-glow-pulse"
          style={{ animationDelay: "2.5s" }}
        />
        <div
          className="absolute top-1/4 -left-20 h-72 w-72 rounded-full bg-indigo-500/10 blur-3xl animate-float"
          style={{ animationDelay: "1s" }}
        />

        {/* Hero content */}
        <div className="relative z-10 mx-auto max-w-4xl space-y-8">

          {/* Badge */}
          <div className="animate-fade-up">
            <span className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-4 py-1.5 text-sm font-medium text-violet-300 backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />
              AI-Powered Research Assistant
            </span>
          </div>

          {/* Headline */}
          <h1
            className="animate-fade-up text-5xl font-bold leading-[1.1] tracking-tight md:text-7xl"
            style={{ animationDelay: "100ms" }}
          >
            Your AI{" "}
            <span className="gradient-text">Research Companion</span>
          </h1>

          {/* Tagline */}
          <p
            className="animate-fade-up mx-auto max-w-2xl text-lg leading-relaxed text-slate-400 md:text-xl"
            style={{ animationDelay: "200ms" }}
          >
            Upload papers, ask questions across all of them,
            <br className="hidden md:block" />
            get cited answers.
          </p>

          {/* CTA buttons */}
          <div
            className="animate-fade-up flex flex-col items-center justify-center gap-4 sm:flex-row"
            style={{ animationDelay: "320ms" }}
          >
            <Button
              asChild
              size="lg"
              className="h-12 border-0 bg-gradient-to-r from-violet-600 to-indigo-600 px-8 text-base font-semibold shadow-lg shadow-violet-500/25 transition-all duration-300 hover:scale-[1.03] hover:from-violet-500 hover:to-indigo-500 hover:shadow-violet-500/40"
            >
              <Link href="/login">Get Started Free</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-12 border-slate-700 bg-slate-900/60 px-8 text-base font-semibold text-slate-200 backdrop-blur-sm transition-all duration-300 hover:border-slate-600 hover:bg-slate-800/80 hover:text-white"
            >
              <Link href="/login">Try Demo →</Link>
            </Button>
          </div>

          {/* Trust line */}
          <p
            className="animate-fade-up text-sm text-slate-600"
            style={{ animationDelay: "420ms" }}
          >
            No credit card required · Free tier available
          </p>
        </div>

        {/* Bottom vignette */}
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-slate-950 to-transparent" />
      </section>

      {/* ── Features ─────────────────────────────────────────── */}
      <section className="relative py-32 px-4">
        <div className="mx-auto max-w-7xl">

          {/* Section header */}
          <div className="mb-16 space-y-4 text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-violet-400">
              Features
            </p>
            <h2 className="text-3xl font-bold text-white md:text-5xl">
              Research at the speed of thought
            </h2>
            <p className="mx-auto max-w-2xl text-lg text-slate-400">
              Three powerful tools, one unified workspace — purpose-built for serious researchers.
            </p>
          </div>

          {/* Feature cards */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className={`group relative rounded-2xl border border-slate-800 bg-slate-900/60 p-8 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-slate-700 hover:bg-slate-900/90 hover:shadow-2xl ${feature.glowColor}`}
                style={{ animationDelay: feature.delay }}
              >
                {/* Top gradient line (appears on hover) */}
                <div
                  className={`absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r ${feature.gradient} opacity-0 transition-opacity duration-300 group-hover:opacity-100`}
                />

                {/* Icon with gradient border */}
                <div
                  className={`mb-6 inline-flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br ${feature.gradient} p-px shadow-lg`}
                >
                  <div className="flex h-full w-full items-center justify-center rounded-[11px] bg-slate-900">
                    {feature.icon}
                  </div>
                </div>

                <h3 className="mb-3 text-xl font-semibold text-white">
                  {feature.title}
                </h3>
                <p className="text-sm leading-relaxed text-slate-400 md:text-base">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────── */}
      <section className="relative border-t border-slate-800/60 py-28 px-4">
        {/* Background glow */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-indigo-950/10 to-transparent" />

        <div className="relative mx-auto max-w-5xl">

          {/* Section header */}
          <div className="mb-20 space-y-4 text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-blue-400">
              How It Works
            </p>
            <h2 className="text-3xl font-bold text-white md:text-5xl">
              Up and running in minutes
            </h2>
          </div>

          {/* Steps */}
          <div className="grid grid-cols-1 gap-10 md:grid-cols-3">
            {steps.map((step) => (
              <div key={step.number} className="group relative text-center">

                {/* Step number + icon */}
                <div className="mx-auto mb-6 flex flex-col items-center gap-3">
                  <div
                    className={`inline-flex h-14 w-14 items-center justify-center rounded-2xl border ${step.borderColor} ${step.bgColor} ${step.color} transition-transform duration-300 group-hover:scale-110`}
                  >
                    {step.icon}
                  </div>
                  <span className={`text-xs font-bold tracking-widest ${step.color} opacity-60`}>
                    {step.number}
                  </span>
                </div>

                <h3 className="mb-3 text-lg font-semibold text-white">{step.title}</h3>
                <p className="text-sm leading-relaxed text-slate-400">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ───────────────────────────────────────── */}
      <section className="relative overflow-hidden py-36 px-4">
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-indigo-950/20 to-slate-950" />

        {/* Central glow */}
        <div className="absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-500/10 blur-3xl animate-glow-pulse" />

        <div className="relative z-10 mx-auto max-w-2xl space-y-8 text-center">
          <h2 className="text-3xl font-bold leading-tight text-white md:text-5xl">
            Ready to transform
            <br />
            your research?
          </h2>
          <p className="mx-auto max-w-lg text-lg text-slate-400">
            Join researchers who are already uncovering insights faster with LitLens.
          </p>
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button
              asChild
              size="lg"
              className="h-12 border-0 bg-gradient-to-r from-violet-600 to-indigo-600 px-10 text-base font-semibold shadow-lg shadow-violet-500/25 transition-all duration-300 hover:scale-[1.03] hover:from-violet-500 hover:to-indigo-500 hover:shadow-violet-500/40"
            >
              <Link href="/login">Get Started Free →</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="border-t border-slate-800/60 py-8 px-4">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 text-sm text-slate-600 sm:flex-row">
          <span className="font-semibold text-slate-400">LitLens</span>
          <span>© 2026 LitLens · Built for researchers.</span>
        </div>
      </footer>
    </main>
  );
}
