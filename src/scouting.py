"""
平替评分模块（阶段 6）
======================
把三件事结合成一个 0-100 的“平替分”：

    平替分 = 100 × ( w_style × 风格相似度
                   + w_level × 实力匹配度
                   + w_value × 性价比 )

| 部分 | 来源 | 回答的问题 |
|---|---|---|
| 风格相似度 style | 阶段 4 Cosine Similarity | 踢法像不像？ |
| 实力匹配度 level | 同角色里的百分位（本文件计算） | 份量够不够？（Cosine 不看份量的补丁） |
| 性价比 value | 阶段 5 value_ratio | 是不是被低估？ |
"""
import numpy as np
import pandas as pd

from src.similarity import SimilarityModel

# 每个角色的“实力”用哪些指标衡量（越高越好的指标才放进来，犯规不放）
LEVEL_METRICS = {
    "ST": ["npxg_p90", "xa_p90", "xg_chain_p90"],
    "W":  ["npxg_p90", "xa_p90", "xg_chain_p90"],
    "AM": ["npxg_p90", "xa_p90", "xg_chain_p90"],
    "CM": ["xg_chain_p90", "xg_buildup_p90", "int_p90", "tklw_p90"],
    "CB": ["int_p90", "tklw_p90", "xg_buildup_p90"],
    "FB": ["int_p90", "tklw_p90", "xa_p90", "xg_buildup_p90"],
}

DEFAULT_WEIGHTS = {"style": 0.5, "level": 0.3, "value": 0.2}

# 边后卫和边锋要分左右：数据本身看不出球员在哪一边踢
SIDED_ROLES = {"FB", "W"}


def side_of(sub_position):
    """Left-Back → "L"，Right Winger → "R"，其他 → None"""
    s = str(sub_position)
    return "L" if s.startswith("Left") else "R" if s.startswith("Right") else None


def add_level(df):
    """实力分 level（0-100）：每个指标在同角色里的百分位，再取平均。"""
    df = df.copy()
    df["level"] = np.nan
    for role, cols in LEVEL_METRICS.items():
        rows = df["role"] == role
        pct = df.loc[rows, cols].rank(pct=True) * 100
        df.loc[rows, "level"] = pct.mean(axis=1).round(1)
    return df


class Scout:
    """
    用法：
        scout = Scout(players_valued_df)
        scout.find_alternatives("Pedri", max_value=30)
    """

    def __init__(self, df):
        self.df = add_level(df).reset_index(drop=True)
        self.sim = SimilarityModel(self.df)

    def find_alternatives(self, name, n=10, weights=None, min_level_ratio=0.8,
                          cheaper_only=True, same_role=True, same_side=True, max_value=None,
                          age_range=None, leagues=None, foot=None):
        """
        min_level_ratio : 候选人的实力分至少要达到目标的几成（0.8 = 80%）
        cheaper_only    : 只看比目标便宜的球员（平替的定义）
        same_side       : 边后卫 / 边锋只和同一边比（右后卫 vs 右后卫）
        其余筛选条件和 SimilarityModel.find_similar 一样
        """
        w = {**DEFAULT_WEIGHTS, **(weights or {})}
        total = sum(w.values())
        w = {k: v / total for k, v in w.items()}            # 权重加起来 = 1

        i, cand = self.sim.similarity_to(name)
        target = self.sim.df.loc[i]

        # ---------- 硬性条件（不符合就排除）----------
        if same_role:
            cand = cand[cand["role"] == target["role"]]
        if same_side and target["role"] in SIDED_ROLES:
            cand = cand[cand["sub_position"].map(side_of) == side_of(target["sub_position"])]
        if cheaper_only:
            cand = cand[cand["value_end"] < target["value_end"]]
        if max_value is not None:
            cand = cand[cand["value_end"] <= max_value]
        if age_range is not None:
            cand = cand[cand["age"].between(*age_range)]
        if leagues:
            cand = cand[cand["league"].isin(leagues)]
        if foot:
            cand = cand[cand["foot"].isin([foot, "both"])]
        cand = cand.copy()
        cand["level_ratio"] = (cand["level"] / target["level"]).round(2)
        cand = cand[cand["level_ratio"] >= min_level_ratio]

        # ---------- 三个分数，全部换算成 0-1 ----------
        style = cand["similarity"].clip(0, 1)
        level = cand["level_ratio"].clip(upper=1.0)                  # 比目标强不额外加分
        value = ((np.log2(cand["value_ratio"]).clip(-1, 2) + 1) / 3)  # 0.5× → 0，1× → 0.33，4× → 1

        cand["score_style"] = (style * 100).round(0)
        cand["score_level"] = (level * 100).round(0)
        cand["score_value"] = (value * 100).round(0)
        cand["alt_score"] = (100 * (w["style"] * style + w["level"] * level + w["value"] * value)).round(1)

        cols = ["player", "squad", "league", "role", "sub_position", "age", "foot", "minutes", "value_end",
                "pred_value", "value_ratio", "level", "similarity",
                "score_style", "score_level", "score_value", "alt_score", "contract_expiration_date"]
        # 同分时：先比风格相似度，再按名字，保证排名固定（网页的 app.js 用同样的规则）
        cand = cand.sort_values(["alt_score", "similarity", "player"], ascending=[False, False, True])
        return target, cand[cols].head(n)
