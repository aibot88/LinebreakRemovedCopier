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
    return normalizeParagraph(normalized);
  }

  return normalized
    .split(/\n{2,}/)
    .map(normalizeParagraph)
    .filter(Boolean)
    .join("\n\n");
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
  const url = new URL("https://translate.googleapis.com/translate_a/single");

  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", sourceLanguage);
  url.searchParams.set("tl", targetLanguage);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);

  setStatus(
    `Translating ${getLanguageLabel(sourceLanguage)} to ${getLanguageLabel(targetLanguage)}`,
    "is-active",
  );

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error("Translation request failed");
  }

  const data = await response.json();
  const translated = data[0].map((part) => part[0]).join("");

  if (requestId === translationRequest) {
    translationText.value = translated;
    setStatus("Translated", "is-active");
  }
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
    } catch {
      if (requestId === translationRequest) {
        translationText.value = "";
        setStatus("Translation failed", "is-error");
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

  try {
    await navigator.clipboard.writeText(textarea.value);
    setStatus("Copied", "is-active");
  } catch {
    textarea.select();
    document.execCommand("copy");
    setStatus("Copied", "is-active");
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
