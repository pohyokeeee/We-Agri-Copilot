"""Business-structure comparison: A individual / B 个体工商户 / C cooperative / D company.

Same table for every user, his numbers filled in. Information only: no 'best' field, no recommendation.
A cell citing any 'recall' rule is shown as 待核实.
"""
from sqlmodel import Session, select

from app.agent.grounding import assert_wording
from app.analysis.common import latest_period, load_rules, n, period_bounds, rules_view, shift_months
from app.analysis.compliance import DISCLAIMER
from app.analysis.reconcile import reconcile_range
from app.audit import chain
from app.models import BankAccount, BankTxn
from app.tax.vat import vat_due

STRUCTURES = ("A_individual", "B_geti", "C_cooperative", "D_company")
LABELS = {"A_individual": "A 个人", "B_geti": "B 个体工商户", "C_cooperative": "C 合作社", "D_company": "D 公司"}
COST_CATEGORIES = ("supplier_honey", "jars_labels", "hive_feed", "spring_inputs")
RULE_IDS = [
    "vat_law_art24_own_produce", "vat_ann2026_no10_threshold", "iit_ann2023_no12_geti_half", "iit_individual_placeholder",
    "eit_agri_primary_exempt", "eit_trading_not_exempt", "eit_small_low_profit", "coop_member_own_produce",
    "paperwork_A_individual", "paperwork_B_geti", "paperwork_C_cooperative", "paperwork_D_company",
]


def compare_structures(s: Session, customer_id: int, period: str | None = None) -> dict:
    """Table rows vat / income_tax / paperwork x A-D; cell = {text_zh, value?, rule_ids, status}. Audited; caller commits."""
    period = period or latest_period()
    start, end = period_bounds(period)
    rules = load_rules(s, RULE_IDS)
    q = reconcile_range(s, customer_id, start, end)
    year = reconcile_range(s, customer_id, shift_months(end, -12), end)

    acct = s.exec(select(BankAccount).where(BankAccount.customer_id == customer_id)).one()
    costs = {c: 0.0 for c in COST_CATEGORIES}
    for t in s.exec(select(BankTxn).where(BankTxn.account_id == acct.id, BankTxn.direction == "debit",
                                          BankTxn.ts >= shift_months(end, -12), BankTxn.ts < end)):
        if t.category in costs:
            costs[t.category] += t.amount
    total_sales = sum(year["by_class"].values())
    taxable_income = round(total_sales - sum(costs.values()), 2)  # household spending is not a business cost
    resale = year["by_class"]["resale"]
    resale_margin = round(resale - costs["supplier_honey"], 2)

    def cell(ids: list[str], text: str, value: float | None = None) -> dict:
        status = "verified" if all(rules[i].status == "verified" for i in ids) else "recall"
        return {"text_zh": text if status == "verified" else "待核实", "value": value if status == "verified" else None,
                "rule_ids": ids, "status": status}

    thr = rules["vat_ann2026_no10_threshold"].rate_or_threshold
    vq = vat_due(q["by_class"]["resale"], "quarter", thr)
    vat_ids = ["vat_law_art24_own_produce", "vat_ann2026_no10_threshold"]
    vat_text = (
        f"规则：自产初级农产品免征增值税；转卖部分月销售额低于{n(thr['thresholds']['month'])}元、"
        f"季度低于{n(thr['thresholds']['quarter'])}元时免征，达到则全额计税（征收率{thr['levy_rate']:.0%}）。"
        f"本季度转卖销售额{n(q['by_class']['resale'])}元，按此估算增值税{n(vq['vat'])}元。")
    iit = rules["iit_ann2023_no12_geti_half"].rate_or_threshold
    eit = rules["eit_small_low_profit"].rate_or_threshold
    eit_tax = round(max(resale_margin, 0) * eit["effective_rate"], 2)
    coop_ids = ["eit_agri_primary_exempt", "eit_trading_not_exempt", "coop_member_own_produce"]

    table = {
        "vat": {
            "A_individual": cell(vat_ids, vat_text, vq["vat"]),
            "B_geti": cell(vat_ids, vat_text, vq["vat"]),
            "C_cooperative": cell(vat_ids + ["coop_member_own_produce"], vat_text, vq["vat"]),
            "D_company": cell(vat_ids, vat_text, vq["vat"]),
        },
        "income_tax": {
            "A_individual": cell(["iit_individual_placeholder"], ""),
            "B_geti": cell(
                ["iit_ann2023_no12_geti_half"],
                f"规则：个体工商户年应纳税所得额不超过{n(iit['annual_taxable_income_max'])}元的部分，个人所得税减半。"
                f"按已记录的销售和成本估算，近12个月应纳税所得额约{n(taxable_income)}元；税率表不在规则表内，未计算税额。",
                taxable_income),
            "C_cooperative": cell(coop_ids, ""),
            "D_company": cell(
                ["eit_small_low_profit", "eit_agri_primary_exempt", "eit_trading_not_exempt"],
                f"规则：种植、养殖、初加工所得免征企业所得税，收购转卖所得不在其内；小型微利企业按应纳税所得额的"
                f"{eit['taxable_income_fraction']:.0%}、税率{eit['rate']:.0%}计税（实际约{eit['effective_rate']:.0%}）。"
                f"估算：转卖毛利约{n(resale_margin)}元（转卖销售额减去已付邻居蜂蜜款），按约{eit['effective_rate']:.0%}为{n(eit_tax)}元；"
                "未计其他费用。", eit_tax),
        },
        "paperwork": {k: cell([f"paperwork_{k}"], "") for k in STRUCTURES},
    }
    row_labels = {"vat": "增值税", "income_tax": "所得税", "paperwork": "手续和账务"}
    rows = [{"key": k, "label_zh": row_labels[k], "cells": table[k]} for k in row_labels]
    used = {i for r in rows for c in r["cells"].values() for i in c["rule_ids"]}
    assumptions = [
        "销售额和成本取自近12个月已记录的平台订单与银行流水",
        f"成本只含进货{n(costs['supplier_honey'])}元、包装{n(costs['jars_labels'])}元、饲料{n(costs['hive_feed'])}元、农资{n(costs['spring_inputs'])}元，不含家庭开支",
        "表中数字是估算，不是纳税结果",
    ]
    assert_wording([c["text_zh"] for r in rows for c in r["cells"].values()] + assumptions)
    chain.append(s, "analysis", "structures_compared", {"customer_id": customer_id, "period": period,
                 "rule_ids": sorted(used)})
    return {"period": period, "columns": [{"key": k, "label_zh": LABELS[k]} for k in STRUCTURES], "rows": rows,
            "assumptions": assumptions, "rules": rules_view(rules, used), "disclaimer": DISCLAIMER}
