# Mederos

Pre-launch product site for **Mederos** and **Janus**, Mederos's market engine.

**Live site:** [davisdevelopment.github.io/aril](https://davisdevelopment.github.io/aril/)

## Local preview

Open `docs/index.html` in a browser, or serve the folder:

```powershell
cd docs
python -m http.server 8080
```

Then visit `http://localhost:8080`.

## Deploy

Pushes to `main` that touch `docs/` trigger the GitHub Actions workflow.
Alternatively, the `gh-pages` branch serves the site directly from its root.
