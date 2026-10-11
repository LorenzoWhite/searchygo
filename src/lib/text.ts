/** Turns card text and search queries into comparable terms. */

const STOPWORDS = new Set(
  "a an and are as at be but by can for if in is it its of on or that the then this to with you your".split(" "),
);

/** Different words players and cards use for the same thing, mapped to one term. */
const SYNONYMS: Record<string, string> = {
  graveyard: "gy",
  grave: "gy",
  sent: "send",
  drew: "draw",
  removed: "banish",
  tutor: "search",
  revive: "reborn",
};

function stem(word: string): string {
  if (word.length <= 3) return word;
  let stemmed = word;
  if (stemmed.endsWith("ies")) stemmed = stemmed.slice(0, -3) + "y";
  else if (stemmed.endsWith("ing") && stemmed.length > 5) stemmed = stemmed.slice(0, -3);
  else if (stemmed.endsWith("ed") && stemmed.length > 4) stemmed = stemmed.slice(0, -2);
  else if (stemmed.endsWith("es")) stemmed = stemmed.slice(0, -2);
  else if (stemmed.endsWith("s") && !stemmed.endsWith("ss")) stemmed = stemmed.slice(0, -1);
  // "negate"/"negated"/"negating" and "tribute"/"tributing" should all meet at the same term.
  if (stemmed.endsWith("e") && stemmed.length > 3) stemmed = stemmed.slice(0, -1);
  return stemmed;
}

export function tokenize(text: string): string[] {
  const terms: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || STOPWORDS.has(raw)) continue;
    terms.push(stem(SYNONYMS[raw] ?? raw));
  }
  return terms;
}
