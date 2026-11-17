/**
 * Platform detection + title/episode extraction for Netflix, YouTube, Disney+.
 */

import { cleanText, normalizeWatchIdentity, parseEpisodeLabel } from './normalize.js';

export const WATCH_SITES = [
  'netflix.com',
  'youtube.com',
  'youtu.be',
  'disneyplus.com',
];

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isWatchSite(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return WATCH_SITES.some((site) => host === site || host.endsWith(`.${site}`));
  } catch {
    return false;
  }
}

/** @deprecated use isWatchSite */
export const isAnimeSite = isWatchSite;

/**
 * @param {string} url
 * @returns {'netflix'|'youtube'|'disneyplus'|null}
 */
export function getPlatform(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    if (host.includes('netflix')) return 'netflix';
    if (host.includes('youtube') || host === 'youtu.be') return 'youtube';
    if (host.includes('disneyplus')) return 'disneyplus';
    return null;
  } catch {
    return null;
  }
}

function firstText(selectors, root = document) {
  for (const selector of selectors) {
    const el = root.querySelector(selector);
    const text = cleanText(el?.textContent || el?.getAttribute?.('aria-label') || '');
    if (text) return text;
  }
  return '';
}

function childTexts(root, selectors) {
  if (!root) return [];
  return selectors
    .map((selector) => cleanText(root.querySelector(selector)?.textContent || ''))
    .filter(Boolean);
}

/**
 * Find a usable HTML5 video element when the platform exposes one.
 * @param {Document} doc
 * @returns {HTMLVideoElement|null}
 */
export function findVideoPlayer(doc = document) {
  const videos = Array.from(doc.querySelectorAll('video'));
  if (!videos.length) return null;

  const visible = videos.find((video) => {
    const rect = video.getBoundingClientRect();
    return rect.width > 80 && rect.height > 45;
  });
  return visible || videos[0];
}

function parseYouTube(url, doc = document) {
  const title =
    firstText(
      [
        'h1.ytd-watch-metadata yt-formatted-string',
        'h1.ytd-video-primary-info-renderer',
        '#title h1',
        'h1.title',
      ],
      doc
    ) ||
    cleanText(doc.querySelector('meta[property="og:title"]')?.content) ||
    cleanText(doc.title.replace(/ - YouTube$/i, ''));

  const channel = firstText(
    [
      '#channel-name a',
      'ytd-channel-name a',
      '#owner-name a',
      '#upload-info #channel-name',
    ],
    doc
  );

  const normalized = normalizeWatchIdentity(title);
  if (!normalized) return null;

  return {
    showName: normalized.showName,
    seasonNumber: normalized.seasonNumber,
    episodeNumber: null,
    episodeLabel: channel || null,
    site: 'youtube',
    url,
  };
}

function parseNetflix(url, doc = document) {
  const titleRoot =
    doc.querySelector('[data-uia="video-title"]') ||
    doc.querySelector('.watch-video--player-view [data-uia="video-title"]') ||
    doc.querySelector('.video-title');

  // Netflix often nests show + episode under the same video-title node.
  const nested = childTexts(titleRoot, ['h4', 'span', 'p', 'div']);
  let showCandidate = nested[0] || '';
  let episodeCandidate = nested.slice(1).join(' · ');

  if (!showCandidate) {
    showCandidate =
      firstText(
        [
          '[data-uia="video-title"] h4',
          '.video-title h4',
          '.watch-video--title-container h4',
          'h4[data-uia="video-title"]',
        ],
        doc
      ) ||
      cleanText(doc.querySelector('meta[property="og:title"]')?.content) ||
      cleanText(doc.title.replace(/\s*[-–|]\s*Netflix.*$/i, ''));
  }

  if (!episodeCandidate) {
    episodeCandidate = firstText(
      [
        '[data-uia="video-subtitle"]',
        '[data-uia="episode-title"]',
        '[data-uia="video-title"] span',
        '.ellipsis',
      ],
      doc
    );
  }

  // If the only scraped string is the whole title blob, let normalizer split E#
  const normalized = normalizeWatchIdentity(showCandidate, episodeCandidate);
  if (!normalized) return null;

  // Prefer explicit episode parsing from episode candidate when present
  const episodeParsed = parseEpisodeLabel(episodeCandidate);
  const episodeNumber = episodeParsed?.episodeNumber ?? normalized.episodeNumber;
  const seasonNumber = episodeParsed?.seasonNumber ?? normalized.seasonNumber ?? null;
  const episodeLabel =
    episodeParsed?.episodeLabel ||
    normalized.episodeLabel ||
    (episodeCandidate && !episodeParsed ? cleanText(episodeCandidate) : null);

  return {
    showName: normalized.showName,
    seasonNumber,
    episodeNumber,
    episodeLabel,
    site: 'netflix',
    url,
  };
}

function parseDisneyPlus(url, doc = document) {
  const title =
    firstText(
      [
        '[data-testid="title-text"]',
        '[data-testid="asset-title"]',
        'h1',
        '.title-field',
        '[class*="titleText"]',
      ],
      doc
    ) ||
    cleanText(doc.querySelector('meta[property="og:title"]')?.content) ||
    cleanText(doc.title.replace(/\s*\|\s*Disney\+.*$/i, ''));

  const episodeText = firstText(
    [
      '[data-testid="subtitle-text"]',
      '[data-testid="episode-title"]',
      '[class*="subtitle"]',
      'h2',
    ],
    doc
  );

  const normalized = normalizeWatchIdentity(title, episodeText);
  if (!normalized) return null;

  return {
    showName: normalized.showName,
    seasonNumber: normalized.seasonNumber,
    episodeNumber: normalized.episodeNumber,
    episodeLabel: normalized.episodeLabel,
    site: 'disneyplus',
    url,
  };
}

/**
 * Extract watch metadata for the current page.
 * @param {string} url
 * @param {Document|null} doc
 */
export function extractShowInfo(url, doc = document) {
  const platform = getPlatform(url);
  if (!platform) return null;

  try {
    if (platform === 'youtube') return parseYouTube(url, doc);
    if (platform === 'netflix') return parseNetflix(url, doc);
    if (platform === 'disneyplus') return parseDisneyPlus(url, doc);
  } catch (error) {
    console.debug('[Anime Tracker] extractShowInfo failed', error);
  }

  const fallback = normalizeWatchIdentity(doc?.title || '');
  if (!fallback) return null;
  return {
    showName: fallback.showName,
    seasonNumber: fallback.seasonNumber,
    episodeNumber: fallback.episodeNumber,
    episodeLabel: fallback.episodeLabel,
    site: platform,
    url,
  };
}

export { normalizeWatchIdentity, parseEpisodeLabel };
