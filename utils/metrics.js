/**
 * Derived insights for Shiori dashboards.
 */

import { formatTime, getDateKey, getDateRange } from './storage.js';

export const SUGGESTED_TAGS = [
  'shonen',
  'slice of life',
  'sports',
  'fantasy',
  'romance',
  'mecha',
  'horror',
  'comedy',
  'drama',
  'isekai',
];

function platformKey(show) {
  const raw = String(show.platform || show.site || '').toLowerCase();
  if (raw.includes('netflix')) return 'netflix';
  if (raw.includes('disney')) return 'disneyplus';
  if (raw.includes('youtube') || raw.includes('youtu')) return 'youtube';
  if (!raw) return 'unknown';
  return raw;
}

function platformLabel(key) {
  return (
    {
      netflix: 'Netflix',
      disneyplus: 'Disney+',
      youtube: 'YouTube',
      unknown: 'Unknown',
    }[key] || key
  );
}

function allEpisodes(shows = {}) {
  const list = [];
  for (const [showName, show] of Object.entries(shows)) {
    for (const [episodeKey, episode] of Object.entries(show.episodes || {})) {
      list.push({ showName, episodeKey, show, episode });
    }
  }
  return list;
}

/**
 * Compute streak from a daily totals map { 'YYYY-MM-DD': ms }
 */
export function computeStreaks(daily = {}) {
  const today = getDateKey(new Date());
  const keys = Object.keys(daily)
    .filter((key) => (daily[key] || 0) > 0)
    .sort();

  if (!keys.length) {
    return { current: 0, best: 0, lastActive: null };
  }

  let best = 1;
  let run = 1;
  for (let i = 1; i < keys.length; i++) {
    const prev = new Date(`${keys[i - 1]}T12:00:00`);
    const curr = new Date(`${keys[i]}T12:00:00`);
    const diffDays = Math.round((curr - prev) / 86400000);
    if (diffDays === 1) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 1;
    }
  }

  // Current streak: walk backward from today (allow today or yesterday as anchor).
  let current = 0;
  const active = new Set(keys);
  let cursor = new Date(`${today}T12:00:00`);
  if (!active.has(today)) {
    cursor.setDate(cursor.getDate() - 1);
    const yesterday = getDateKey(cursor);
    if (!active.has(yesterday)) {
      return { current: 0, best, lastActive: keys[keys.length - 1] };
    }
  }

  while (active.has(getDateKey(cursor))) {
    current += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return { current, best: Math.max(best, current), lastActive: keys[keys.length - 1] };
}

/**
 * Peak watch window from hourly ms map.
 */
export function computePrimeHours(hourly = {}) {
  const values = Array.from({ length: 24 }, (_, hour) => {
    const key = String(hour).padStart(2, '0');
    return { hour, ms: hourly[key] || 0 };
  });

  const peak = values.reduce(
    (best, row) => (row.ms > best.ms ? row : best),
    values[0]
  );

  // Best 3-hour window
  let bestWindow = { start: 0, ms: 0 };
  for (let start = 0; start < 24; start++) {
    const ms =
      values[start].ms +
      values[(start + 1) % 24].ms +
      values[(start + 2) % 24].ms;
    if (ms > bestWindow.ms) bestWindow = { start, ms };
  }

  const fmt = (h) => `${h}:00`;
  return {
    peakHour: peak.hour,
    peakLabel: `${fmt(peak.hour)}–${fmt((peak.hour + 1) % 24)}`,
    peakMs: peak.ms,
    windowStart: bestWindow.start,
    windowLabel: `${fmt(bestWindow.start)}–${fmt((bestWindow.start + 3) % 24)}`,
    windowMs: bestWindow.ms,
  };
}

/**
 * Full insights object for a selected range (+ optional longer daily map for streaks).
 */
