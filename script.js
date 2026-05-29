const sourceText = document.querySelector("[data-source]");
const resultText = document.querySelector("[data-result]");
const statusLabel = document.querySelector("[data-status]");
const controls = document.querySelector(".controls");
const copyButton = document.querySelector('[data-action="copy"]');
const clearButton = document.querySelector('[data-action="clear"]');

const options = {
  hyphen: document.querySelector('[data-option="hyphen"]'),
  paragraphs: document.querySelector('[data-option="paragraphs"]'),
  spaces: document.querySelector('[data-option="spaces"]'),
};

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

function setStatus(message, state = "") {
  statusLabel.textContent = message;
  statusLabel.className = state ? `status ${state}` : "status";
}

function updateResult() {
  const result = cleanText(sourceText.value);
  resultText.value = result;

  const wordCount = result ? result.split(/\s+/).length : 0;
  setStatus(wordCount ? `${wordCount} words` : "Ready", wordCount ? "is-active" : "");
}

async function copyResult() {
  if (!resultText.value) {
    setStatus("Nothing to copy", "is-error");
    return;
  }

  try {
    await navigator.clipboard.writeText(resultText.value);
    setStatus("Copied", "is-active");
  } catch {
    resultText.select();
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
copyButton.addEventListener("click", copyResult);
clearButton.addEventListener("click", clearText);

updateResult();
