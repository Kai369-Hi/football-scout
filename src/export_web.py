"""
把模型结果导出成网页用的数据（阶段 7）
========================================
网页是“自助便当店”：Python 事先把便当做好（标准化后的指标、身价预测、实力分），
存成 docs/data.js，浏览器里的 JavaScript 只负责“挑便当”（算相似度、筛选、排名）。

运行方法（在项目根目录）：
    python src/export_web.py

⚠️ 每次重跑 02 / 05 之后，都要重新运行这个文件，网页的数据才会更新。
"""
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler
from unidecode import unidecode

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.similarity import FEATURES, LABELS          # noqa: E402
from src.scouting import LEVEL_METRICS, DEFAULT_WEIGHTS, add_level  # noqa: E402

LEAGUE_SHORT = {"ENG-Premier League": "Premier League", "ESP-La Liga": "La Liga",
                "GER-Bundesliga": "Bundesliga", "ITA-Serie A": "Serie A", "FRA-Ligue 1": "Ligue 1"}


def main():
    df = pd.read_csv(ROOT / "data" / "processed" / "players_valued.csv")
    df = add_level(df).reset_index(drop=True)

    # 球员照片网址（来自 Transfermarkt 数据集）；预设的空白头像不要，网页会改用名字缩写
    tm_file = ROOT / "data" / "raw" / "transfermarket" / "players.csv"
    photos = pd.read_csv(tm_file, usecols=["player_id", "image_url"]).set_index("player_id")["image_url"]
    df["photo"] = df["tm_id"].map(photos)
    df.loc[df["photo"].str.contains("default", na=True), "photo"] = None

    z = {}       # 每名球员的标准化向量（和 SimilarityModel 完全一样的做法）
    pct = {}     # 每名球员在同位置里的百分位（雷达图用）
    for pos, cols in FEATURES.items():
        rows = df.index[df["pos_group"] == pos]
        X = df.loc[rows, cols]
        X = X.fillna(X.median())
        Z = StandardScaler().fit_transform(X)
        P = df.loc[rows, cols].rank(pct=True) * 100
        for k, i in enumerate(rows):
            z[i] = [round(float(v), 4) for v in Z[k]]
            pct[i] = [None if pd.isna(v) else int(round(v)) for v in P.loc[i]]

    def clean(v, nd=None):
        if pd.isna(v):
            return None
        return round(float(v), nd) if nd is not None else v

    players = []
    for i, r in df.iterrows():
        contract = r["contract_expiration_date"]
        players.append({
            "id": r["fbref_id"],
            "name": r["player"],
            "key": unidecode(str(r["player"])).lower(),
            "squad": r["squad"],
            "league": LEAGUE_SHORT[r["league"]],
            "pos": r["pos_group"],
            "role": r["role"],
            "sub": r["sub_position"],
            "age": clean(r["age"], 1),
            "foot": clean(r["foot"]),
            "height": clean(r["height_in_cm"], 0),
            "minutes": int(r["minutes"]),
            "value": clean(r["value_end"], 2),
            "pred": clean(r["pred_value"], 1),
            "ratio": clean(r["value_ratio"], 2),
            "level": clean(r["level"], 1),
            "contract": None if pd.isna(contract) else str(contract)[:10],
            "photo": clean(r["photo"]),
            "z": z[i],
            "pct": pct[i],
        })

    payload = {
        "generated": date.today().isoformat(),
        "season": "2025-26",
        "features": {pos: [LABELS[c] for c in cols] for pos, cols in FEATURES.items()},
        "levelMetrics": LEVEL_METRICS,
        "defaultWeights": DEFAULT_WEIGHTS,
        "players": players,
    }
    out = ROOT / "docs" / "data.js"
    out.parent.mkdir(exist_ok=True)
    # 用 .js 而不是 .json：直接双击 index.html（file://）也能载入，不会被浏览器挡
    out.write_text("window.SCOUT_DATA = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n",
                   encoding="utf-8")
    print(f"✅ 导出 {len(players)} 名球员 → {out}（{out.stat().st_size / 1024:.0f} KB）")


if __name__ == "__main__":
    main()
