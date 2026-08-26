import { countWords, splitSentences, stripHtml } from "./contentStats"
import { scoreChecks, type SeoCheck } from "./seoAnalysis"

/**
 * Readability metrics, same purity contract as `seoAnalysis` — the editor panel
 * runs this in the browser, the audit dashboard runs it on the server, and the
 * write path stores the result on `blogPosts.readabilityScore`.
 *
 * **Every number here is a heuristic, and the UI must say so.** There is no
 * parser behind any of it:
 *
 * - Sentences are split on punctuation plus an abbreviation list, so a
 *   semicolon-heavy writer is under-counted and an unusual abbreviation is
 *   over-counted.
 * - Syllables are counted by vowel groups. "Business" scores 3 (it is 2),
 *   "aisle" scores 2 (it is 1). Flesch is stable enough to compare two drafts
 *   of the same post, and not precise enough to quote as a decimal.
 * - Passive voice is "a form of *to be* within two tokens of something that
 *   looks like a past participle". It flags adjectives after a copula —
 *   "was tired", "is interested", "were closed" — as passive when they are
 *   not. Treat a rising percentage as a prompt to reread, never as a count.
 *
 * The alternative to heuristics is a natural-language dependency, which for
 * six advisory numbers on an admin panel is not a trade worth making.
 */

export interface ReadabilityResult {
  fleschScore: number
  band: string
  wordCount: number
  sentenceCount: number
  syllableCount: number
  longSentencePercent: number
  longParagraphPercent: number
  passiveVoicePercent: number
  transitionWordPercent: number
  longestRunWithoutHeading: number
  checks: SeoCheck[]
  score: number
}

const LONG_SENTENCE_WORDS = 20
const LONG_PARAGRAPH_WORDS = 150
/** Past this many words with no subheading, a reader scanning for an answer
 *  gives up. Sets the fail line on the subheading-distribution check. */
const MAX_RUN_WITHOUT_HEADING = 300

const BE_FORMS = new Set(["am", "is", "are", "was", "were", "be", "been", "being"])

/** Irregular past participles common enough to matter in service copy. The
 *  regular `-ed` case is handled by pattern, so this only has to cover verbs
 *  that do not take it. */
const IRREGULAR_PARTICIPLES = new Set([
  "been", "begun", "blown", "broken", "brought", "built", "bought", "caught",
  "chosen", "come", "cut", "done", "drawn", "driven", "eaten", "fallen", "felt",
  "fitted", "forgotten", "found", "given", "gone", "grown", "heard", "held",
  "hidden", "hit", "hurt", "kept", "known", "laid", "left", "lent", "let",
  "lost", "made", "meant", "met", "paid", "put", "read", "rebuilt", "ridden",
  "run", "said", "seen", "sent", "set", "shown", "shut", "sold", "sought",
  "spent", "split", "spoken", "spread", "stolen", "struck", "taken", "taught",
  "thought", "thrown", "told", "torn", "understood", "withdrawn", "won", "worn",
  "written",
])

/** Yoast's list, trimmed to what an English service blog actually uses.
 *  Matched at the START of a sentence — a transition word buried mid-sentence
 *  does not do the job of signposting the next idea. Longest phrases are tested
 *  first so "in addition" is not matched as bare "in". */
const TRANSITION_PHRASES = [
  "accordingly", "additionally", "admittedly", "after all", "afterward", "albeit",
  "also", "alternatively", "although", "altogether", "another", "as a result",
  "as an example", "as long as", "as soon as", "as well as", "at first",
  "at last", "at least", "at the same time", "because", "before", "besides",
  "briefly", "but", "by comparison", "by contrast", "certainly", "chiefly",
  "comparatively", "consequently", "conversely", "correspondingly", "despite",
  "during", "earlier", "equally", "especially", "even so", "eventually",
  "evidently", "finally", "first", "firstly", "for example", "for instance",
  "for one thing", "for this reason", "fortunately", "further", "furthermore",
  "generally", "given that", "granted", "hence", "however", "in addition",
  "in brief", "in case", "in conclusion", "in contrast", "in fact", "in general",
  "in other words", "in particular", "in practice", "in short", "in summary",
  "in the meantime", "indeed", "instead", "lastly", "later", "likewise",
  "meanwhile", "moreover", "namely", "nevertheless", "next", "nonetheless",
  "notably", "obviously", "on the contrary", "on the other hand", "once",
  "otherwise", "overall", "particularly", "previously", "rather", "second",
  "secondly", "similarly", "simultaneously", "since", "so", "specifically",
  "still", "subsequently", "that is", "then", "thereafter", "therefore",
  "third", "thirdly", "though", "thus", "to begin with", "to conclude",
  "to illustrate", "to summarise", "to summarize", "ultimately", "unless",
  "unlike", "until", "what is more", "whereas", "while", "yet",
].sort((a, b) => b.length - a.length)

/**
 * Vowel groups, minus a silent trailing `e`, plus one back for a
 * consonant + `le` ending, floored at 1.
 *
 * The `le` rule is why the subtraction is unconditional: "table" drops to one
 * and comes back to two, "make" drops to one and stays there.
 */
