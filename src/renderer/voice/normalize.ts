// ── Transcript normalization pipeline ──────────────────────
// Applied to all Whisper/Vosk/WebSpeech transcripts before pattern matching.
// Order: lowercase → strip punctuation → remove fillers → collapse whitespace → trim

const FILLER_WORDS = new Set([
  'uh', 'um', 'uhm', 'hmm', 'hm',
  'like', 'so', 'well', 'okay', 'ok',
  'please', 'can', 'you', 'could',
  'just', 'actually', 'basically',
  'the', 'a', 'an'
])

export function normalize(transcript: string): string {
  return transcript
    .toLowerCase()
    .replace(/[.,!?;:'"()\[\]{}\-—–]/g, '')  // strip punctuation
    .split(/\s+/)
    .filter((word) => !FILLER_WORDS.has(word))
    .join(' ')
    .trim()
}
