/**
 * Shared title/episode normalization for parsers + storage migrations.
 */

const SERVICE_NAMES = new Set([
  'netflix',
  'youtube',
  'disney+',
  'disney plus',
  'disneyplus',
  'anime tracker',
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

/**
 * Parse episode markers from free text.
 * @param {string} text
 * @returns {{ seasonNumber: number|null, episodeNumber: number|null, episodeLabel: string|null, remainder: string }|null}
 */
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

  const seasonOnly = raw.match(
    /^(.*?)(?:^|[\s|:_-]+)Season\s*(\d+)(.*)$/i
  );
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
    .trim();

  if (isServiceName(title)) return null;

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
  } else if (episodeText && episodeNumber == null && !isServiceName(episodeText)) {
    // Subtitle without number — keep as label only
    episodeLabel = episodeText;
  }

  title = cleanText(title);
  if (isServiceName(title) || title.length < 1) return null;

  return {
    showName: title,
    seasonNumber,
    episodeNumber,
    episodeLabel,
  };
}

/**
 * Stable episode storage key including season when known.
 */
export function episodeStorageKey(seasonNumber, episodeNumber, episodeLabel) {
  if (episodeNumber != null) {
    const season = seasonNumber != null ? Number(seasonNumber) : 1;
    return `S${season}E${episodeNumber}`;
  }
  if (episodeLabel) return String(episodeLabel);
  return null;
}