export function countSyllables(word: string): number {
  const letters = word.toLowerCase().replace(/[^a-z]/g, "")
  if (!letters) return 0

  let count = (letters.match(/[aeiouy]+/g) ?? []).length
  if (letters.endsWith("e")) count -= 1
  if (/[^aeiouy]le$/.test(letters)) count += 1
  return Math.max(1, count)
}

/** 90–100 Very easy … 0–30 Very difficult, the standard Flesch bands. Shown
 *  instead of the raw number wherever there is only room for one, because
 *  "Fairly easy" is actionable and "68.4" is not. */
export function fleschBand(score: number): string {
  if (score >= 90) return "Very easy"
  if (score >= 80) return "Easy"
  if (score >= 70) return "Fairly easy"
  if (score >= 60) return "Standard"
  if (score >= 50) return "Fairly difficult"
  if (score >= 30) return "Difficult"
  return "Very difficult"
}

function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter((token) => /[a-zÀ-ɏ0-9]/i.test(token))
}

function looksLikeParticiple(token: string): boolean {
  const word = token.toLowerCase().replace(/[^a-z]/g, "")
  if (!word) return false
  if (IRREGULAR_PARTICIPLES.has(word)) return true
  // "need", "seed", "speed" end in -ed without being participles; requiring a
  // consonant before the -ed removes the common ones without a word list.
  return /[^aeiou]ed$/.test(word) && word.length > 4
}

function isPassive(sentence: string): boolean {
  const tokens = wordsOf(sentence).map((token) => token.toLowerCase().replace(/[^a-z]/g, ""))
  for (let index = 0; index < tokens.length; index += 1) {
    if (!BE_FORMS.has(tokens[index])) continue
    // Two tokens of slack covers the adverb ("was carefully rekeyed") and the
    // "being" of a progressive passive.
    for (let ahead = 1; ahead <= 2 && index + ahead < tokens.length; ahead += 1) {
      if (looksLikeParticiple(tokens[index + ahead])) return true
    }
  }
  return false
}

function opensWithTransition(sentence: string): boolean {
  const opening = sentence.toLowerCase().replace(/^[^a-zà-ɏ]+/i, "")
  return TRANSITION_PHRASES.some(
    (phrase) => opening === phrase || opening.startsWith(`${phrase} `) || opening.startsWith(`${phrase},`)
  )
}

/** Paragraph texts. Falls back to the whole body as a single block when the
 *  content has no `<p>` at all — TinyMCE always emits them, but content pasted
 *  from a template might not, and a silent 0 % would read as a pass. */
function paragraphTexts(html: string): string[] {
  const paragraphs: string[] = []
  const pattern = /<p\b[^>]*>([\s\S]*?)<\/p>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    const text = stripHtml(match[1])
    if (text) paragraphs.push(text)
  }
  if (paragraphs.length === 0) {
    const whole = stripHtml(html)
    if (whole) paragraphs.push(whole)
  }
  return paragraphs
}

/** Longest stretch of body words between two headings. Headings are removed
 *  rather than split on, so their own text is not counted into the section
 *  that follows them. */
function longestRunBetweenHeadings(html: string): number {
  const segments = html.replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi, "\u0000").split("\u0000")
  return segments.reduce((longest, segment) => Math.max(longest, countWords(segment)), 0)
}

function percent(part: number, total: number): number {
  if (total === 0) return 0
  return Math.round((part / total) * 1000) / 10
}

function check(
  id: string,
  label: string,
  weight: number,
  status: SeoCheck["status"],
  detail: string
): SeoCheck {
  return { id, label, status, detail, weight }
}

