# Edge Function secrets

The deployed Edge Functions run on Supabase and **do not** read your local `.env`. They need these secrets set in the Supabase project:

| Secret | Used by | Required for |
|--------|--------|----------------|
| `ANTHROPIC_API_KEY` | ai-proxy | All AI (prompts, evaluation, Speed Rounds, etc.) |
| `ELEVENLABS_API_KEY` | text-to-speech | ElevenLabs narration (optional: `ELEVENLABS_DEFAULT_VOICE_ID`) |
| `DEEPGRAM_API_KEY` | speech-to-text | Cloud STT (otherwise no transcript) |

Auth: anonymous callers use the legacy anon JWT (Bearer token starting with `eyJ...`). The functions decode the JWT and accept when `role === "anon"` and `iss` includes `"supabase"`. No `SUPABASE_ANON_KEY` secret is used (Supabase reserves the `SUPABASE_` prefix).

**Set via Dashboard:** Project → Settings → Edge Functions → Secrets.

**Set via CLI:**

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref dspeqpxonmwvuvxzithx
supabase secrets set ELEVENLABS_API_KEY=... --project-ref dspeqpxonmwvuvxzithx
supabase secrets set DEEPGRAM_API_KEY=... --project-ref dspeqpxonmwvuvxzithx
```

If a secret is missing, that function returns 500 and the app falls back (e.g. device TTS, static prompts).
