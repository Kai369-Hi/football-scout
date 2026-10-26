# Football Scout

Find a cheaper player who plays the same way.

A final-year data science project that combines a **player similarity model** and a **market value model** for the 2025-26 season of the top five European leagues (1,410 outfield players with at least 900 league minutes).

**Live site:** https://kai369-hi.github.io/football-scout/

## How it works

| Step | Notebook | What it does |
|---|---|---|
| 1 | `01_collect_understat.ipynb`, `01b_collect_understat_shots.ipynb` | Download Understat season stats and shot events |
| 2 | `02_clean_merge.ipynb` | Merge FBref, Understat and Transfermarkt; match player names; per-90 metrics; shot-style features |
| 3 | `03_eda.ipynb` | Exploratory analysis |
| 4 | `04_similarity.ipynb` | Style similarity (standardised per position, cosine similarity) |
| 5 | `05_valuation.ipynb` | Market value model (linear + gradient boosting ensemble, 5-fold CV) |
| 6 | `06_alternative_score.ipynb` | Alternative score = style + output + value for money |
| 7 | `src/export_web.py` → `docs/` | Static website (GitHub Pages) |

The website runs entirely in the browser. Python prepares the data (`docs/data.js`); `docs/app.js` repeats the scoring from `src/scouting.py`. `tests/parity.js` checks that both give the same ranking.

## Update the website after changing the models

```bash
python src/export_web.py        # rebuild docs/data.js
python tests/make_expected.py   # Python reference results
node tests/parity.js            # check the website matches Python
```

## Data sources

- [FBref](https://fbref.com): minutes, interceptions, tackles won, crosses, fouls, offsides
- [Understat](https://understat.com): xG, xA, shots, key passes, xG chain, xG buildup, shot events
- [transfermarkt-datasets](https://github.com/dcaribou/transfermarkt-datasets) (CC0): market values, height, foot, position

Raw data files are not stored in this repository.

## Known limitations

- No speed or aerial duel data (requires paid tracking data); height is used as a rough proxy for centre-backs.
- Defensive actions are not possession-adjusted.
- The value model underestimates how quickly prices fall for players over 32.
- Fame, injuries, wages and club prestige are not modelled.