export function computeInsights(aggregated, { showTags = {}, streakDaily = null } = {}) {
  const shows = aggregated?.shows || {};
  const episodes = allEpisodes(shows);

  const started = episodes.filter(
    (row) => (row.episode.time || 0) > 0 || (row.episode.progress || 0) > 0.01
  );
  const completed = started.filter(
    (row) => row.episode.completed || (row.episode.progress || 0) >= 0.8
  );
  const completionRate = started.length
    ? Math.round((completed.length / started.length) * 100)
    : 0;

  const totalTime = aggregated?.stats?.totalTime || 0;
  const totalSessions = Object.values(shows).reduce(
    (sum, show) => sum + (show.sessions || 0),
    0
  );
  const bingeMinutes =
    totalSessions > 0 ? Math.round(totalTime / totalSessions / 60000) : 0;
  const bingeEpisodes =
    totalSessions > 0
      ? Number((completed.length / totalSessions).toFixed(2))
      : 0;

  const dailyForStreak = streakDaily || aggregated?.daily || {};
  const streaks = computeStreaks(dailyForStreak);

  const platformTotals = {};
  for (const show of Object.values(shows)) {
    const key = platformKey(show);
    platformTotals[key] = (platformTotals[key] || 0) + (show.totalTime || 0);
  }
  const platformSplit = Object.entries(platformTotals)
    .map(([key, ms]) => ({
      key,
      label: platformLabel(key),
      ms,
      pct: totalTime > 0 ? Math.round((ms / totalTime) * 100) : 0,
    }))
    .sort((a, b) => b.ms - a.ms);

  const primeHours = computePrimeHours(aggregated?.hourly || {});

  const resumeDebt = started
    .filter((row) => !row.episode.completed && (row.episode.progress || 0) < 0.8)
    .map((row) => ({
      showName: row.showName,
      episodeKey: row.episodeKey,
      label: row.episode.label || `Episode ${row.episodeKey}`,
      progress: Math.round((row.episode.progress || 0) * 100),
      time: row.episode.time || 0,
      remainingMs:
        row.episode.duration > 0
          ? Math.max(0, row.episode.duration * 1000 - (row.episode.currentTime || 0) * 1000)
          : 0,
    }))
    .sort((a, b) => b.progress - a.progress);

  let watchedAgainstRuntime = 0;
  let runtimeMs = 0;
  for (const row of started) {
    watchedAgainstRuntime += row.episode.time || 0;
    if (row.episode.duration > 0) {
      runtimeMs += row.episode.duration * 1000;
    }
  }
  const paceRatio = runtimeMs > 0 ? watchedAgainstRuntime / runtimeMs : null;
  const pacePct = paceRatio != null ? Math.round(paceRatio * 100) : null;

  const tagMap = {};
  for (const [showName, show] of Object.entries(shows)) {
    const tags = showTags[showName] || [];
    for (const tag of tags) {
      if (!tagMap[tag]) tagMap[tag] = { tag, shows: 0, ms: 0 };
      tagMap[tag].shows += 1;
      tagMap[tag].ms += show.totalTime || 0;
    }
  }
  const genreTags = Object.values(tagMap).sort((a, b) => b.ms - a.ms);
  const untaggedShows = Object.keys(shows).filter(
    (name) => !(showTags[name] || []).length
  ).length;

  const rewatchEpisodes = episodes
    .map((row) => ({
      showName: row.showName,
      episodeKey: row.episodeKey,
      label: row.episode.label || `Episode ${row.episodeKey}`,
      rewatches: row.episode.rewatches || 0,
      sessions: row.episode.sessions || 0,
    }))
    .filter((row) => row.rewatches > 0 || row.sessions > 1)
    .sort(
      (a, b) =>
        b.rewatches - a.rewatches || b.sessions - a.sessions
    );
  const rewatchCount = episodes.reduce(
    (sum, row) => sum + (row.episode.rewatches || 0),
    0
  );

  const activeTime = Object.values(shows).reduce(
    (sum, show) => sum + (show.activeTime || 0),
    0
  );
  const pausedTime = Object.values(shows).reduce(
    (sum, show) => sum + (show.pausedTime || 0),
    0
  );
  const focusDenom = activeTime + pausedTime;
  const focusRatio =
    focusDenom > 0 ? Math.round((activeTime / focusDenom) * 100) : null;
  // Legacy data had activeTime === totalTime and no pausedTime.
  const focusIsEstimate = pausedTime === 0 && activeTime > 0 && activeTime >= totalTime * 0.95;

  return {
    completionRate: {
      value: completionRate,
      label: `${completionRate}%`,
      detail: `${completed.length} of ${started.length} started episodes finished`,
      completed: completed.length,
      started: started.length,
    },
    bingeScore: {
      minutesPerSession: bingeMinutes,
      episodesPerSession: bingeEpisodes,
      label: bingeMinutes > 0 ? `${bingeMinutes}m / session` : '—',
      detail:
        bingeEpisodes > 0
          ? `${bingeEpisodes} finished eps / session · ${totalSessions} sessions`
          : `${totalSessions} sessions in range`,
    },
    streaks: {
      ...streaks,
      label: streaks.current > 0 ? `${streaks.current} day${streaks.current === 1 ? '' : 's'}` : '0 days',
      detail: `Best streak ${streaks.best} · last active ${streaks.lastActive || '—'}`,
    },
    platformSplit: {
      items: platformSplit,
      label: platformSplit[0] ? `${platformSplit[0].pct}% ${platformSplit[0].label}` : '—',
      detail: platformSplit.map((p) => `${p.label} ${p.pct}%`).join(' · ') || 'No platform data',
    },
    primeHours: {
      ...primeHours,
      label: primeHours.peakMs > 0 ? primeHours.peakLabel : '—',
      detail:
        primeHours.windowMs > 0
          ? `Best window ${primeHours.windowLabel} (${formatTime(primeHours.windowMs, true)})`
          : 'No hourly data yet',
    },
    resumeDebt: {
      count: resumeDebt.length,
      items: resumeDebt.slice(0, 12),
      label: String(resumeDebt.length),
      detail:
        resumeDebt.length > 0
          ? `${resumeDebt.length} episode${resumeDebt.length === 1 ? '' : 's'} left unfinished`
          : 'No unfinished episodes',
    },
    pace: {
      ratio: paceRatio,
      pct: pacePct,
      watchedMs: watchedAgainstRuntime,
      runtimeMs,
      label: pacePct != null ? `${pacePct}% of runtime` : '—',
      detail:
        pacePct != null
          ? `${formatTime(watchedAgainstRuntime, true)} watched vs ${formatTime(runtimeMs, true)} runtime`
          : 'Need episode duration from the player',
    },
    genreTags: {
      items: genreTags,
      untaggedShows,
      label: genreTags[0] ? genreTags[0].tag : untaggedShows ? 'Add tags' : '—',
      detail:
        genreTags.length > 0
          ? genreTags
              .slice(0, 4)
              .map((t) => `${t.tag} (${formatTime(t.ms, true)})`)
              .join(' · ')
          : `${untaggedShows} show${untaggedShows === 1 ? '' : 's'} untagged`,
    },
    rewatch: {
      count: rewatchCount,
      items: rewatchEpisodes.slice(0, 12),
      label: String(rewatchCount),
      detail:
        rewatchCount > 0
          ? `${rewatchCount} rewatch${rewatchCount === 1 ? '' : 'es'} logged`
          : rewatchEpisodes.length
            ? `${rewatchEpisodes.length} multi-session episodes`
            : 'No rewatches yet',
    },
    focusRatio: {
      pct: focusRatio,
      activeTime,
      pausedTime,
      estimate: focusIsEstimate,
      label: focusRatio != null ? `${focusRatio}%` : '—',
      detail: focusIsEstimate
        ? 'Playing-focused estimate — pause time improves as you watch more'
        : focusRatio != null
          ? `${formatTime(activeTime, true)} playing · ${formatTime(pausedTime, true)} paused`
          : 'Play something to measure focus',
    },
  };
}

/**
 * Build a daily totals map over N days for streak calculation.
 */
export function dailyTotalsFromRaw(rawData = {}, days = 90) {
  const keys = getDateRange(days);
  const daily = {};
  for (const key of keys) {
    const day = rawData[key];
    if (!day?.shows) continue;
    daily[key] = Object.values(day.shows).reduce(
      (sum, show) => sum + (show.totalTime || 0),
      0
    );
  }
  return daily;
}
