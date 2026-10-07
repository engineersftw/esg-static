// Descriptions are plain text, so links in them (an event page, a speaker's site) are found by their
// URL: "http(s)://…" or "www.…". A bare domain such as "tiny.tt/asm" is left alone, because telling
// it from a file name or a sentence without a space after the full stop would take guesses.

export interface TextPart {
  text: string;
  /** Set when `text` is a link, to its absolute http(s) URL. */
  href?: string;
}

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?'"’”]$/;
const CLOSERS: Record<string, string> = { ")": "(", "]": "[" };

// What follows a URL in a sentence is not part of it: "(see http://a.sg/x)." ends at "x". A closing
// bracket is kept only when the URL has its opening one, as in a Wikipedia address.
function trimUrl(url: string): string {
  let end = url;
  for (;;) {
    const last = end.at(-1) ?? "";
    const opener = CLOSERS[last];
    if (TRAILING_PUNCTUATION.test(end)) {
      end = end.slice(0, -1);
    } else if (opener && end.split(last).length > end.split(opener).length) {
      end = end.slice(0, -1);
    } else {
      return end;
    }
  }
}

/** Split `text` into plain text and links, in order; joining every `text` gives the original back. */
export function linkify(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let from = 0;
  const plain = (to: number) => {
    if (to > from) parts.push({ text: text.slice(from, to) });
  };

  for (const match of text.matchAll(URL_PATTERN)) {
    const url = trimUrl(match[0]);
    const href = /^https?:/i.test(url) ? url : `https://${url}`;
    try {
      if (!new URL(href).hostname.includes(".")) continue;
    } catch {
      continue;
    }
    plain(match.index);
    parts.push({ text: url, href });
    from = match.index + url.length;
  }
  plain(text.length);
  return parts;
}
