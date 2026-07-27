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
    badgeLabel: "LALIGA",
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
    key: "raiders",
    name: "Las Vegas Raiders",
    teamId: "13",
    logo: "assets/teams/raiders.webp",
    color: "#a5acaf",
    badgeTextColor: "#111111",
    competitions: [{ path: "football/nfl", name: "NFL" }],
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
    key: "kings",
    name: "Los Angeles Kings",
    teamId: "8",
    logo: "assets/teams/la.png",
    color: "#8b5cf6",
    badgeTextColor: "#ffffff",
    competitions: [{ path: "hockey/nhl", name: "NHL" }],
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

async function getSeasonStatus(team) {
  const primaryCompetition = team.competitions[0];
  try {
    const data = await fetchJson(`${BASE}/${primaryCompetition.path}/teams/${team.teamId}/schedule`);
    const seasonLabel = `${data.season?.name || ""} ${data.season?.displayName || ""}`.toLowerCase();
    if (seasonLabel.includes("off season") || seasonLabel.includes("preseason")) return "not-started";
    const now = new Date();
    const hasStarted = (data.events || []).some((e) => new Date(e.date) <= now);
    return hasStarted ? "started" : "not-started";
  } catch {
    return "not-started";
  }
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
  const sede = ev.isTeamHome ? "vs" : '<span class="away-marker">@</span>';
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
  const sede = ev.isTeamHome ? "vs" : '<span class="away-marker">@</span>';
  const rivalryTag = ev.rivalryLabel ? `<span class="rivalry-tag">★ ${ev.rivalryLabel}</span>` : "";
  const compTag = showCompetition ? `<span class="comp-tag">${ev.competitionName}</span>` : "";
  return `<div class="upcoming-row${ev.rivalryLabel ? " rivalry" : ""}">
    <span class="result-date">${fmtDate(ev.date)}</span>
    <span class="result-matchup">${sede} ${ev.rivalName} ${rivalryTag}${compTag}</span>
    <span class="upcoming-time">${ev.statusDetail}</span>
  </div>`;
}

