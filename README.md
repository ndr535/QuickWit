# QuickWit - AI Improv Coach

**Train your brain to think faster. Respond sharper. Win any room.**

QuickWit is an iOS app that uses AI-powered improv exercises to build real-time thinking, confidence, and communication skills. Built for sales professionals, public speakers, and anyone who wants to be sharper on their feet.

> Built with React Native / Expo, Claude API, ElevenLabs TTS, Deepgram STT, and Supabase.

---

## What It Does

Most communication apps teach you *what* to say. QuickWit trains you *how fast* you can think.

Six AI-powered exercises, each targeting a different mental muscle:

| Exercise | What It Trains |
|---|---|
| **Quick Draw** | Instant association — first word, no hesitation |
| **Hot Take** | Confident opinion formation under pressure |
| **Reframe** | Flipping narratives — turning objections into opportunities |
| **Speed Rounds** | High-volume reps to build reflexes |
| **Yes And** | Improv's core rule — accept and build |
| **Heckler** | Staying composed when challenged |

Each session is scored, tracked, and reviewed with AI coaching feedback delivered via voice.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React Native / Expo (iOS) |
| AI Coaching | Anthropic Claude API (claude-haiku for prompts, claude-sonnet for evaluation) |
| Voice Output | ElevenLabs Text-to-Speech |
| Voice Input | Deepgram Speech-to-Text |
| Backend | Supabase (Auth, Edge Functions, PostgreSQL) |
| Payments | RevenueCat (Monthly / Yearly subscriptions) |
| Build / Deploy | EAS Build, App Store Connect |

---

## Architecture

```
User speaks → Deepgram STT → Claude evaluates response → ElevenLabs reads feedback aloud
                                    ↓
                         Supabase Edge Functions (API proxy)
                                    ↓
                         PostgreSQL (session history, prompt cache)
```

Key architectural decisions:
- **All AI API calls proxied through Supabase Edge Functions** — API keys never exposed client-side
- **Prompt cache layer** — 650+ pre-generated prompts seeded in Postgres, served instantly with fallback to live generation
- **Fail-open on Edge Function outages** — sessions continue rather than blocking users
- **JWT auth on all Edge Functions** — requests validated server-side before touching external APIs

---

## Features

- Voice-first UX — speak your response, hear your coaching
- Session scoring with streaks and performance tracking
- Session summaries with highlight moments
- 6-session free tier, then Monthly ($4.99) or Yearly ($39.99) via RevenueCat
- Dark mode throughout

---

## Project Structure

```
QuickWit/
├── app/                    # Expo Router screens
├── components/             # Reusable UI components
├── services/               # Supabase client, auth context
├── supabase/
│   └── functions/          # Edge Functions (ai-proxy, tts, stt)
├── scripts/                # Prompt cache seed scripts
├── assets/                 # Icons, splash screens
└── app.config.js           # EAS / Expo configuration
```

---

## Running Locally

```bash
# Install dependencies
npm install

# Start Expo dev server
npx expo start

# Scan QR code with Expo Go on iPhone
```

You'll need a `.env` file with:
```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
```

Edge Functions run on Supabase and require separate deployment via `supabase functions deploy`.

---

## App Store

Available on the iOS App Store under **Blue Ribbon Ops LLC**.

[Link coming after App Review]

---

## About

Built by [Naveen Rajan](https://linkedin.com/in/naveendrajan) as part of an independent AI consulting practice focused on hands-on implementation — not just advising on AI, but building with it.

QuickWit is one of several projects including LLM-powered workflow automation, RAG system design, and AI onboarding programs for enterprise clients.
