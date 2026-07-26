// Genera docs/index.html con resultados, calendario y posiciones de los equipos favoritos.
// Fuente de datos: API publica de ESPN (site.api.espn.com), no requiere API key.

const TEAMS = [
  { key: "real-madrid", name: "Real Madrid", sportPath: "soccer/esp.1", leagueName: "LaLiga", teamId: "86", logo: "assets/teams/real-madrid.webp" },
  { key: "santos-laguna", name: "Santos Laguna", sportPath: "soccer/mex.1", leagueName: "Liga MX", teamId: "225", logo: "assets/teams/santos.png" },
  { key: "cubs", name: "Chicago Cubs", sportPath: "baseball/mlb", leagueName: "MLB", teamId: "16", logo: "assets/teams/cubs.webp" },
  { key: "bulls", name: "Chicago Bulls", sportPath: "basketball/nba", leagueName: "NBA", teamId: "4", logo: "assets/teams/bulls.png" },
  { key: "raiders", name: "Las Vegas Raiders", sportPath: "football/nfl", leagueName: "NFL", teamId: "13", logo: "assets/teams/raiders.webp" },
];

const BASE = "https://site.api.espn.com/apis/site/v2/sports";
const STANDINGS_BASE = "https://site.api.espn.com/apis/v2/sports";

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res.json();
}

async function getSchedule(team) {
  // Se combinan temporada actual + anterior: entre temporadas, la actual solo trae
  // partidos futuros y la anterior aporta los ultimos resultados terminados.
  const previousYear = new Date().getUTCFullYear() - 1;
  const urls = [
    `${BASE}/${team.sportPath}/teams/${team.teamId}/schedule`,
    `${BASE}/${team.sportPath}/teams/${team.teamId}/schedule?season=${previousYear}`,
  ];
  const results = await Promise.allSettled(urls.map(fetchJson));
  const eventsById = new Map();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const event of result.value.events || []) {
      eventsById.set(event.id, event);
    }
  }
  return [...eventsById.values()];
}

function parseEvent(event, teamId) {
  const comp = event.competitions[0];
  const competitors = comp.competitors;
  const self = competitors.find((c) => String(c.team.id) === String(teamId));
  const rival = competitors.find((c) => String(c.team.id) !== String(teamId));
  const completed = !!comp.status?.type?.completed;

  let result = null;
  if (completed) {
    if (self?.winner === true) result = "win";
    else if (rival?.winner === true) result = "loss";
    else result = "draw";
  }

  return {
    date: new Date(event.date),
    completed,
    statusDetail: comp.status?.type?.shortDetail || comp.status?.type?.description || "",
    isTeamHome: self?.homeAway === "home",
    teamName: self?.team?.displayName || "?",
    rivalName: rival?.team?.displayName || "?",
    teamScore: self?.score?.displayValue ?? "",
    rivalScore: rival?.score?.displayValue ?? "",
    result,
  };
}

async function getStandingEntry(team) {
  const data = await fetchJson(`${STANDINGS_BASE}/${team.sportPath}/standings`);
  const groups = data.children && data.children.length ? data.children : [{ name: data.name, standings: data.standings }];
  for (const group of groups) {
    const entries = group.standings?.entries || [];
    const idx = entries.findIndex((e) => String(e.team.id) === String(team.teamId));
    if (idx !== -1) {
      const entry = entries[idx];
      const statByName = (name) => entry.stats.find((s) => s.name === name)?.displayValue;
      const overall = entry.stats.find((s) => s.type === "total")?.displayValue;
      return {
        groupName: group.name || group.abbreviation || "",
        rank: idx + 1,
        totalInGroup: entries.length,
        record: overall || `${statByName("wins") ?? "-"}-${statByName("losses") ?? "-"}`,
        winPercent: statByName("winPercent"),
      };
    }
  }
  return null;
}

