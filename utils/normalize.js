/**
 * Shared title/episode normalization for parsers + storage migrations.
 */

const SERVICE_NAMES = new Set([
  'netflix',
  'youtube',
  'disney+',
  'disney plus',
  'disneyplus',
  'crunchyroll',
  'prime video',
  'primevideo',
  'amazon prime video',
  'amazon prime',
  'hidive',
  'hulu',
  'anime tracker',
  'shiori',
]);

/** Streaming chrome that must never become a “show”. */
const UI_NOISE_TITLES = new Set([
  'select profile',
  'who is watching',
  'who\'s watching',
  'search',
  'for you',
  'home',
  'browse',
  'movies',
  'series',
  'originals',
  'sports',
  'extras',
  'privacy preference center',
  'privacy preferences',
  'cookie settings',
  'manage privacy preferences',
  'one trust',
  'onetrust',
  'loading',
  'disney+',
  'disney plus',
  'netflix',
  'youtube',
  'crunchyroll',
  'prime video',
  'primevideo',
  'amazon prime video',
  'amazon prime',
  'amazon',
  'hidive',
  'hulu',
  'watchlist',
  'history',
  'my lists',
  'simulcast season',
  'popular',
  'new',
  'storefront',
  'categories',
]);

export function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

export function isServiceName(name) {
  const key = cleanText(name).toLowerCase();
  return !key || SERVICE_NAMES.has(key);
}