async function gatherTeamData(team, order) {
  let resultados = "";
  let proximos = "";
  let standingsHtml = "";
  let lastUpdated = 0;
  let nextMatch = null;
  const showCompetition = team.competitions.length > 1;
  const rowLimit = showCompetition ? 8 : 5;

  try {
    const rawEvents = await getSchedule(team);
    const parsed = rawEvents.map((e) => parseEvent(e, team));
    const now = new Date();

    const finished = parsed
      .filter((e) => e.completed)
      .sort((a, b) => b.date - a.date)
      .slice(0, 5);

    lastUpdated = finished.length ? finished[0].date.getTime() : 0;
    const upcoming = parsed
      .filter((e) => !e.completed && e.date >= now)
      .sort((a, b) => a.date - b.date)
      .slice(0, rowLimit);

    nextMatch = upcoming.length ? upcoming[0] : null;

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

  const seasonStatus = await getSeasonStatus(team);

  try {
    const standing = await getStandingEntry(team);
    standingsHtml = standing
      ? `<div class="standing-row">
          <span class="rank-badge">${standing.rank}º</span>
          <span class="standing-detail">de ${standing.totalInGroup} en ${standing.groupName} (${standing.competitionName})</span>
        </div>`
      : `<p class="muted">Posicion no disponible.</p>`;
  } catch (err) {
    standingsHtml = `<p class="muted">No se pudo cargar (${err.message}).</p>`;
  }

  return { team, order, lastUpdated, nextMatch, seasonStatus, standingsHtml, resultados, proximos };
}

function renderTeamCard(data) {
  const { team, order, lastUpdated, nextMatch, seasonStatus, standingsHtml, resultados, proximos } = data;
  const countdownHtml = nextMatch
    ? `<span class="countdown" data-target="${nextMatch.date.getTime()}">Calculando...</span>`
    : `<span class="countdown no-match">Sin Anunciar</span>`;
  return `
  <section class="card" data-order="${order}" data-updated="${lastUpdated}" style="--team-color: ${team.color}; --team-badge-text: ${team.badgeTextColor}">
    <span class="status-dot ${seasonStatus}" title="${seasonStatus === "started" ? "Temporada en curso" : "Temporada aun no comienza"}"></span>
    <div class="card-header">
      <img class="logo" src="${team.logo}" alt="${team.name}" />
      <h2>${team.name}</h2>
      <span class="league">${team.badgeLabel || team.competitions.map((c) => c.name).join(" · ")}</span>
    </div>
    <h3>Tabla de posiciones</h3>
    ${standingsHtml}
    <h3>Ultimos resultados</h3>
    ${resultados}
    <h3>Proximos partidos</h3>
    ${proximos}
    ${countdownHtml}
  </section>`;
}

async function main() {
  const teamData = [];
  for (let i = 0; i < TEAMS.length; i++) {
    teamData.push(await gatherTeamData(TEAMS[i], i));
  }

  let nextUp = null;
  for (const d of teamData) {
    if (d.nextMatch && (!nextUp || d.nextMatch.date < nextUp.match.date)) {
      nextUp = { team: d.team, match: d.nextMatch };
    }
  }
  const tickerHtml = nextUp
    ? (() => {
        const msg = `Proximo partido: <strong>${nextUp.team.name}</strong> vs <strong>${nextUp.match.rivalName}</strong> &mdash; ${nextUp.match.statusDetail}`;
        const repeated = Array.from({ length: 10 }, () => msg).join(" &nbsp;•&nbsp; ");
        return `<div class="ticker"><div class="ticker-track"><span class="ticker-copy">${repeated} &nbsp;•&nbsp; </span><span class="ticker-copy">${repeated} &nbsp;•&nbsp; </span></div></div>`;
      })()
    : "";

  const cards = teamData.map((d) => renderTeamCard(d));

  const now = new Date();
  const updatedAtTs = now.getTime();

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>STRICKE OUT | SPORTS DASHBOARD</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Anton&display=swap" rel="stylesheet" />
<style>
  :root {
    color-scheme: dark;
    --bg: #050505;
    --card-bg: rgba(0,0,0,0.5);
    --card-border: rgba(255,255,255,0.1);
    --text: #f0f0f2;
    --muted: #8b8d94;
    --win: #22c55e;
    --loss: #ef4444;
    --draw: #eab308;
  }
  * { box-sizing: border-box; }
  html { background: var(--bg); -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
  body {
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    margin: 0; padding: 0 1rem 4rem; color: var(--text);
    background-color: var(--bg);
    background-image:
      repeating-linear-gradient(135deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 1px, transparent 1px, transparent 14px);
    background-attachment: fixed;
    min-height: 100vh;
  }
  .ticker {
    overflow: hidden; white-space: nowrap; background: rgba(0,0,0,0.5);
    border-bottom: 1px solid var(--card-border); padding: .55rem 0; margin: 0 -1rem 0;
  }
  .ticker-track {
    display: flex; width: max-content;
    animation: ticker-scroll 60s linear infinite;
  }
  .ticker-copy {
    font-size: .85rem; font-weight: 600; color: var(--text);
  }
  .ticker-track strong { color: #fff; }
  @keyframes ticker-scroll {
    from { transform: translateX(0); }
    to { transform: translateX(-50%); }
  }
  h1 { text-align: center; margin: 3rem 0 .4rem; line-height: 1; }
  .brand {
    display: inline-block; font-family: "Anton", "Arial Black", sans-serif; transform: skewX(-8deg);
    font-size: clamp(2.75rem, 11vw, 5rem);
  }
  .brand-main {
    display: block; letter-spacing: .05em; margin-bottom: .18em;
  }
  .brand-main .solid { color: #ffffff; }
  .brand-main .hollow {
    color: transparent; -webkit-text-stroke: 0.5px #ffffff; text-stroke: 0.5px #ffffff;
  }
  .brand-sub {
    display: block; font-size: .2em; letter-spacing: .35em;
    color: #fff; padding-left: .35em;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; font-weight: 500;
  }
  .updated { text-align: center; color: var(--muted); font-size: .85rem; margin: .35rem 0 1.25rem; }
  .sort-bar { display: flex; justify-content: center; gap: .5rem; margin-bottom: 2rem; }
  .sort-btn {
    font-family: inherit; font-size: .8rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
    color: var(--muted); background: rgba(255,255,255,0.05); border: 1px solid var(--card-border);
    border-radius: 999px; padding: .4rem 1.1rem; cursor: pointer;
  }
  .sort-btn.active { color: #0a0a0b; background: #ffffff; border-color: #ffffff; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.25rem; max-width: 1200px; margin: 0 auto; }
  .card {
    position: relative;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-top: 5px solid var(--team-color);
    border-radius: 12px;
    padding: 1.5rem;
  }
  .status-dot {
    position: absolute; top: .9rem; right: .9rem; width: 12px; height: 12px; border-radius: 50%;
  }
  .status-dot.started { background: var(--win); animation: pulse-started 1.6s infinite; }
  .status-dot.not-started { background: var(--loss); animation: pulse-not-started 1.6s infinite; }
  @keyframes pulse-started {
    0% { box-shadow: 0 0 0 0 rgba(34,197,94,0.65); }
    70% { box-shadow: 0 0 0 9px rgba(34,197,94,0); }
    100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
  }
  @keyframes pulse-not-started {
    0% { box-shadow: 0 0 0 0 rgba(239,68,68,0.65); }
    70% { box-shadow: 0 0 0 9px rgba(239,68,68,0); }
    100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
  }
  .card-header { display: flex; flex-direction: column; align-items: center; text-align: center; margin-bottom: 1.25rem; }
  .logo { width: 88px; height: 88px; object-fit: contain; margin-bottom: .6rem; }
  .card-header h2 { margin: 0; font-size: 1.25rem; font-weight: 800; }
  .league { margin-top: .35rem; font-size: .7rem; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); border: 1px solid currentColor; border-radius: 999px; padding: .15rem .6rem; text-align: center; }
  .countdown {
    display: block; width: fit-content; margin: 1.1rem auto 0; font-size: .75rem; font-weight: 700; letter-spacing: .03em;
    color: var(--team-badge-text); background: var(--team-color); border-radius: 999px; padding: .3rem .9rem;
  }
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
  .away-marker { color: #ffffff; font-weight: 800; }
  .comp-tag {
    font-size: .68rem; font-weight: 600; text-transform: uppercase; letter-spacing: .03em;
    color: var(--muted); background: rgba(255,255,255,0.08); border-radius: 4px;
    padding: .05rem .4rem; margin-left: .35rem;
  }
  @media (max-width: 480px) {
    h1 { padding: 0 .75rem; }
    .ticker-track { animation-duration: 110s; }
  }
</style>
</head>
<body>
  ${tickerHtml}
  <h1>
    <span class="brand">
      <span class="brand-main"><span class="solid">ST</span><span class="hollow">RICK</span><span class="solid">EOUT</span></span>
      <span class="brand-sub">SPORTS DASHBOARD</span>
    </span>
  </h1>
  <p class="updated" id="updatedAt" data-ts="${updatedAtTs}">Actualizado: ...</p>
  <div class="sort-bar">
    <button class="sort-btn active" data-sort="deporte">Deporte</button>
    <button class="sort-btn" data-sort="reciente">Más reciente</button>
  </div>
  <div class="grid" id="grid">
    ${cards.join("\n")}
  </div>
  <script>
    (function () {
      var el = document.getElementById("updatedAt");
      var ts = Number(el.dataset.ts);
      var formatted = new Date(ts).toLocaleString("es-MX", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
      });
      el.textContent = "Actualizado: " + formatted;
    })();
  </script>
  <script>
    (function () {
      var els = document.querySelectorAll(".countdown");
      if (!els.length) return;
      function update() {
        els.forEach(function (el) {
          if (!el.dataset.target) return;
          var diff = Number(el.dataset.target) - Date.now();
          if (diff <= 0) {
            el.textContent = "¡Es hoy!";
            return;
          }
          var days = Math.floor(diff / 86400000);
          var hours = Math.floor((diff % 86400000) / 3600000);
          el.textContent = "Faltan " + days + "d " + hours + "h";
        });
      }
      update();
      setInterval(update, 60000);
    })();
  </script>
  <script>
    (function () {
      var grid = document.getElementById("grid");
      var buttons = document.querySelectorAll(".sort-btn");
      function sortBy(mode) {
        var items = Array.prototype.slice.call(grid.children);
        items.sort(function (a, b) {
          if (mode === "reciente") {
            return Number(b.dataset.updated) - Number(a.dataset.updated);
          }
          return Number(a.dataset.order) - Number(b.dataset.order);
        });
        items.forEach(function (item) { grid.appendChild(item); });
      }
      buttons.forEach(function (btn) {
        btn.addEventListener("click", function () {
          buttons.forEach(function (b) { b.classList.remove("active"); });
          btn.classList.add("active");
          sortBy(btn.dataset.sort);
        });
      });
    })();
  </script>
</body>
</html>`;

  const fs = await import("node:fs/promises");
  await fs.mkdir("docs", { recursive: true });
  await fs.writeFile("docs/index.html", html, "utf8");
  await fs.cp("assets/teams", "docs/assets/teams", { recursive: true });
  console.log("docs/index.html y assets generados.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
