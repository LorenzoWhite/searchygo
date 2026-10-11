/** Reading JSON out of a model reply that was not held to a schema by its API. */

/** Parses a reply as JSON, tolerating a Markdown code fence or stray text around the object. */
export function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) throw new SyntaxError("no JSON object in the reply");
    return JSON.parse(text.slice(start, end + 1));
  }
}

/** Returns the JSON object or array that opens at `start`, or null if its brackets never balance. */
function balancedAt(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === "\\") i++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{" || char === "[") depth++;
    else if ((char === "}" || char === "]") && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/**
 * Recovers the cards that are intact from a reply that is not valid JSON as a whole. A model that
 * drops a bracket inside one card's entry would otherwise cost every card in the request.
 */
export function salvageEntries(text: string): unknown[] {
  // The id is sometimes written as a string, so an opening quote is allowed.
  const starts = [...text.matchAll(/\{\s*"id"\s*:\s*"?\d+/g)].map((match) => match.index);
  const entries: unknown[] = [];
  for (const [i, start] of starts.entries()) {
    const entry = balancedAt(text, start);
    // An entry that runs into the next one has lost a bracket of its own.
    if (!entry || start + entry.length > (starts[i + 1] ?? text.length)) continue;
    try {
      entries.push(JSON.parse(entry));
    } catch {
      // broken inside; left to be retried
    }
  }
  return entries;
}
