"""
相似度模块（阶段 4）
====================
按位置分组，把指标标准化后，用 Cosine Similarity 找“踢法最像”的球员。

这个文件会被 notebook 和之后的 Streamlit App 共用，
所以写成函数，而不是散落在 notebook 里的代码。
"""
import re

import numpy as np
import pandas as pd
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.preprocessing import StandardScaler
from unidecode import unidecode

# 每个位置用来比较“踢法”的指标（阶段 1 决定、阶段 3 EDA 修正）
# - 中场删掉 key_passes：和 xa 相关 0.89，会重复计算
# - 后卫加入身高：争顶能力的近似指标（proxy），报告要注明
# - v2（阶段 4 改进）：加入射门风格指标 + 传中，分辨中锋 / 边锋 / 前腰
FEATURES = {
    "FW": ["npxg_p90", "shots_p90", "xa_p90", "off_p90", "fld_p90", "crs_p90",
           "header_share", "avg_shot_dist", "unassisted_share"],
    "MF": ["xa_p90", "xg_buildup_p90", "int_p90", "tklw_p90", "fls_p90", "npxg_p90", "crs_p90"],
    "DF": ["int_p90", "tklw_p90", "crs_p90", "xg_buildup_p90", "fls_p90", "height_in_cm", "xa_p90"],
}

# v1 的指标保留下来，评估时用来比较“改进前 vs 改进后”
FEATURES_V1 = {
    "FW": ["npxg_p90", "shots_p90", "xa_p90", "off_p90", "fld_p90"],
    "MF": ["xa_p90", "xg_buildup_p90", "int_p90", "tklw_p90", "fls_p90"],
    "DF": ["int_p90", "tklw_p90", "crs_p90", "xg_buildup_p90", "fls_p90", "height_in_cm"],
}

ROLE_NAMES = {"ST": "Striker", "W": "Winger", "AM": "Attacking mid", "CM": "Central / defensive mid",
              "CB": "Centre-back", "FB": "Full-back"}

# 给人看的指标名称（雷达图、App 用）
LABELS = {
    "npxg_p90": "npxG", "shots_p90": "Shots", "xa_p90": "xA", "off_p90": "Offsides",
    "fld_p90": "Fouled", "xg_buildup_p90": "xG Buildup", "int_p90": "Interceptions",
    "tklw_p90": "Tackles won", "fls_p90": "Fouls", "crs_p90": "Crosses",
    "height_in_cm": "Height", "header_share": "Header %", "avg_shot_dist": "Shot distance",
    "unassisted_share": "Self-created %",
}


def _key(text):
    """名字标准化：去重音、小写，方便搜索（José → jose）。"""
    return re.sub(r"\s+", " ", unidecode(str(text)).lower()).strip()


class SimilarityModel:
    """
    用法：
        model = SimilarityModel(df)
        model.find_similar("Pedri", n=10, max_value=30, age_range=(18, 26))
    """

    def __init__(self, df, features=None):
        self.features = features or FEATURES
        self.df = df.reset_index(drop=True).copy()
        self.df["_key"] = self.df["player"].map(_key)
        self.scaled = {}        # 每个位置的标准化矩阵
        self.index = {}         # 每个位置在 df 里的行号
        for pos, cols in self.features.items():
            rows = self.df.index[self.df["pos_group"] == pos]
            X = self.df.loc[rows, cols]
            X = X.fillna(X.median())                  # 极少数缺值（例如身高）用中位数补
            # ⚠️ 标准化只在“同位置”里做：后卫的拦截是和其他后卫比，不是和前锋比
            self.scaled[pos] = StandardScaler().fit_transform(X)
            self.index[pos] = rows

    def search(self, name):
        """模糊搜索球员名字，返回候选人（App 的搜索框会用到）。"""
        k = _key(name)
        hit = self.df[self.df["_key"].str.contains(k, regex=False)]
        return hit[["player", "squad", "pos_group", "sub_position", "age", "value_end"]]

    def _locate(self, name):
        hit = self.search(name)
        if hit.empty:
            raise ValueError(f"找不到球员：{name}")
        exact = hit[hit["player"].map(_key) == _key(name)]
        return (exact if len(exact) else hit).index[0]

    def similarity_to(self, name):
        """目标球员 vs 同位置所有人的相似度（不含筛选）。"""
        i = self._locate(name)
        pos = self.df.at[i, "pos_group"]
        rows = self.index[pos]
        Z = self.scaled[pos]
        target = Z[list(rows).index(i)].reshape(1, -1)
        sims = cosine_similarity(target, Z)[0]
        out = self.df.loc[rows].assign(similarity=sims.round(3))
        return i, out.drop(index=i)

    def find_similar(self, name, n=10, max_value=None, age_range=None,
                     leagues=None, foot=None, same_role=True):
        """
        找出最像的 n 名球员，并套用 App 的筛选条件：
          same_role : True = 只和同角色比（中锋 vs 中锋）；False = 允许跨位置（同大位置内）
          max_value : 预算上限（百万欧元）
          age_range : (最小年龄, 最大年龄)
          leagues   : 联赛列表，例如 ["ESP-La Liga", "ITA-Serie A"]
          foot      : "left" / "right"（双脚球员 both 也算符合）
        """
        i, out = self.similarity_to(name)
        if same_role:
            out = out[out["role"] == self.df.at[i, "role"]]
        if max_value is not None:
            out = out[out["value_end"] <= max_value]
        if age_range is not None:
            out = out[out["age"].between(*age_range)]
        if leagues:
            out = out[out["league"].isin(leagues)]
        if foot:
            out = out[out["foot"].isin([foot, "both"])]
        cols = ["player", "squad", "league", "role", "sub_position", "age", "foot",
                "minutes", "value_end", "similarity"]
        return out.sort_values("similarity", ascending=False)[cols].head(n)

    def percentiles(self, name):
        """目标球员每个指标在同位置里的百分位（0-100），雷达图用。"""
        i = self._locate(name)
        pos = self.df.at[i, "pos_group"]
        group = self.df[self.df["pos_group"] == pos]
        cols = self.features[pos]
        pct = group[cols].rank(pct=True).loc[i] * 100
        return pct.rename(index=LABELS).round(0)