export function isUiNoiseTitle(name) {
  const key = cleanText(name)
    .toLowerCase()
    .replace(/[?.!,;:'"“”‘’]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!key) return true;
  if (UI_NOISE_TITLES.has(key)) return true;
  if (key.includes('privacy preference')) return true;
  if (key.includes('cookie')) return true;
  if (key.includes('who is watching') || key.includes('whos watching')) return true;
  if (key.startsWith('onetrust')) return true;
  return false;
}

/**
 * True when we have a real episode identity worth storing.
 * Freeform labels alone are too noisy (cookie banners, profile chrome).
 */
export function isUsableEpisodeRef(seasonNumber, episodeNumber, episodeLabel) {
  const num = episodeNumber != null ? Number(episodeNumber) : NaN;
  if (Number.isFinite(num) && num > 0) return true;
  const parsed = parseEpisodeLabel(episodeLabel || '');
  if (parsed?.episodeNumber != null && parsed.episodeNumber > 0) return true;
  return false;
}

/**
 * Parse "Season N" from free text (selector labels, aria-labels, etc.).
 * @param {string} text
 * @returns {number|null}
 */
export function parseSeasonOnly(text) {
  const raw = cleanText(text);
  if (!raw) return null;
  const match = raw.match(/\bSeason\s*(\d+)\b/i) || raw.match(/\bS(?:eason)?\s*(\d+)\b/i);
  if (!match) return null;
  const season = Number(match[1]);
  return Number.isFinite(season) && season > 0 ? season : null;
}

export function parseEpisodeLabel(text) {
  const raw = cleanText(text);
  if (!raw) return null;

  const seasonEpisode = raw.match(
    /^(.*?)(?:^|[\s|:_-]+)S(?:eason)?\s*(\d+)\s*[,:\-_]?\s*E(?:p(?:isode)?)?\s*(\d+)(.*)$/i
  );
  if (seasonEpisode) {
    const seasonNumber = Number(seasonEpisode[2]);
    const episodeNumber = Number(seasonEpisode[3]);
    const remainder = cleanText(`${seasonEpisode[1]} ${seasonEpisode[4]}`);
    return {
      seasonNumber,
      episodeNumber,
      episodeLabel: `S${seasonNumber} E${episodeNumber}`,
      remainder,
    };
  }

  // Netflix / compact forms: "2:11", "2.11", "2x11", "2 11" (short strings only)
  const compact = raw.match(
    /^(.*?)(?:^|[\s|:_-]+)(\d{1,2})\s*[:.x×]\s*E?\s*(\d{1,3})(?:\b|$)(.*)$/i
  );
  if (compact) {
    const seasonNumber = Number(compact[2]);
    const episodeNumber = Number(compact[3]);
    if (seasonNumber > 0 && seasonNumber < 50 && episodeNumber > 0 && episodeNumber < 500) {
      const remainder = cleanText(`${compact[1]} ${compact[4]}`);
      return {
        seasonNumber,
        episodeNumber,
        episodeLabel: `S${seasonNumber} E${episodeNumber}`,
        remainder,
      };
    }
  }

  // Opensubtitles-style Netflix span: "2 11" or "Season 2 Episode 11" in a short blob
  const spacedPair = raw.match(/^(\d{1,2})\D+(\d{1,3})$/);
  if (spacedPair && raw.length <= 24) {
    const seasonNumber = Number(spacedPair[1]);
    const episodeNumber = Number(spacedPair[2]);
    if (seasonNumber > 0 && seasonNumber < 50 && episodeNumber > 0 && episodeNumber < 500) {
      return {
        seasonNumber,
        episodeNumber,
        episodeLabel: `S${seasonNumber} E${episodeNumber}`,
        remainder: '',
      };
    }
  }

  const seasonEpisodeWords = raw.match(
    /^(.*?)(?:^|[\s|:_-]+)Season\s*(\d+)\s*[,:\-_]?\s*Episode\s*(\d+)(.*)$/i
  );
  if (seasonEpisodeWords) {
    const seasonNumber = Number(seasonEpisodeWords[2]);
    const episodeNumber = Number(seasonEpisodeWords[3]);
    const remainder = cleanText(`${seasonEpisodeWords[1]} ${seasonEpisodeWords[4]}`);
    return {
      seasonNumber,
      episodeNumber,
      episodeLabel: `S${seasonNumber} E${episodeNumber}`,
      remainder,
    };
  }

  const seasonOnly = raw.match(/^(.*?)(?:^|[\s|:_-]+)Season\s*(\d+)(.*)$/i);
  if (seasonOnly) {
    const seasonNumber = Number(seasonOnly[2]);
    const remainder = cleanText(`${seasonOnly[1]} ${seasonOnly[3]}`);
    const nested = parseEpisodeLabel(remainder);
    return {
      seasonNumber,
      episodeNumber: nested?.episodeNumber ?? null,
      episodeLabel:
        nested?.episodeNumber != null
          ? `S${seasonNumber} E${nested.episodeNumber}`
          : `Season ${seasonNumber}`,
      remainder: nested?.remainder || remainder,
    };
  }

  const episodeOnly = raw.match(
    /^(.*?)(?:^|[\s|:_-]+)(?:Ep(?:isode)?|E)\s*(\d+)(.*)$/i
  );
  if (episodeOnly) {
    const episodeNumber = Number(episodeOnly[2]);
    const remainder = cleanText(`${episodeOnly[1]} ${episodeOnly[3]}`);
    return {
      seasonNumber: null,
      episodeNumber,
      episodeLabel: `Episode ${episodeNumber}`,
      remainder,
    };
  }

  // Glued forms: Haikyu!!E6Tempo / ShowNameE12
  const glued = raw.match(/^(.*?)E(\d+)([A-Za-z].*)?$/);
  if (glued && glued[1] && /[A-Za-z0-9)]/.test(glued[1])) {
    const episodeNumber = Number(glued[2]);
    const tail = cleanText(glued[3] || '');
    return {
      seasonNumber: null,
      episodeNumber,
      episodeLabel: tail ? `Episode ${episodeNumber} · ${tail}` : `Episode ${episodeNumber}`,
      remainder: cleanText(glued[1]),
    };
  }

  return null;
}

/**
 * Turn a messy scraped title into canonical show + episode fields.
 * @param {string} rawTitle
 * @param {string} [rawEpisodeText]
 * @returns {{ showName: string, seasonNumber: number|null, episodeNumber: number|null, episodeLabel: string|null }|null}
 */
export function normalizeWatchIdentity(rawTitle, rawEpisodeText = '') {
  let title = cleanText(rawTitle)
    .replace(/\s*[-–|]\s*Netflix.*$/i, '')
    .replace(/\s*[-–|]\s*YouTube.*$/i, '')
    .replace(/\s*[-–|]\s*Disney\+.*$/i, '')
    .replace(/\s*[-–|]\s*Watch on Crunchyroll.*$/i, '')
    .replace(/\s*[-–|]\s*Crunchyroll.*$/i, '')
    .replace(/\s*[-–|:]\s*Prime Video.*$/i, '')
    .replace(/\s*[-–|:]\s*Amazon Prime.*$/i, '')
    .replace(/\s*[-–|:]\s*HIDIVE.*$/i, '')
    .replace(/\s*[-–|:]\s*HiDive.*$/i, '')
    .replace(/\s*[-–|:]\s*Watch on Hulu.*$/i, '')
    .replace(/\s*[-–|:]\s*Hulu.*$/i, '')
    .trim();

  if (isServiceName(title) || isUiNoiseTitle(title)) return null;

  let seasonNumber = null;
  let episodeNumber = null;
  let episodeLabel = null;

  const fromEpisodeField = parseEpisodeLabel(rawEpisodeText);
  if (fromEpisodeField) {
    seasonNumber = fromEpisodeField.seasonNumber;
    episodeNumber = fromEpisodeField.episodeNumber;
    episodeLabel = fromEpisodeField.episodeLabel;
  }

  const fromTitle = parseEpisodeLabel(title);
  if (fromTitle?.remainder) {
    title = fromTitle.remainder;
    if (episodeNumber == null) {
      episodeNumber = fromTitle.episodeNumber;
      episodeLabel = fromTitle.episodeLabel;
    }
    if (seasonNumber == null) seasonNumber = fromTitle.seasonNumber;
  }

  // If episode text is a plain title (not E#), keep as label when we already have a number
  const episodeText = cleanText(rawEpisodeText);
  if (episodeText && episodeNumber != null && !parseEpisodeLabel(episodeText)) {
    episodeLabel =
      seasonNumber != null
        ? `S${seasonNumber} E${episodeNumber} · ${episodeText}`
        : `Episode ${episodeNumber} · ${episodeText}`;
  } else if (
    episodeText &&
    episodeNumber == null &&
    !isServiceName(episodeText) &&
    !isUiNoiseTitle(episodeText)
  ) {
    // Subtitle without number — keep as label only when it isn't UI chrome
    episodeLabel = episodeText;
  }

  title = cleanText(title);
  if (isServiceName(title) || isUiNoiseTitle(title) || title.length < 1) return null;

  if (episodeLabel && isUiNoiseTitle(episodeLabel)) {
    episodeLabel =
      seasonNumber != null && episodeNumber != null
        ? `S${seasonNumber} E${episodeNumber}`
        : episodeNumber != null
          ? `Episode ${episodeNumber}`
          : null;
  }

  // Drop unparseable episode identity entirely (no freeform-only keys).
  if (!isUsableEpisodeRef(seasonNumber, episodeNumber, episodeLabel)) {
    episodeNumber = null;
    episodeLabel = null;
  }

  return {
    showName: title,
    seasonNumber,
    episodeNumber,
    episodeLabel,
  };
}

/**
 * Stable episode storage key including season when known.
 * Returns null when episode identity is missing or UI noise.
 */
export function episodeStorageKey(seasonNumber, episodeNumber, episodeLabel) {
  if (!isUsableEpisodeRef(seasonNumber, episodeNumber, episodeLabel)) return null;

  const parsed = parseEpisodeLabel(episodeLabel || '');
  const ep =
    episodeNumber != null && Number(episodeNumber) > 0
      ? Number(episodeNumber)
      : parsed?.episodeNumber;
  if (ep == null) return null;

  const season =
    seasonNumber != null && Number(seasonNumber) > 0
      ? Number(seasonNumber)
      : parsed?.seasonNumber != null
        ? Number(parsed.seasonNumber)
        : 1;
  return `S${season}E${ep}`;
}
