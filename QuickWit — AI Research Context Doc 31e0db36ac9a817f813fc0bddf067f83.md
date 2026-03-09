# QuickWit — AI Research Context Doc

Paste this entire document at the start of any Gemini, ChatGPT, or other AI research session about QuickWit. It gives the model full context before you ask questions.

---

## What Is QuickWit

QuickWit is a voice-first iOS app that trains real-time thinking, wit, and communication skills through AI-powered improv exercises. The core thesis: most communication apps teach you *what* to say. QuickWit trains you *how fast* you can think.

Target users: sales professionals, public speakers, professionals in high-stakes conversations, anyone who wants to be sharper and more confident on their feet.

Business model: Freemium. 6 free sessions (no credit card required), then $4.99/month or $39.99/year via RevenueCat. The free trial is session-based, not time-based — users get 6 full sessions before hitting the paywall. Each session consists of one exercise type with AI voice coaching and a scored summary.

Status: Submitted to Apple App Store (March 2026), awaiting review. Built by Naveen Rajan under Blue Ribbon Ops LLC.

---

## The 6 Exercises

| Exercise | What It Trains | How It Works |
| --- | --- | --- |
| **Quick Draw** | Instant word association, no hesitation | AI gives a word, user responds with first word that comes to mind. Speed and confidence scored. |
| **Hot Take** | Confident opinion formation under pressure | AI gives a topic, user must deliver a strong opinion in under 10 seconds. |
| **Reframe** | Turning negatives into positives, objection handling | AI gives a negative statement, user must reframe it positively. |
| **Speed Rounds** | High-volume reps, reflex building | Rapid-fire prompts, multiple responses in a timed window. |
| **Yes And** | Building on others' ideas (core improv rule) | AI makes a statement, user must accept it and add to it. |
| **Heckler** | Staying composed under challenge | AI plays an aggressive challenger, user must respond calmly and confidently. |

---

## Full Tech Stack

- **Frontend**: React Native / Expo (JavaScript, managed workflow)
- **AI Coaching**: Anthropic Claude API (Haiku for prompts, Sonnet for evaluation)
- **Voice Output (TTS)**: ElevenLabs
- **Voice Input (STT)**: Deepgram
- **Backend**: Supabase (PostgreSQL, Auth, Edge Functions as API proxy)
- **Subscriptions**: RevenueCat (Monthly $4.99, Yearly $39.99)
- **Build/Deploy**: EAS Build, App Store Connect
- **Prompt Cache**: 650+ pre-generated prompts seeded in Postgres, served instantly with fallback to live Claude generation

---

## Architecture Decisions

- All API keys are server-side only — never exposed to the client. All AI calls go through Supabase Edge Functions which validate JWT before hitting Claude/ElevenLabs/Deepgram.
- App is designed to fail open — if Edge Functions are slow or down, sessions continue rather than blocking.
- Prompt cache reduces latency and API cost for the three most common exercises (Quick Draw, Hot Take, Reframe).
- Sessions are scored and stored. Users see streaks, session counts, and highlight moments in post-session summaries.

---

## Current Feature Set

- Voice-first UX: speak your response, hear AI coaching feedback read back via ElevenLabs
- Session scoring with streaks and performance tracking
- Session summary screen with highlight moments and score breakdown
- 6-session free tier before paywall
- Dark mode throughout
- Persistent login via AsyncStorage + Supabase Auth
- Test account for Apple reviewers: [naveen@blueribbonops.com](mailto:naveen@blueribbonops.com) / test535

---

## What's NOT Built Yet (Potential Research Areas)

- Social/multiplayer features (improv is inherently social — currently solo only)
- Progress tracking over time / skill curves
- Personalized difficulty adjustment based on performance history
- Specific verticals (sales, public speaking, dating, job interviews)
- Onboarding flow / tutorial
- Notifications / streak reminders
- Sharing session results
- Android version
- Web version
- Leaderboards
- Coached programs (structured 30-day curriculum)

---

## Research Questions to Ask Gemini / ChatGPT

Copy and use these after pasting the context above.

### iOS App Market

- What communication and soft skills apps currently exist on the iOS App Store? How are they monetized, rated, and differentiated?
- What are the top reasons users churn from self-improvement apps in the first 30 days?
- What retention mechanics work best for habit-forming apps (streaks, social, gamification)?
- What price points perform best for freemium communication/coaching apps?

### Improv & Communication Science

- What does research say about how improv training improves real-world communication?
- What specific cognitive skills does improv training develop (and how long does it take to see results)?
- How do professional improv coaches structure beginner vs. advanced training?
- What makes someone perceived as "quick-witted" or "sharp" in conversation?
- What are the most effective techniques for reducing communication anxiety in high-stakes situations?

### AI Coaching

- How should AI feedback be structured to maximize behavior change (immediacy, specificity, tone)?
- What's the difference between effective human coaching feedback and what AI typically generates?
- How do the best AI-powered fitness/language/music apps deliver feedback differently than generic apps?
- What role does voice (vs. text) play in the effectiveness of coaching feedback?

### Product Improvements

- Given the 6 exercises above, what exercises are missing that would round out a complete communication training program?
- How should difficulty progression work in a skill-training app — linear, branching, or adaptive?
- What onboarding flows convert best for self-improvement apps with a freemium model?
- Should QuickWit have a social layer? What would that look like for an improv training app?

### Positioning & Marketing

- How should QuickWit be positioned differently for sales professionals vs. general consumers?
- What search terms do people use when looking for communication improvement apps?
- What makes App Store screenshots and descriptions convert in the self-improvement category?

---

## Competitive Landscape (Known)

- **Orator AI** — public speaking practice with AI feedback
- **Speeko** — guided public speaking courses
- **Yoodli** — AI speech coach, primarily for presentations
- **Duolingo** — gamified language learning (indirect comp for retention mechanics)
- **Headspace/Calm** — habit + subscription model comp
- **Improv apps** — very few dedicated improv training apps exist; most are game/party apps not coaching tools

---

*Last updated: March 2026 | Built by Naveen Rajan, Blue Ribbon Ops LLC*