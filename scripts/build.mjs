// Genera docs/index.html con resultados, calendario y posiciones de los equipos favoritos.
// Fuente de datos: API publica de ESPN (site.api.espn.com), no requiere API key.

const TEAMS = [
  {
    key: "real-madrid",
    name: "Real Madrid",
    teamId: "86",
    logo: "assets/teams/real-madrid.webp",
    color: "#ffffff",
    badgeTextColor: "#111111",
    competitions: [
      { path: "soccer/esp.1", name: "LaLiga" },
      { path: "soccer/uefa.champions", name: "Champions League" },
      { path: "soccer/esp.copa_del_rey", name: "Copa del Rey" },
      { path: "soccer/esp.super_cup", name: "Supercopa de España" },
    ],
    rivals: [
      { match: "barcelona", label: "Clásico" },
      { match: "atletico madrid", label: "Derbi" },
      { match: "atletico de madrid", label: "Derbi" },
    ],
  },
  {
    key: "santos-laguna",
    name: "Santos Laguna",
    teamId: "225",
    logo: "assets/teams/santos.png",
    color: "#0f9d58",
    badgeTextColor: "#ffffff",
    competitions: [{ path: "soccer/mex.1", name: "Liga MX" }],
  },
  {
    key: "cubs",
    name: "Chicago Cubs",
    teamId: "16",
    logo: "assets/teams/cubs.webp",
    color: "#0e3386",
    badgeTextColor: "#ffffff",
    competitions: [{ path: "baseball/mlb", name: "MLB" }],
  },
  {
    key: "bulls",
    name: "Chicago Bulls",
    teamId: "4",
    logo: "assets/teams/bulls.png",
    color: "#ce1141",
    badgeTextColor: "#ffffff",
    competitions: [{ path: "basketball/nba", name: "NBA" }],
  },
  {
    key: "raiders",
    name: "Las Vegas Raiders",
    teamId: "13",
    logo: "assets/teams/raiders.webp",
    color: "#a5acaf",
    badgeTextColor: "#111111",
    competitions: [{ path: "football/nfl", name: "NFL" }],
  },
];

const BASE = "https://site.api.espn.com/apis/site/v2/sports";
const STANDINGS_BASE = "https://site.api.espn.com/apis/v2/sports";

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res.json();
}

