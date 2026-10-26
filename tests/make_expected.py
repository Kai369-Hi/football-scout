"""Writes tests/expected.json from the Python scout, for tests/parity.js to compare against.
Run from the project root:  python tests/make_expected.py"""
import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.scouting import Scout  # noqa: E402

LEAGUE_SHORT = {"ENG-Premier League": "Premier League", "ESP-La Liga": "La Liga",
                "GER-Bundesliga": "Bundesliga", "ITA-Serie A": "Serie A", "FRA-Ligue 1": "Ligue 1"}

scout = Scout(pd.read_csv(ROOT / "data" / "processed" / "players_valued.csv"))
cases = [
    ("Haaland default", "Erling Haaland", {}, {}),
    ("Pedri budget 20 age 18-26", "Pedri", {"max_value": 20, "age_range": (18, 26)}, {"maxValue": 20, "ageMin": 18, "ageMax": 26}),
    ("Saka left foot", "Bukayo Saka", {"foot": "left"}, {"foot": "left"}),
    ("Van Dijk Serie A/Ligue 1", "Virgil van Dijk", {"leagues": ["ITA-Serie A", "FRA-Ligue 1"]}, {"leagues": ["Serie A", "Ligue 1"]}),
    ("Rice cross-role bargain", "Declan Rice", {"same_role": False, "weights": {"style": 0.3, "level": 0.2, "value": 0.5}},
     {"sameRole": False, "weights": {"style": 0.3, "level": 0.2, "value": 0.5}}),
    ("Hakimi min level 0.6", "Achraf Hakimi", {"min_level_ratio": 0.6}, {"minLevel": 0.6}),
    ("Reece James same side", "Reece James", {}, {}),
    ("Reece James both sides", "Reece James", {"same_side": False}, {"sameSide": False}),
]
out = []
for label, name, py_kw, js_filters in cases:
    _, res = scout.find_alternatives(name, n=10, **py_kw)
    out.append({"label": label, "target": name, "filters": js_filters,
                "rows": res[["player", "alt_score"]].to_dict("records")})
(ROOT / "tests" / "expected.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print("✅ wrote tests/expected.json")
