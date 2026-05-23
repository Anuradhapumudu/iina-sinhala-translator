// ============================================================
//  Sinhala Subtitle Translator -- IINA Plugin (main.js)
//  Translates subtitles in real-time to spoken Sinhala via Gemini
// ============================================================

// -- Configuration --------------------------------------------
const GEMINI_API_KEY = "AIzaSyAJDcIOrAhO8weTljfHfhVt9Lfyy3op6r8";
const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/" +
  GEMINI_MODEL +
  ":generateContent?key=" +
  GEMINI_API_KEY;

const POLL_INTERVAL_MS = 300;

const TRANSLATION_PROMPT =
  "Translate the following subtitle line into natural spoken Sinhala, " +
  "as if a Sri Lankan person is casually speaking. " +
  "Do NOT use formal or written Sinhala. " +
  "Return ONLY the translated Sinhala text, nothing else. " +
  "Do not explain. Subtitle: ";

// -- State ----------------------------------------------------
let translationEnabled = true;
let lastSubtitleText = "";
let isTranslating = false;
let pollTimer = null;

// -- Modules --------------------------------------------------
const { overlay, mpv, menu, http, console: log } = iina;

// -- Overlay Setup --------------------------------------------
// Must wait for the window to be ready before calling overlay APIs
iina.event.on("iina.window-loaded", function () {
  overlay.loadFile("overlay.html");
  overlay.show();
});

// -- Translation Cache ----------------------------------------
const translationCache = new Map();
const CACHE_MAX_SIZE = 100;

function cacheSet(key, value) {
  if (translationCache.size >= CACHE_MAX_SIZE) {
    const firstKey = translationCache.keys().next().value;
    translationCache.delete(firstKey);
  }
  translationCache.set(key, value);
}

function cacheGet(key) {
  return translationCache.get(key);
}

// -- Gemini API Call ------------------------------------------
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
    log.log("[SinhalaTranslator] Calling Gemini for: " + text);

    const response = await http.post(GEMINI_ENDPOINT, {
      headers: {
        "Content-Type": "application/json",
      },
      // Manually stringify: IINA JavaScriptCore does not auto-serialize objects
      data: JSON.stringify(requestBody),
    });

    log.log("[SinhalaTranslator] HTTP status: " + response.statusCode);

    // IINA may return raw JSON text in response.data or response.text
    // Try both and parse manually
    let result = null;

    if (response.data && typeof response.data === "object") {
      result = response.data;
    } else {
      var raw = (typeof response.data === "string" && response.data)
        || (typeof response.text === "string" && response.text)
        || "";
      if (raw) {
        try {
          result = JSON.parse(raw);
        } catch (e) {
          log.log("[SinhalaTranslator] JSON parse error. Raw: " + raw.substring(0, 200));
          return null;
        }
      }
    }

    if (!result) {
      log.log("[SinhalaTranslator] Empty response");
      return null;
    }

    if (
      result.candidates &&
      result.candidates.length > 0 &&
      result.candidates[0].content &&
      result.candidates[0].content.parts &&
      result.candidates[0].content.parts.length > 0
    ) {
      var translated = result.candidates[0].content.parts[0].text.trim();
      log.log("[SinhalaTranslator] => " + translated);
      return translated;
    }

    log.log("[SinhalaTranslator] Bad response shape: " + JSON.stringify(result).substring(0, 200));
    return null;
  } catch (error) {
    log.log("[SinhalaTranslator] Request failed: " + JSON.stringify(error));
    return null;
  }
}

// -- Subtitle Processing --------------------------------------
async function processSubtitle(subtitleText) {
  if (!subtitleText || subtitleText.trim() === "") {
    if (lastSubtitleText !== "") {
      lastSubtitleText = "";
      overlay.postMessage("hide", {});
    }
    return;
  }

  var cleaned = subtitleText.trim();

  if (cleaned === lastSubtitleText) {
    return;
  }

  lastSubtitleText = cleaned;

  if (!translationEnabled) {
    overlay.postMessage("hide", {});
    return;
  }

  var cached = cacheGet(cleaned);
  if (cached) {
    overlay.postMessage("show-subtitle", { text: cached });
    return;
  }

  overlay.postMessage("loading", {});
  isTranslating = true;

  var translated = await translateWithGemini(cleaned);
  isTranslating = false;

  if (cleaned !== lastSubtitleText) {
    return;
  }

  if (translated) {
    cacheSet(cleaned, translated);
    overlay.postMessage("show-subtitle", { text: translated });
  } else {
    overlay.postMessage("show-fallback", { text: cleaned });
  }
}

// -- Polling Loop ---------------------------------------------
function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(function () {
    try {
      var subText = mpv.getString("sub-text");
      processSubtitle(subText || "").catch(function (e) {
        log.log("[SinhalaTranslator] processSubtitle threw: " + e);
      });
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

// -- Menu Toggle ----------------------------------------------
function updateMenuTitle(item) {
  item.title = translationEnabled
    ? "Sinhala Translation (ON)"
    : "Sinhala Translation (OFF)";
}

var toggleItem = menu.item(
  "Sinhala Translation (ON)",
  function () {
    translationEnabled = !translationEnabled;
    updateMenuTitle(toggleItem);

    if (translationEnabled) {
      iina.core.osd("Sinhala translation ON");
      lastSubtitleText = "";
      startPolling();
    } else {
      iina.core.osd("Sinhala translation OFF");
      overlay.postMessage("hide", {});
      stopPolling();
    }
  },
  {
    keyBinding: "t",
  }
);

menu.addItem(toggleItem);

// -- Initialise -----------------------------------------------
log.log("[SinhalaTranslator] Plugin loaded.");
startPolling();