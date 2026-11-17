/**
 * AniList lookup + local cache for anime verification.
 * Docs: https://docs.anilist.co/
 */

const ANILIST_URL = 'https://graphql.anilist.co';
const CACHE_KEY = 'animeCatalog';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MIN_AUTO_CONFIRM = 0.86;
const MIN_LIKELY = 0.62;

const SEARCH_QUERY = `
  query ($search: String!) {
    Page(page: 1, perPage: 8) {
      media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
        id
        idMal
        siteUrl
        format
        episodes
        genres
        averageScore
        title {
          romaji
          english
          native
          userPreferred
        }
      }
    }
  }
`;

export function catalogKey(showName) {
  return String(showName || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeTitle(value) {
  return catalogKey(value);
}

function titleVariants(media) {
  const t = media?.title || {};
  return [t.english, t.romaji, t.native, t.userPreferred].filter(Boolean);
}

function scoreTitleMatch(query, media) {
  const q = normalizeTitle(query);
  if (!q) return 0;

  let best = 0;
  for (const raw of titleVariants(media)) {
    const t = normalizeTitle(raw);
    if (!t) continue;
    if (t === q) {
      best = Math.max(best, 1);
      continue;
    }
    if (t.startsWith(q) || q.startsWith(t)) {
      const ratio = Math.min(t.length, q.length) / Math.max(t.length, q.length);
      best = Math.max(best, 0.82 + ratio * 0.12);
      continue;
    }
    if (t.includes(q) || q.includes(t)) {
      const ratio = Math.min(t.length, q.length) / Math.max(t.length, q.length);
      best = Math.max(best, 0.68 + ratio * 0.12);
      continue;
    }

    const qTokens = new Set(q.split(' ').filter(Boolean));
    const tTokens = new Set(t.split(' ').filter(Boolean));
    if (!qTokens.size || !tTokens.size) continue;
    let overlap = 0;
    for (const token of qTokens) {
      if (tTokens.has(token)) overlap += 1;
    }
    const tokenScore = overlap / Math.max(qTokens.size, tTokens.size);
    if (tokenScore >= 0.5) best = Math.max(best, 0.55 + tokenScore * 0.25);
  }
  return Math.min(1, best);
}

function compactMedia(media, confidence) {
  if (!media) return null;
  return {
    id: media.id,
    idMal: media.idMal || null,
    siteUrl: media.siteUrl || null,
    format: media.format || null,
    episodes: media.episodes || null,
    genres: media.genres || [],
    averageScore: media.averageScore || null,
    title: {
      romaji: media.title?.romaji || null,
      english: media.title?.english || null,
      native: media.title?.native || null,
      userPreferred: media.title?.userPreferred || null,
    },
    confidence,
  };
}

function statusFromConfidence(confidence, hasMatch) {
  if (!hasMatch) return 'unlikely';
  if (confidence >= MIN_AUTO_CONFIRM) return 'confirmed';
  if (confidence >= MIN_LIKELY) return 'likely';
  return 'unlikely';
}

export async function getAnimeCatalog() {
  const data = await chrome.storage.local.get([CACHE_KEY]);
  return data[CACHE_KEY] || {};
}

export async function getCatalogEntry(showName) {
  const key = catalogKey(showName);
  if (!key) return null;
  const catalog = await getAnimeCatalog();
  return catalog[key] || null;
}

export async function saveCatalogEntry(showName, entry) {
  const key = catalogKey(showName);
  if (!key) return null;
  const catalog = await getAnimeCatalog();
  catalog[key] = {
    ...entry,
    query: showName,
    key,
    updatedAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [CACHE_KEY]: catalog });
  return catalog[key];
}

export async function setCatalogOverride(showName, { status, match = null }) {
  const existing = (await getCatalogEntry(showName)) || {};
  return saveCatalogEntry(showName, {
    ...existing,
    status,
    match: match || existing.match || null,
    confidence: status === 'confirmed' ? 1 : status === 'rejected' ? 0 : existing.confidence || 0,
    userOverride: true,
    checkedAt: existing.checkedAt || new Date().toISOString(),
  });
}

async function searchAniList(search) {
  const response = await fetch(ANILIST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      query: SEARCH_QUERY,
      variables: { search },
    }),
  });

  if (response.status === 429) {
    const error = new Error('AniList rate limited');
    error.code = 'RATE_LIMIT';
    throw error;
  }
  if (!response.ok) {
    throw new Error(`AniList HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors[0]?.message || 'AniList query failed');
  }
  return payload.data?.Page?.media || [];
}

/**
 * Resolve whether a show title looks like anime.
 * Uses cache when fresh unless force=true.
 */
export async function verifyAnimeTitle(showName, { force = false } = {}) {
  const key = catalogKey(showName);
  if (!key) {
    return {
      query: showName,
      status: 'unknown',
      confidence: 0,
      match: null,
      candidates: [],
      isAnime: false,
    };
  }

  const existing = await getCatalogEntry(showName);
  if (
    !force &&
    existing?.checkedAt &&
    Date.now() - new Date(existing.checkedAt).getTime() < CACHE_TTL_MS &&
    existing.status &&
    existing.status !== 'error'
  ) {
    return {
      ...existing,
      isAnime: existing.status === 'confirmed' || existing.status === 'likely',
    };
  }

  // Preserve manual overrides across refresh unless force clears them.
  if (!force && existing?.userOverride && (existing.status === 'confirmed' || existing.status === 'rejected')) {
    return {
      ...existing,
      isAnime: existing.status === 'confirmed',
    };
  }

  try {
    const results = await searchAniList(showName);
    const ranked = results
      .map((media) => {
        const confidence = scoreTitleMatch(showName, media);
        return compactMedia(media, confidence);
      })
      .filter(Boolean)
      .sort((a, b) => b.confidence - a.confidence);

    const best = ranked[0] || null;
    const confidence = best?.confidence || 0;
    const status = statusFromConfidence(confidence, Boolean(best));

    const entry = await saveCatalogEntry(showName, {
      status,
      confidence,
      match: best,
      candidates: ranked.slice(0, 5),
      checkedAt: new Date().toISOString(),
      userOverride: false,
      source: 'anilist',
    });

    return {
      ...entry,
      isAnime: status === 'confirmed' || status === 'likely',
    };
  } catch (error) {
    const entry = await saveCatalogEntry(showName, {
      status: 'error',
      confidence: existing?.confidence || 0,
      match: existing?.match || null,
      candidates: existing?.candidates || [],
      checkedAt: new Date().toISOString(),
      userOverride: existing?.userOverride || false,
      error: error.message || String(error),
      source: 'anilist',
    });
    return {
      ...entry,
      isAnime: existing?.status === 'confirmed' || existing?.status === 'likely',
    };
  }
}

export function isAnimeStatus(status) {
  return status === 'confirmed' || status === 'likely';
}
