# stricke-out

Pagina estatica con resultados terminados, proximos partidos y tabla de posiciones de:

- Real Madrid (LaLiga)
- Santos Laguna (Liga MX)
- Las Vegas Raiders (NFL)
- Chicago Cubs (MLB)
- Chicago Bulls (NBA)
- Los Angeles Kings (NHL)

## Como funciona

`scripts/build.mjs` consulta la API publica de ESPN (sin API key) y genera `docs/index.html`.
Un workflow de GitHub Actions (`.github/workflows/update.yml`) corre ese script cada 4 horas
y publica el resultado en GitHub Pages (sirviendo la carpeta `docs/` de la rama `main`).

## Uso local

```bash
node scripts/build.mjs
```

Esto regenera `docs/index.html` con los datos mas recientes.
