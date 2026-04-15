// ── Transcript normalization pipeline ──────────────────────
// Applied to all Whisper/Vosk/WebSpeech transcripts before pattern matching.
// Order: lowercase → strip punctuation → remove fillers → number words → collapse whitespace → trim

const FILLER_WORDS = new Set([
  'uh', 'um', 'uhm', 'hmm', 'hm',
  'like', 'so', 'well', 'okay', 'ok',
  'please', 'can', 'you', 'could',
  'just', 'actually', 'basically',
  'the', 'a', 'an'
])

// Spoken number words → digits (including common homophones)
const NUMBER_WORDS: Record<string, string> = {
  zero: '0',
  one: '1', won: '1',
  two: '2', to: '2', too: '2',
  three: '3',
  four: '4', for: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8', ate: '8',
  nine: '9',
}

// Words that are BOTH number homophones AND common prepositions/words.
// Only convert these to digits when they appear as standalone words
// (the entire normalized result is just that word).
const AMBIGUOUS_NUMBER_WORDS = new Set(['to', 'too', 'for'])

export function normalize(transcript: string, wakeWord?: string): string {
  const words = transcript
    .toLowerCase()
    .replace(/[.,!?;:'"()\[\]{}\-—–]/g, '')  // strip punctuation
    .split(/\s+/)
    .filter((word) => !FILLER_WORDS.has(word))

  // Convert number words to digits
  const converted = words.map((word) => {
    const digit = NUMBER_WORDS[word]
    if (!digit) return word
    // For ambiguous words (to, for), only convert if standalone
    if (AMBIGUOUS_NUMBER_WORDS.has(word) && words.length > 1) return word
    return digit
  })

  let result = converted.join(' ').trim()

  // Strip wake word prefix — STT captures the trigger phrase in the audio
  if (wakeWord && result) {
    const phrase = wakeWord.replace(/_/g, ' ').toLowerCase()
    const parts = phrase.split(' ')

    if (result.startsWith(phrase + ' ')) {
      // Full match: "hey jarvis open terminal" → "open terminal"
      result = result.slice(phrase.length + 1)
    } else if (parts.length > 1) {
      // Partial: filler removal may have stripped "hey", or STT missed it
      // e.g. "a jarvis open terminal" → fillers strip "a" → "jarvis open terminal"
      const name = parts[parts.length - 1]
      if (result.startsWith(name + ' ')) {
        result = result.slice(name.length + 1)
      }
    }
  }

  return result
}
