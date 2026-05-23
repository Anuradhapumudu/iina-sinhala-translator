// ============================================================
//  Sinhala Subtitle Translator — IINA Plugin (main.js)
//  Translates subtitles in real-time to spoken Sinhala via Gemini
// ============================================================

// ── Configuration ────────────────────────────────────────────
// Replace the value below with your own Gemini API key.
// Get one free at: https://aistudio.google.com/app/apikey
const GEMINI_API_KEY = iina.preferences.get("geminiApiKey") || "";

const GEMINI_MODEL = "gemini-3-flash";
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

const POLL_INTERVAL_MS = 300;

const TRANSLATION_PROMPT =
  "Translate the following subtitle line into natural spoken Sinhala, " +
  "as if a Sri Lankan person is casually speaking. " +
  "Do NOT use formal or written Sinhala. " +
  "Return ONLY the translated Sinhala text, nothing else. " +
  "Do not explain. Subtitle: ";

// ── State ────────────────────────────────────────────────────
let translationEnabled = true;
let lastSubtitleText = "";
let isTranslating = false;
let pollTimer = null;

// ── Modules ──────────────────────────────────────────────────
const { overlay, mpv, menu, http, console: log } = iina;

// ── Overlay Setup ────────────────────────────────────────────
overlay.loadFile("overlay.html");
overlay.show();

// ── Translation Cache ────────────────────────────────────────
// Simple LRU-ish cache to avoid re-translating repeated lines
const translationCache = new Map();
const CACHE_MAX_SIZE = 100;

function cacheSet(key, value) {
  if (translationCache.size >= CACHE_MAX_SIZE) {
    // Delete the oldest entry
    const firstKey = translationCache.keys().next().value;
    translationCache.delete(firstKey);
  }
  translationCache.set(key, value);
}

function cacheGet(key) {
  return translationCache.get(key);
}

// ── Gemini API Call ──────────────────────────────────────────
async function translateWithGemini(text) {
  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: TRANSLATION_PROMPT + text,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 256,
    },
  };

  try {
    const response = await http.request({
      method: "POST",
      url: GEMINI_ENDPOINT,
      headers: {
        "Content-Type": "application/json",
      },
      data: JSON.stringify(requestBody),
    });

    // Parse the response
    const result = response.data;

    if (
      result &&
      result.candidates &&
      result.candidates.length > 0 &&
      result.candidates[0].content &&
      result.candidates[0].content.parts &&
      result.candidates[0].content.parts.length > 0
    ) {
      return result.candidates[0].content.parts[0].text.trim();
    }

    // If response structure is unexpected, return null
    log.log("[SinhalaTranslator] Unexpected API response structure");
    return null;
  } catch (error) {
    log.log("[SinhalaTranslator] API error: " + String(error));
    return null;
  }
}

// ── Subtitle Processing ─────────────────────────────────────
async function processSubtitle(subtitleText) {
  if (!subtitleText || subtitleText.trim() === "") {
    // No subtitle visible — hide the overlay text
    lastSubtitleText = "";
    overlay.postMessage("hide", {});
    return;
  }

  const cleaned = subtitleText.trim();

  // Same subtitle as before — skip
  if (cleaned === lastSubtitleText) {
    return;
  }

  lastSubtitleText = cleaned;

  // If translation is off, do nothing
  if (!translationEnabled) {
    overlay.postMessage("hide", {});
    return;
  }

  // Check the cache first
  const cached = cacheGet(cleaned);
  if (cached) {
    overlay.postMessage("show-subtitle", { text: cached });
    return;
  }

  // Show loading indicator
  overlay.postMessage("loading", {});
  isTranslating = true;

  // Call Gemini
  const translated = await translateWithGemini(cleaned);
  isTranslating = false;

  // The subtitle may have changed while we were translating
  if (cleaned !== lastSubtitleText) {
    return;
  }

  if (translated) {
    cacheSet(cleaned, translated);
    overlay.postMessage("show-subtitle", { text: translated });
  } else {
    // Translation failed — show original text dimmed as fallback
    overlay.postMessage("show-fallback", { text: cleaned });
  }
}

// ── Polling Loop ─────────────────────────────────────────────
function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    try {
      const subText = mpv.getString("sub-text");
      processSubtitle(subText || "");
    } catch (e) {
      // sub-text may not be available if no subtitle track is loaded
    }
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ── Menu Toggle ──────────────────────────────────────────────
function updateMenuTitle(item) {
  item.title = translationEnabled
    ? "✓ Sinhala Translation (ON)"
    : "  Sinhala Translation (OFF)";
}

const toggleItem = menu.item(
  "✓ Sinhala Translation (ON)",
  () => {
    translationEnabled = !translationEnabled;
    updateMenuTitle(toggleItem);

    if (translationEnabled) {
      iina.core.osd("සිංහල පරිවර්තනය සක්‍රියයි  ✓");
      lastSubtitleText = ""; // Force re-translate the current subtitle
      startPolling();
    } else {
      iina.core.osd("සිංහල පරිවර්තනය අක්‍රියයි  ✗");
      overlay.postMessage("hide", {});
      stopPolling();
    }
  },
  {
    keyBinding: "t",
  }
);

menu.addItem(toggleItem);

// ── Initialise ───────────────────────────────────────────────
log.log("[SinhalaTranslator] Plugin loaded — polling for subtitles...");
startPolling();
