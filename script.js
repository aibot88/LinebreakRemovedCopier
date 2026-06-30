const sourceText = document.querySelector("[data-source]");
const resultText = document.querySelector("[data-result]");
const translationText = document.querySelector("[data-translation]");
const statusLabel = document.querySelector("[data-status]");
const controls = document.querySelector(".controls");
const copyResultButton = document.querySelector('[data-action="copy-result"]');
const copyTranslationButton = document.querySelector('[data-action="copy-translation"]');
const clearButton = document.querySelector('[data-action="clear"]');

const options = {
  hyphen: document.querySelector('[data-option="hyphen"]'),
  paragraphs: document.querySelector('[data-option="paragraphs"]'),
  spaces: document.querySelector('[data-option="spaces"]'),
};

const MAX_TRANSLATE_CHARS = 1800;
const TRANSLATION_TIMEOUT_MS = 9000;
const LATEX_ESCAPE_MAP = {
  "\\": "\\textbackslash{}",
  "&": "\\&",
  "%": "\\%",
  "$": "\\$",
  "#": "\\#",
  "_": "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
};
const DEFAULT_LATEX_ESCAPE_CHARS = new Set(["%", "&", "_", "#"]);
const PROTECTED_LATEX_SEGMENTS = [
  { pattern: /%[^\n]*/g, isValid: isUnescapedMatch },
  { pattern: /\\begin\{(verbatim|lstlisting|minted|Verbatim)\}[\s\S]*?\\end\{\1\}/g },
  { pattern: /\\verb\*?(.)(?:[\s\S]*?)\1/g },
  { pattern: /\$\$[\s\S]*?\$\$/g },
  { pattern: /\$(?:\\.|[^$\\])*\$/g, isValid: isUnescapedMatch },
  { pattern: /\\\([\s\S]*?\\\)/g },
  { pattern: /\\\[[\s\S]*?\\\]/g },
  { pattern: /\\begin\{(equation|align|gather|multline|eqnarray)\*?\}[\s\S]*?\\end\{\1\*?\}/g },
  { pattern: /\\[%&_#${}\\~^]/g },
  { pattern: /\\[a-zA-Z]+/g },
];

let translationTimer;
let translationRequest = 0;

function repairHyphenatedBreaks(text) {
  return text.replace(/([A-Za-z])-\n([A-Za-z])/g, "$1$2");
}

function normalizeParagraph(text) {
  const joined = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");

  return options.spaces.checked ? joined.replace(/[ \t]{2,}/g, " ") : joined;
}

function cleanText(text) {
  let normalized = text.replace(/\r\n?/g, "\n").trim();

  if (!normalized) {
    return "";
  }

  if (options.hyphen.checked) {
    normalized = repairHyphenatedBreaks(normalized);
  }

  if (!options.paragraphs.checked) {
    return escapeLatex(normalizeParagraph(normalized));
  }

  const cleaned = normalized
    .split(/\n{2,}/)
    .map(normalizeParagraph)
    .filter(Boolean)
    .join("\n\n");

  return escapeLatex(cleaned);
}

function escapeLatex(text, escapeChars = DEFAULT_LATEX_ESCAPE_CHARS) {
  const activeMap = getLatexEscapeMap(escapeChars);
  const activeChars = Object.keys(activeMap);

  if (!activeChars.length) {
    return text;
  }

  const charPattern = new RegExp(`[${escapeRegExp(activeChars.join(""))}]`, "g");
  let result = "";
  let lastEnd = 0;
  let segment = findNextProtectedLatexSegment(text, lastEnd);

  while (segment) {
    result += escapePlainLatexText(text.slice(lastEnd, segment.index), charPattern, activeMap);
    result += segment.value;
    lastEnd = segment.index + segment.value.length;
    segment = findNextProtectedLatexSegment(text, lastEnd);
  }

  return result + escapePlainLatexText(text.slice(lastEnd), charPattern, activeMap);
}

function getLatexEscapeMap(escapeChars) {
  const activeMap = {};

  for (const char of escapeChars) {
    if (Object.prototype.hasOwnProperty.call(LATEX_ESCAPE_MAP, char)) {
      activeMap[char] = LATEX_ESCAPE_MAP[char];
    }
  }

  return activeMap;
}

function findNextProtectedLatexSegment(text, fromIndex) {
  let nextSegment = null;

  for (const segment of PROTECTED_LATEX_SEGMENTS) {
    const match = findValidLatexSegment(text, fromIndex, segment);

    if (match && (!nextSegment || match.index < nextSegment.index)) {
      nextSegment = match;
    }
  }

  return nextSegment ? { index: nextSegment.index, value: nextSegment[0] } : null;
}

function findValidLatexSegment(text, fromIndex, segment) {
  segment.pattern.lastIndex = fromIndex;

  for (let match = segment.pattern.exec(text); match; match = segment.pattern.exec(text)) {
    if (!segment.isValid || segment.isValid(text, match)) {
      return match;
    }
  }

  return null;
}

function isUnescapedMatch(text, match) {
  return match.index === 0 || text[match.index - 1] !== "\\";
}

function escapePlainLatexText(text, charPattern, activeMap) {
  return text.replace(charPattern, (char) => activeMap[char]);
}

function escapeRegExp(text) {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function detectLanguage(text) {
  const hasChinese = /[\u3400-\u9fff]/.test(text);
  return hasChinese ? "zh-CN" : "en";
}

function getTargetLanguage(sourceLanguage) {
  return sourceLanguage === "zh-CN" ? "en" : "zh-CN";
}

function getLanguageLabel(language) {
  return language === "zh-CN" ? "zh" : "en";
}

async function translateText(text, requestId) {
  const sourceLanguage = detectLanguage(text);
  const targetLanguage = getTargetLanguage(sourceLanguage);
  const chunks = splitTranslationChunks(text);
  const translatedChunks = [];

  setStatus(
    `Translating ${getLanguageLabel(sourceLanguage)} to ${getLanguageLabel(targetLanguage)}`,
    "is-active",
  );

  for (let index = 0; index < chunks.length; index += 1) {
    if (requestId !== translationRequest) {
      return;
    }

    if (chunks.length > 1) {
      setStatus(`Translating ${index + 1}/${chunks.length}`, "is-active");
    }

    translatedChunks.push(
      await requestTranslation(chunks[index], sourceLanguage, targetLanguage),
    );
  }

  if (requestId === translationRequest) {
    translationText.value = translatedChunks.join("\n\n");
    setStatus("Translated", "is-active");
  }
}

async function requestTranslation(text, sourceLanguage, targetLanguage) {
  const providers = [
    requestGoogleApiStructuredTranslation,
    requestGoogleApiLegacyTranslation,
    requestChromeTranslation,
  ];
  const errors = [];

  for (const provider of providers) {
    try {
      return await provider(text, sourceLanguage, targetLanguage);
    } catch (error) {
      errors.push(error.message);
    }
  }

  throw new Error(errors.find(Boolean) || "Translation failed");
}

async function requestGoogleApiStructuredTranslation(text, sourceLanguage, targetLanguage) {
  const url = new URL("https://translate.googleapis.com/translate_a/single");

  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", sourceLanguage);
  url.searchParams.set("tl", targetLanguage);
  url.searchParams.set("hl", "zh-HK");
  url.searchParams.set("dt", "t");
  url.searchParams.set("dj", "1");
  url.searchParams.set("ie", "UTF-8");
  url.searchParams.set("oe", "UTF-8");
  url.searchParams.set("q", text);

  const data = await fetchJson(url);
  const translated = data?.sentences?.map((part) => part.trans).join("");

  if (!translated) {
    throw new Error("Empty translation");
  }

  return translated;
}

async function requestGoogleApiLegacyTranslation(text, sourceLanguage, targetLanguage) {
  const url = new URL("https://translate.googleapis.com/translate_a/single");

  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", sourceLanguage);
  url.searchParams.set("tl", targetLanguage);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);

  const data = await fetchJson(url);
  const translated = data?.[0]?.map((part) => part[0]).join("");

  if (!translated) {
    throw new Error("Empty translation");
  }

  return translated;
}

async function requestChromeTranslation(text, sourceLanguage, targetLanguage) {
  const url = new URL("https://clients5.google.com/translate_a/t");

  url.searchParams.set("client", "dict-chrome-ex");
  url.searchParams.set("sl", sourceLanguage);
  url.searchParams.set("tl", targetLanguage);
  url.searchParams.set("q", text);

  const data = await fetchJson(url);

  if (!Array.isArray(data) || !data[0]) {
    throw new Error("Empty translation");
  }

  return data.join("");
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TRANSLATION_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function splitTranslationChunks(text) {
  const paragraphs = text.split(/\n{2,}/);
  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const parts = splitLongParagraph(paragraph);

    for (const part of parts) {
      const separator = current ? "\n\n" : "";
      const next = `${current}${separator}${part}`;

      if (next.length > MAX_TRANSLATE_CHARS && current) {
        chunks.push(current);
        current = part;
      } else {
        current = next;
      }
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function splitLongParagraph(paragraph) {
  if (paragraph.length <= MAX_TRANSLATE_CHARS) {
    return [paragraph];
  }

  const sentences = paragraph
    .match(/[^.!?。！？]+[.!?。！？]?\s*/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean) || [paragraph];
  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > MAX_TRANSLATE_CHARS) {
      chunks.push(...splitByLength(sentence));
      current = "";
      continue;
    }

    const next = current ? `${current} ${sentence}` : sentence;

    if (next.length > MAX_TRANSLATE_CHARS && current) {
      chunks.push(current);
      current = sentence;
    } else {
      current = next;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function splitByLength(text) {
  const chunks = [];

  for (let index = 0; index < text.length; index += MAX_TRANSLATE_CHARS) {
    chunks.push(text.slice(index, index + MAX_TRANSLATE_CHARS));
  }

  return chunks;
}

function scheduleTranslation(text) {
  clearTimeout(translationTimer);
  translationRequest += 1;

  if (!text) {
    translationText.value = "";
    return;
  }

  const requestId = translationRequest;

  translationTimer = setTimeout(async () => {
    try {
      await translateText(text, requestId);
    } catch (error) {
      if (requestId === translationRequest) {
        translationText.value = "";
        setStatus(error.message || "Translation failed", "is-error");
      }
    }
  }, 450);
}

function setStatus(message, state = "") {
  statusLabel.textContent = message;
  statusLabel.className = state ? `status ${state}` : "status";
}

function updateResult() {
  const result = cleanText(sourceText.value);
  resultText.value = result;

  const wordCount = result ? result.split(/\s+/).length : 0;
  setStatus(wordCount ? `${wordCount} words` : "Ready", wordCount ? "is-active" : "");
  scheduleTranslation(result);
}

async function copyText(textarea) {
  if (!textarea.value) {
    setStatus("Nothing to copy", "is-error");
    return;
  }

  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(textarea.value);
      setStatus("Copied", "is-active");
      return;
    } catch {
      copyWithSelection(textarea);
      return;
    }
  }

  copyWithSelection(textarea);
}

function copyWithSelection(textarea) {
  textarea.removeAttribute("readonly");
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    const copied = document.execCommand("copy");
    setStatus(copied ? "Copied" : "Press Cmd+C", copied ? "is-active" : "is-error");
  } catch {
    setStatus("Press Cmd+C", "is-error");
  } finally {
    textarea.setAttribute("readonly", "");
  }
}

function clearText() {
  sourceText.value = "";
  updateResult();
  sourceText.focus();
}

sourceText.addEventListener("input", updateResult);
controls.addEventListener("change", updateResult);
copyResultButton.addEventListener("click", () => copyText(resultText));
copyTranslationButton.addEventListener("click", () => copyText(translationText));
clearButton.addEventListener("click", clearText);

updateResult();