export function analyseReadability(html: string): ReadabilityResult {
  const text = stripHtml(html)
  const sentences = splitSentences(text)
  const words = wordsOf(text)
  const wordCount = words.length
  const sentenceCount = sentences.length
  const syllableCount = words.reduce((sum, word) => sum + countSyllables(word), 0)

  const fleschScore =
    wordCount === 0 || sentenceCount === 0
      ? 0
      : Math.round(
          Math.min(
            100,
            Math.max(
              0,
              206.835 - 1.015 * (wordCount / sentenceCount) - 84.6 * (syllableCount / wordCount)
            )
          ) * 10
        ) / 10

  const longSentences = sentences.filter((sentence) => wordsOf(sentence).length > LONG_SENTENCE_WORDS).length
  const paragraphs = paragraphTexts(html)
  const longParagraphs = paragraphs.filter((paragraph) => wordsOf(paragraph).length > LONG_PARAGRAPH_WORDS).length
  const passiveSentences = sentences.filter(isPassive).length
  const transitionSentences = sentences.filter(opensWithTransition).length

  const longSentencePercent = percent(longSentences, sentenceCount)
  const longParagraphPercent = percent(longParagraphs, paragraphs.length)
  const passiveVoicePercent = percent(passiveSentences, sentenceCount)
  const transitionWordPercent = percent(transitionSentences, sentenceCount)
  const longestRunWithoutHeading = longestRunBetweenHeadings(html)

  const checks: SeoCheck[] = []
  const noContent = "Nothing to measure until the post has body content."

  checks.push(
    sentenceCount === 0
      ? check("flesch", "Reading ease", 8, "na", noContent)
      : fleschScore >= 60
        ? check("flesch", "Reading ease", 8, "pass", `About ${fleschScore} — ${fleschBand(fleschScore).toLowerCase()} to read.`)
        : fleschScore >= 50
          ? check(
              "flesch",
              "Reading ease",
              8,
              "warn",
              `About ${fleschScore}. Shorten a few sentences and swap the longest words for shorter ones to reach 60.`
            )
          : check(
              "flesch",
              "Reading ease",
              8,
              "fail",
              `About ${fleschScore} — heavy going. Split the long sentences; someone locked out of their house is reading this on a phone.`
            )
  )

  checks.push(
    sentenceCount === 0
      ? check("long-sentences", "Sentence length", 6, "na", noContent)
      : longSentencePercent < 25
        ? check("long-sentences", "Sentence length", 6, "pass", `${longSentencePercent} % of sentences run over ${LONG_SENTENCE_WORDS} words.`)
        : longSentencePercent < 35
          ? check("long-sentences", "Sentence length", 6, "warn", `${longSentencePercent} % run long. Aim under 25 % — look for the sentences with two "and"s in them.`)
          : check("long-sentences", "Sentence length", 6, "fail", `${longSentencePercent} % run over ${LONG_SENTENCE_WORDS} words. Break them in half; the meaning usually survives.`)
  )

  checks.push(
    paragraphs.length === 0
      ? check("long-paragraphs", "Paragraph length", 5, "na", noContent)
      : longParagraphPercent < 20
        ? check("long-paragraphs", "Paragraph length", 5, "pass", `${longParagraphPercent} % of paragraphs run over ${LONG_PARAGRAPH_WORDS} words.`)
        : longParagraphPercent < 30
          ? check("long-paragraphs", "Paragraph length", 5, "warn", `${longParagraphPercent} % run long. Split at the point where the subject changes.`)
          : check("long-paragraphs", "Paragraph length", 5, "fail", `${longParagraphPercent} % are walls of text. Break them into 2–4 sentence paragraphs.`)
  )

  checks.push(
    sentenceCount === 0
      ? check("passive-voice", "Passive voice", 4, "na", noContent)
      : passiveVoicePercent < 10
        ? check("passive-voice", "Passive voice", 4, "pass", `About ${passiveVoicePercent} % of sentences look passive.`)
        : passiveVoicePercent < 15
          ? check("passive-voice", "Passive voice", 4, "warn", `About ${passiveVoicePercent} %. Name who does the thing — "we rekey the lock", not "the lock is rekeyed". Approximate: "was tired" counts here and should not.`)
          : check("passive-voice", "Passive voice", 4, "fail", `About ${passiveVoicePercent} % look passive. Rewrite the worst offenders in the active voice. Approximate — check the flagged sentences before trusting the number.`)
  )

  checks.push(
    sentenceCount === 0
      ? check("transition-words", "Transition words", 4, "na", noContent)
      : transitionWordPercent >= 30
        ? check("transition-words", "Transition words", 4, "pass", `${transitionWordPercent} % of sentences open with a transition.`)
        : transitionWordPercent >= 20
          ? check("transition-words", "Transition words", 4, "warn", `${transitionWordPercent} %. Open a few more sentences with "however", "as a result", "in practice" — they tell the reader how the next idea connects.`)
          : check("transition-words", "Transition words", 4, "fail", `${transitionWordPercent} %. The post reads as a list of unconnected facts; aim for 30 %.`)
  )

  checks.push(
    // Under 300 words there is nothing to distribute, so this cannot fail —
    // and a short post covered in subheadings is worse than one without.
    wordCount <= MAX_RUN_WITHOUT_HEADING
      ? check("subheading-distribution", "Subheading distribution", 6, "na", "Too short to need subheadings.")
      : longestRunWithoutHeading <= MAX_RUN_WITHOUT_HEADING
        ? check("subheading-distribution", "Subheading distribution", 6, "pass", `Longest stretch without a heading is ${longestRunWithoutHeading} words.`)
        : longestRunWithoutHeading <= 450
          ? check("subheading-distribution", "Subheading distribution", 6, "warn", `${longestRunWithoutHeading} words with no heading. Add an H2 at the point the topic shifts.`)
          : check("subheading-distribution", "Subheading distribution", 6, "fail", `${longestRunWithoutHeading} words with no heading. Break the section up — this is also what earns jump-to links in the result page.`)
  )

  return {
    fleschScore,
    band: fleschBand(fleschScore),
    wordCount,
    sentenceCount,
    syllableCount,
    longSentencePercent,
    longParagraphPercent,
    passiveVoicePercent,
    transitionWordPercent,
    longestRunWithoutHeading,
    checks,
    // Empty content scores 0, not 100: every check is `na`, the denominator is
    // zero, and `scoreChecks` returns 0 rather than claiming a perfect read on
    // a post nobody has written yet.
    score: scoreChecks(checks),
  }
}
