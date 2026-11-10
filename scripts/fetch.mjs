// Pulls league data from Sleeper's public API and writes site/data/league.json.
// No API key needed. Run with: node scripts/fetch.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(await fs.readFile(path.join(root, 'config.json'), 'utf8'));
const BASE = 'https://api.sleeper.app/v1';

async function get(p, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(BASE + p, { headers: { 'user-agent': 'yellowstone-ffl-site' } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${p}`);
      return await res.json();
    } catch (e) {
      err = e;
      await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw err;
}

const state = await get('/state/nfl');
const league = await get(`/league/${cfg.leagueId}`);
const users = await get(`/league/${cfg.leagueId}/users`);
const rosters = await get(`/league/${cfg.leagueId}/rosters`);

const regularEnd = Math.max(1, (league.settings?.playoff_week_start || 15) - 1);
const lastWeekToFetch = Math.min(regularEnd, state.season_type === 'regular' ? state.week : regularEnd);
const userById = Object.fromEntries(users.map(u => [u.user_id, u]));

const teams = rosters.map(r => {
  const u = userById[r.owner_id] || {};
  return {
    rosterId: r.roster_id,
    userId: r.owner_id,
    name: u.display_name || `Team ${r.roster_id}`,
    teamName: u.metadata?.team_name || null,
    official: { w: r.settings.wins, l: r.settings.losses, t: r.settings.ties || 0 },
  };
}).sort((a, b) => a.rosterId - b.rosterId);


const seen = new Set();
const weeks = [];
for (let w = 1; w <= lastWeekToFetch; w++) {
  const ms = await get(`/league/${cfg.leagueId}/matchups/${w}`);
  const byId = new Map();
  for (const m of ms) {
    if (m.matchup_id == null) continue; // bye / unscheduled
    const pp = m.players_points || {};
    const starters = (m.starters || [])
      .filter(id => id && id !== '0')
      .map(id => { seen.add(id); return { id, pts: pp[id] ?? 0 }; });
    if (!byId.has(m.matchup_id)) byId.set(m.matchup_id, []);
    byId.get(m.matchup_id).push({ rid: m.roster_id, pts: m.points ?? 0, starters });
  }
  const matchups = [...byId.entries()].map(([id, tms]) => ({ id, teams: tms }));
  const allTeams = matchups.flatMap(m => m.teams);
  const allScored = allTeams.length > 0 && allTeams.every(t => t.pts > 0);
  const over = state.season_type === 'post' || state.season_type === 'off' || w < state.week;
  weeks.push({ week: w, complete: allScored && over, matchups });
}

// Player lookup (large response, so keep only players that appear in a lineup).
const all = await get('/players/nfl');
const players = {};
for (const id of seen) {
  const p = all[id];
  if (!p) { players[id] = { n: id, p: '?', t: null }; continue; }
  players[id] = {
    n: p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || id,
    p: p.position || '?',
    t: p.team || null,
  };
}

const out = {
  generatedAt: new Date().toISOString(),
  league: {
    id: cfg.leagueId,
    name: league.name,
    season: league.season,
    status: league.status,
    rosters: league.total_rosters,
    regularSeasonEnd: regularEnd,
    currentWeek: state.week,
    seasonType: state.season_type,
  },
  teams,
  weeks,
  players,
};

const dest = path.join(root, 'site', 'data', 'league.json');
await fs.mkdir(path.dirname(dest), { recursive: true });
const done = weeks.filter(w => w.complete).map(w => w.week);

// Keep the existing file (and its timestamp) when nothing but the timestamp changed,
// so scheduled runs don't create empty commits.
let unchanged = false;
try {
  const prev = JSON.parse(await fs.readFile(dest, 'utf8'));
  const strip = o => JSON.stringify({ ...o, generatedAt: null });
  unchanged = strip(prev) === strip(out);
} catch { /* first run */ }

if (unchanged) {
  console.log('No changes in league data; leaving site/data/league.json as is.');
} else {
  await fs.writeFile(dest, JSON.stringify(out));
  console.log(`Wrote ${path.relative(root, dest)}: ${teams.length} teams, completed weeks [${done.join(', ')}], ${Object.keys(players).length} players`);
}
