// Genera docs/index.html con resultados, calendario y posiciones de los equipos favoritos.
// Fuente de datos: API publica de ESPN (site.api.espn.com), no requiere API key.

const TEAMS = [
  { key: "real-madrid", name: "Real Madrid", emoji: "⚽", sportPath: "soccer/esp.1", leagueName: "LaLiga", teamId: "86" },
  { key: "santos-laguna", name: "Santos Laguna", emoji: "⚽", sportPath: "soccer/mex.1", leagueName: "Liga MX", teamId: "225" },
  { key: "cubs", name: "Chicago Cubs", emoji: "⚾", sportPath: "baseball/mlb", leagueName: "MLB", teamId: "chc" },
  { key: "bulls", name: "Chicago Bulls", emoji: "🏀", sportPath: "basketball/nba", leagueName: "NBA", teamId: "chi" },
  { key: "raiders", name: "Las Vegas Raiders", emoji: "🏈", sportPath: "football/nfl", leagueName: "NFL", teamId: "lv" },
];

const BASE = "https://site.api.espn.com/apis/site/v2/sports";
const STANDINGS_BASE = "https://site.api.espn.com/apis/v2/sports";

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res.json();
}

async function getSchedule(team) {
  let data = await fetchJson(`${BASE}/${team.sportPath}/teams/${team.teamId}/schedule`);
  if (!data.events || data.events.length === 0) {
    const fallbackYear = new Date().getUTCFullYear() - 1;
    data = await fetchJson(`${BASE}/${team.sportPath}/teams/${team.teamId}/schedule?season=${fallbackYear}`);
  }
  return data.events || [];
}

function parseEvent(event, teamId) {
  const comp = event.competitions[0];
  const home = comp.competitors.find((c) => c.homeAway === "home");
  const away = comp.competitors.find((c) => c.homeAway === "away");
  return {
    date: new Date(event.date),
    completed: !!comp.status?.type?.completed,
    statusDetail: comp.status?.type?.shortDetail || comp.status?.type?.description || "",
    homeName: home?.team?.displayName || "?",
    awayName: away?.team?.displayName || "?",
    homeScore: home?.score?.displayValue ?? "",
    awayScore: away?.score?.displayValue ?? "",
    isTeamHome: String(home?.team?.id) === String(teamId),
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

function renderResultRow(ev) {
  const teamLeft = ev.isTeamHome ? ev.homeName : ev.awayName;
  const teamRight = ev.isTeamHome ? ev.awayName : ev.homeName;
  const scoreLeft = ev.isTeamHome ? ev.homeScore : ev.awayScore;
  const scoreRight = ev.isTeamHome ? ev.awayScore : ev.homeScore;
  return `<tr><td>${fmtDate(ev.date)}</td><td>${teamLeft} <strong>${scoreLeft}</strong> - <strong>${scoreRight}</strong> ${teamRight}</td></tr>`;
}

function renderUpcomingRow(ev) {
  const rival = ev.isTeamHome ? ev.awayName : ev.homeName;
  const sede = ev.isTeamHome ? "vs" : "@";
  return `<tr><td>${fmtDate(ev.date)}</td><td>${sede} ${rival}</td><td>${ev.statusDetail}</td></tr>`;
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
      ? `<table>${finished.map(renderResultRow).join("")}</table>`
      : `<p class="muted">Sin resultados recientes disponibles.</p>`;

    proximos = upcoming.length
      ? `<table>${upcoming.map(renderUpcomingRow).join("")}</table>`
      : `<p class="muted">Calendario aun no publicado.</p>`;
  } catch (err) {
    resultados = `<p class="muted">No se pudo cargar (${err.message}).</p>`;
    proximos = `<p class="muted">No se pudo cargar.</p>`;
  }

  try {
    const standing = await getStandingEntry(team);
    standingsHtml = standing
      ? `<p><strong>${standing.rank}º</strong> de ${standing.totalInGroup} en ${standing.groupName} &middot; Record: ${standing.record}${standing.winPercent ? ` &middot; ${standing.winPercent}` : ""}</p>`
      : `<p class="muted">Posicion no disponible.</p>`;
  } catch (err) {
    standingsHtml = `<p class="muted">No se pudo cargar (${err.message}).</p>`;
  }

  return `
  <section class="card">
    <h2>${team.emoji} ${team.name} <span class="league">${team.leagueName}</span></h2>
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
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 2rem 1rem; background: #0b1220; color: #e7ecf3; }
  @media (prefers-color-scheme: light) { body { background: #f5f7fa; color: #111; } }
  h1 { text-align: center; margin-bottom: .25rem; }
  .updated { text-align: center; color: #8892a6; font-size: .85rem; margin-bottom: 2rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.25rem; max-width: 1200px; margin: 0 auto; }
  .card { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; padding: 1.25rem 1.5rem; }
  @media (prefers-color-scheme: light) { .card { background: #fff; border-color: #e2e5ea; box-shadow: 0 1px 3px rgba(0,0,0,.06); } }
  .card h2 { margin: 0 0 .75rem; font-size: 1.15rem; display: flex; align-items: center; gap: .5rem; }
  .league { font-size: .7rem; font-weight: 400; color: #8892a6; border: 1px solid currentColor; border-radius: 999px; padding: .1rem .5rem; }
  .card h3 { font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; color: #8892a6; margin: 1rem 0 .35rem; }
  table { width: 100%; border-collapse: collapse; font-size: .9rem; }
  td { padding: .3rem 0; border-bottom: 1px solid rgba(255,255,255,0.08); }
  .muted { color: #8892a6; font-size: .9rem; margin: 0; }
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
  console.log("docs/index.html generado.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