function fmtDate(d) {
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

const RESULT_LABEL = { win: "V", loss: "D", draw: "E" };

function renderResultRow(ev) {
  const sede = ev.isTeamHome ? "vs" : "@";
  return `<div class="result-row ${ev.result}">
    <span class="result-badge">${RESULT_LABEL[ev.result]}</span>
    <span class="result-date">${fmtDate(ev.date)}</span>
    <span class="result-matchup">${sede} ${ev.rivalName}</span>
    <span class="result-score">${ev.teamScore}&ndash;${ev.rivalScore}</span>
  </div>`;
}

function renderUpcomingRow(ev) {
  const sede = ev.isTeamHome ? "vs" : "@";
  return `<div class="upcoming-row">
    <span class="result-date">${fmtDate(ev.date)}</span>
    <span class="result-matchup">${sede} ${ev.rivalName}</span>
    <span class="upcoming-time">${ev.statusDetail}</span>
  </div>`;
}

async function buildTeamCard(team) {
  let resultados = "";
  let proximos = "";
  let standingsHtml = "";

  try {
    const events = await getSchedule(team);
    const parsed = events.map((e) => parseEvent(e, team.teamId));
    const now = new Date();

    const finished = parsed
      .filter((e) => e.completed)
      .sort((a, b) => b.date - a.date)
      .slice(0, 5);
    const upcoming = parsed
      .filter((e) => !e.completed && e.date >= now)
      .sort((a, b) => a.date - b.date)
      .slice(0, 5);

    resultados = finished.length
      ? finished.map(renderResultRow).join("")
      : `<p class="muted">Sin resultados recientes disponibles.</p>`;

    proximos = upcoming.length
      ? upcoming.map(renderUpcomingRow).join("")
      : `<p class="muted">Calendario aun no publicado.</p>`;
  } catch (err) {
    resultados = `<p class="muted">No se pudo cargar (${err.message}).</p>`;
    proximos = `<p class="muted">No se pudo cargar.</p>`;
  }

  try {
    const standing = await getStandingEntry(team);
    standingsHtml = standing
      ? `<div class="standing-row">
          <span class="rank-badge">${standing.rank}º</span>
          <span class="standing-detail">de ${standing.totalInGroup} en ${standing.groupName}<br>Record: <strong>${standing.record}</strong>${standing.winPercent ? ` &middot; ${standing.winPercent}` : ""}</span>
        </div>`
      : `<p class="muted">Posicion no disponible.</p>`;
  } catch (err) {
    standingsHtml = `<p class="muted">No se pudo cargar (${err.message}).</p>`;
  }

  return `
  <section class="card">
    <div class="card-header">
      <img class="logo" src="${team.logo}" alt="${team.name}" />
      <h2>${team.name}</h2>
      <span class="league">${team.leagueName}</span>
    </div>
    <h3>Tabla de posiciones</h3>
    ${standingsHtml}
    <h3>Ultimos resultados</h3>
    ${resultados}
    <h3>Proximos partidos</h3>
    ${proximos}
  </section>`;
}

async function main() {
  const cards = [];
  for (const team of TEAMS) {
    cards.push(await buildTeamCard(team));
  }

  const updatedAt = new Date().toISOString();

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Mis equipos favoritos</title>
<style>
  :root {
    color-scheme: light dark;
    --win: #22c55e;
    --loss: #ef4444;
    --draw: #eab308;
  }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 2rem 1rem; background: #0b1220; color: #e7ecf3; }
  @media (prefers-color-scheme: light) { body { background: #f5f7fa; color: #111; } }
  h1 { text-align: center; margin-bottom: .25rem; text-transform: uppercase; letter-spacing: .06em; font-size: 1.6rem; }
  .updated { text-align: center; color: #8892a6; font-size: .85rem; margin-bottom: 2rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.25rem; max-width: 1200px; margin: 0 auto; }
  .card {
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.12);
    border-top: 4px solid #3b82f6;
    border-radius: 12px;
    padding: 1.5rem;
  }
  @media (prefers-color-scheme: light) { .card { background: #fff; border-color: #e2e5ea; border-top-color: #3b82f6; box-shadow: 0 1px 3px rgba(0,0,0,.06); } }
  .card-header { display: flex; flex-direction: column; align-items: center; text-align: center; margin-bottom: 1.25rem; }
  .logo { width: 88px; height: 88px; object-fit: contain; margin-bottom: .6rem; }
  .card-header h2 { margin: 0; font-size: 1.25rem; font-weight: 800; }
  .league { margin-top: .35rem; font-size: .7rem; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: #8892a6; border: 1px solid currentColor; border-radius: 999px; padding: .15rem .6rem; }
  .card h3 { font-size: .75rem; text-transform: uppercase; letter-spacing: .06em; color: #8892a6; margin: 1.1rem 0 .5rem; font-weight: 700; }
  .muted { color: #8892a6; font-size: .9rem; margin: 0; }

  .standing-row { display: flex; align-items: center; gap: .75rem; }
  .rank-badge {
    flex: none; display: flex; align-items: center; justify-content: center;
    width: 2.5rem; height: 2.5rem; border-radius: 50%;
    background: #3b82f6; color: #fff; font-weight: 800; font-size: .95rem;
  }
  .standing-detail { font-size: .85rem; line-height: 1.4; }

  .result-row, .upcoming-row {
    display: flex; align-items: center; gap: .6rem;
    padding: .4rem .5rem; margin-bottom: .3rem;
    border-radius: 6px; font-size: .85rem;
    background: rgba(255,255,255,0.04);
    border-left: 4px solid transparent;
  }
  @media (prefers-color-scheme: light) { .result-row, .upcoming-row { background: #f5f7fa; } }
  .result-row.win { border-left-color: var(--win); }
  .result-row.loss { border-left-color: var(--loss); }
  .result-row.draw { border-left-color: var(--draw); }
  .result-badge {
    flex: none; width: 1.5rem; height: 1.5rem; border-radius: 4px;
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: .75rem; color: #fff;
  }
  .win .result-badge { background: var(--win); }
  .loss .result-badge { background: var(--loss); }
  .draw .result-badge { background: var(--draw); }
  .result-date { flex: none; color: #8892a6; width: 5.5rem; }
  .result-matchup { flex: 1; font-weight: 600; }
  .result-score { flex: none; font-weight: 800; font-variant-numeric: tabular-nums; }
  .upcoming-row .result-date { width: 5.5rem; }
  .upcoming-time { flex: none; color: #8892a6; font-size: .78rem; }
</style>
</head>
<body>
  <h1>Mis equipos favoritos</h1>
  <p class="updated">Actualizado: ${updatedAt} UTC</p>
  <div class="grid">
    ${cards.join("\n")}
  </div>
</body>
</html>`;

  const fs = await import("node:fs/promises");
  await fs.mkdir("docs", { recursive: true });
  await fs.writeFile("docs/index.html", html, "utf8");
  await fs.cp("assets/teams", "docs/assets/teams", { recursive: true });
  console.log("docs/index.html y docs/assets/teams generados.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