function normalize(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

async function getSchedule(team) {
  // Se combinan temporada actual + anterior de cada competicion: entre temporadas,
  // la actual solo trae partidos futuros y la anterior aporta los ultimos resultados terminados.
  const previousYear = new Date().getUTCFullYear() - 1;
  const requests = [];
  for (const comp of team.competitions) {
    requests.push({ comp, url: `${BASE}/${comp.path}/teams/${team.teamId}/schedule` });
    requests.push({ comp, url: `${BASE}/${comp.path}/teams/${team.teamId}/schedule?season=${previousYear}` });
  }
  const results = await Promise.allSettled(requests.map((r) => fetchJson(r.url)));
  const eventsById = new Map();
  results.forEach((result, i) => {
    if (result.status !== "fulfilled") return;
    const competitionName = requests[i].comp.name;
    for (const event of result.value.events || []) {
      eventsById.set(event.id, { event, competitionName });
    }
  });
  return [...eventsById.values()];
}

function findRivalry(team, rivalName) {
  if (!team.rivals) return null;
  const normalizedRival = normalize(rivalName);
  const rivalry = team.rivals.find((r) => normalizedRival.includes(normalize(r.match)));
  return rivalry ? rivalry.label : null;
}

function parseEvent({ event, competitionName }, team) {
  const comp = event.competitions[0];
  const competitors = comp.competitors;
  const self = competitors.find((c) => String(c.team.id) === String(team.teamId));
  const rival = competitors.find((c) => String(c.team.id) !== String(team.teamId));
  const completed = !!comp.status?.type?.completed;

  let result = null;
  if (completed) {
    if (self?.winner === true) result = "win";
    else if (rival?.winner === true) result = "loss";
    else result = "draw";
  }

  const rivalName = rival?.team?.displayName || "?";

  return {
    date: new Date(event.date),
    completed,
    statusDetail: comp.status?.type?.shortDetail || comp.status?.type?.description || "",
    isTeamHome: self?.homeAway === "home",
    rivalName,
    teamScore: self?.score?.displayValue ?? "",
    rivalScore: rival?.score?.displayValue ?? "",
    result,
    competitionName,
    rivalryLabel: findRivalry(team, rivalName),
  };
}

async function getStandingEntry(team) {
  const primaryCompetition = team.competitions[0];
  const data = await fetchJson(`${STANDINGS_BASE}/${primaryCompetition.path}/standings`);
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
        competitionName: primaryCompetition.name,
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

function renderResultRow(ev, showCompetition) {
  const sede = ev.isTeamHome ? "vs" : "@";
  const rivalryTag = ev.rivalryLabel ? `<span class="rivalry-tag">★ ${ev.rivalryLabel}</span>` : "";
  const compTag = showCompetition ? `<span class="comp-tag">${ev.competitionName}</span>` : "";
  return `<div class="result-row ${ev.result}${ev.rivalryLabel ? " rivalry" : ""}">
    <span class="result-badge">${RESULT_LABEL[ev.result]}</span>
    <span class="result-date">${fmtDate(ev.date)}</span>
    <span class="result-matchup">${sede} ${ev.rivalName} ${rivalryTag}${compTag}</span>
    <span class="result-score">${ev.teamScore}&ndash;${ev.rivalScore}</span>
  </div>`;
}

function renderUpcomingRow(ev, showCompetition) {
  const sede = ev.isTeamHome ? "vs" : "@";
  const rivalryTag = ev.rivalryLabel ? `<span class="rivalry-tag">★ ${ev.rivalryLabel}</span>` : "";
  const compTag = showCompetition ? `<span class="comp-tag">${ev.competitionName}</span>` : "";
  return `<div class="upcoming-row${ev.rivalryLabel ? " rivalry" : ""}">
    <span class="result-date">${fmtDate(ev.date)}</span>
    <span class="result-matchup">${sede} ${ev.rivalName} ${rivalryTag}${compTag}</span>
    <span class="upcoming-time">${ev.statusDetail}</span>
  </div>`;
}

async function buildTeamCard(team) {
  let resultados = "";
  let proximos = "";
  let standingsHtml = "";
  const showCompetition = team.competitions.length > 1;
  const rowLimit = showCompetition ? 8 : 5;

  try {
    const rawEvents = await getSchedule(team);
    const parsed = rawEvents.map((e) => parseEvent(e, team));
    const now = new Date();

    const finished = parsed
      .filter((e) => e.completed)
      .sort((a, b) => b.date - a.date)
      .slice(0, rowLimit);
    const upcoming = parsed
      .filter((e) => !e.completed && e.date >= now)
      .sort((a, b) => a.date - b.date)
      .slice(0, rowLimit);

    resultados = finished.length
      ? finished.map((e) => renderResultRow(e, showCompetition)).join("")
      : `<p class="muted">Sin resultados recientes disponibles.</p>`;

    proximos = upcoming.length
      ? upcoming.map((e) => renderUpcomingRow(e, showCompetition)).join("")
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
          <span class="standing-detail">de ${standing.totalInGroup} en ${standing.groupName} (${standing.competitionName})<br>Record: <strong>${standing.record}</strong>${standing.winPercent ? ` &middot; ${standing.winPercent}` : ""}</span>
        </div>`
      : `<p class="muted">Posicion no disponible.</p>`;
  } catch (err) {
    standingsHtml = `<p class="muted">No se pudo cargar (${err.message}).</p>`;
  }

  return `
  <section class="card" style="--team-color: ${team.color}; --team-badge-text: ${team.badgeTextColor}">
    <div class="card-header">
      <img class="logo" src="${team.logo}" alt="${team.name}" />
      <h2>${team.name}</h2>
      <span class="league">${team.competitions.map((c) => c.name).join(" · ")}</span>
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

  const now = new Date();
  const updatedAt = now.toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sports Dashboard</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0a0a0b;
    --card-bg: #1a1a1d;
    --card-border: rgba(255,255,255,0.1);
    --text: #f0f0f2;
    --muted: #8b8d94;
    --win: #22c55e;
    --loss: #ef4444;
    --draw: #eab308;
  }
  * { box-sizing: border-box; }
  html { background: var(--bg); }
  body {
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    margin: 0; padding: 2rem 1rem 4rem; color: var(--text);
    background-color: var(--bg);
    background-image:
      radial-gradient(ellipse 900px 500px at 50% -10%, rgba(59,130,246,0.16) 0%, transparent 65%),
      repeating-linear-gradient(135deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 1px, transparent 1px, transparent 14px),
      radial-gradient(circle at 50% 100%, rgba(0,0,0,0.5) 0%, transparent 60%);
    background-attachment: fixed;
    min-height: 100vh;
  }
  h1 {
    text-align: center; margin: 0 0 .4rem; text-transform: uppercase; letter-spacing: .12em; font-size: 1.9rem;
    font-weight: 900; background: linear-gradient(135deg, #fff, #9ca3af);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  h1::after {
    content: ""; display: block; width: 64px; height: 4px; margin: .6rem auto 0;
    background: linear-gradient(90deg, #3b82f6, #eab308, #ef4444); border-radius: 999px;
  }
  .updated { text-align: center; color: var(--muted); font-size: .85rem; margin: .9rem 0 2.5rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.25rem; max-width: 1200px; margin: 0 auto; }
  .card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-top: 5px solid var(--team-color);
    border-radius: 12px;
    padding: 1.5rem;
    box-shadow: 0 14px 32px -18px var(--team-color), 0 4px 12px rgba(0,0,0,0.5);
  }
  .card-header { display: flex; flex-direction: column; align-items: center; text-align: center; margin-bottom: 1.25rem; }
  .logo { width: 88px; height: 88px; object-fit: contain; margin-bottom: .6rem; }
  .card-header h2 { margin: 0; font-size: 1.25rem; font-weight: 800; }
  .league { margin-top: .35rem; font-size: .7rem; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); border: 1px solid currentColor; border-radius: 999px; padding: .15rem .6rem; text-align: center; }
  .card h3 { font-size: .75rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 1.1rem 0 .5rem; font-weight: 700; }
  .muted { color: var(--muted); font-size: .9rem; margin: 0; }

  .standing-row { display: flex; align-items: center; gap: .75rem; }
  .rank-badge {
    flex: none; display: flex; align-items: center; justify-content: center;
    width: 2.5rem; height: 2.5rem; border-radius: 50%;
    background: var(--team-color); color: var(--team-badge-text); font-weight: 800; font-size: .95rem;
  }
  .standing-detail { font-size: .85rem; line-height: 1.4; }

  .result-row, .upcoming-row {
    display: flex; align-items: center; gap: .6rem; flex-wrap: wrap;
    padding: .4rem .5rem; margin-bottom: .3rem;
    border-radius: 6px; font-size: .85rem;
    background: rgba(255,255,255,0.04);
    border-left: 4px solid transparent;
  }
  .result-row.win { border-left-color: var(--win); }
  .result-row.loss { border-left-color: var(--loss); }
  .result-row.draw { border-left-color: var(--draw); }
  .result-row.rivalry, .upcoming-row.rivalry { background: rgba(234,179,8,0.12); }
  .result-badge {
    flex: none; width: 1.5rem; height: 1.5rem; border-radius: 4px;
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: .75rem; color: #fff;
  }
  .win .result-badge { background: var(--win); }
  .loss .result-badge { background: var(--loss); }
  .draw .result-badge { background: var(--draw); }
  .result-date { flex: none; color: var(--muted); width: 5.5rem; }
  .result-matchup { flex: 1; font-weight: 600; }
  .result-score { flex: none; font-weight: 800; font-variant-numeric: tabular-nums; }
  .upcoming-row .result-date { width: 5.5rem; }
  .upcoming-time { flex: none; color: var(--muted); font-size: .78rem; }
  .rivalry-tag { color: #eab308; font-weight: 700; font-size: .75rem; margin-left: .35rem; }
  .comp-tag {
    font-size: .68rem; font-weight: 600; text-transform: uppercase; letter-spacing: .03em;
    color: var(--muted); background: rgba(255,255,255,0.08); border-radius: 4px;
    padding: .05rem .4rem; margin-left: .35rem;
  }
</style>
</head>
<body>
  <h1>Sports Dashboard</h1>
  <p class="updated">Actualizado: ${updatedAt}</p>
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
