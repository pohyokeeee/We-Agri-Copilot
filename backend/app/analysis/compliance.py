"""Tax compliance check - cited information, never advice, never filing. Numbers: code. Thresholds: rule_tax only."""
from sqlmodel import Session

from app.agent.grounding import assert_wording
from app.analysis.common import latest_period, load_rules, n, period_bounds, rules_view, shift_months
from app.analysis.reconcile import monthly_class_totals, reconcile_range
from app.audit import chain
from app.tax.vat import vat_due

DISCLAIMER = "这是信息，不是建议 · 请咨询12366"
RULE_IDS = ["vat_law_art24_own_produce", "eit_trading_not_exempt", "platform_income_reporting",
            "vat_ann2026_no10_threshold", "vat_small_scale_taxpayer"]


def in_effect(rule, start, end) -> bool:
    return (rule.effective_from is None or rule.effective_from <= start.date()) and (
        rule.effective_to is None or rule.effective_to >= end.date())


def check_compliance(s: Session, customer_id: int, period: str | None = None) -> dict:
    """3 flags (4 when products need confirming): resale share, reconciliation gap, VAT threshold.
    Audited; caller commits."""
    period = period or latest_period(s)
    start, end = period_bounds(period)
    rules = load_rules(s, RULE_IDS)
    q = reconcile_range(s, customer_id, start, end)
    year = reconcile_range(s, customer_id, shift_months(end, -12), end)
    months = monthly_class_totals(s, start, end)

    by = year["by_class"]
    total = sum(by.values())
    share = by["resale"] / total if total else 0.0
    flags = [{
        "code": "RESALE_SHARE",
        "plain_text_zh": (
            f"近12个月销售额约{n(total)}元，其中收购邻居蜂蜜再卖出的约{n(by['resale'])}元，占{share:.0%}。"
            "按增值税法第二十四条，农民销售自产初级农产品免征增值税，收购后转卖的部分不在其内；"
            "企业所得税的农业免征也不包括单纯转卖收购的农产品。"),
        "numbers": {"total_sales": total, "resale_sales": by["resale"], "resale_share": round(share, 4)},
        "rule_ids": ["vat_law_art24_own_produce", "eit_trading_not_exempt"],
    }]

    g = q["gap_breakdown"]
    flags.append({
        "code": "RECONCILIATION_GAP",
        "plain_text_zh": (
            f"{period}平台报告的销售额{n(q['platform_reported'])}元，您自产销售的记录{n(q['record_total'])}元，"
            f"差额{n(q['gap'])}元：转卖{n(g['resale'])}元，退款{n(g['refunds'])}元，"
            f"未找到对应打款{n(g['missed_payout'])}元，待确认商品{n(g['needs_confirmation'])}元。"
            "平台每季度向税务机关报告卖家收入，没有小额门槛。"),
        "numbers": {"period": period, "platform_reported": q["platform_reported"], "record_total": q["record_total"],
                    "gap": q["gap"], **g},
        "rule_ids": ["platform_income_reporting"],
    })

    thr = rules["vat_ann2026_no10_threshold"].rate_or_threshold
    limit = rules["vat_small_scale_taxpayer"].rate_or_threshold["annual_taxable_sales_max"]
    resale_q = q["by_class"]["resale"]
    resale_m = max((m["resale"] for m in months.values()), default=0.0)
    vq, vm = vat_due(resale_q, "quarter", thr), vat_due(resale_m, "month", thr)
    reached = not (vq["exempt"] and vm["exempt"])
    effective = in_effect(rules["vat_ann2026_no10_threshold"], start, end)
    text = (
        f"需要计税的销售（转卖部分）：本季度{n(resale_q)}元，季度门槛{n(thr['thresholds']['quarter'])}元；"
        f"单月最高{n(resale_m)}元，月门槛{n(thr['thresholds']['month'])}元。"
        f"规则：低于门槛时免征，达到门槛则全部销售额计税（征收率{thr['levy_rate']:.0%}）。")
    text += (f"已达到门槛，按规则全部转卖销售额计税，约{n(vq['vat'] + (vm['vat'] if not vq['vat'] else 0))}元。" if reached
             else f"目前低于门槛，距季度门槛还差{n(thr['thresholds']['quarter'] - resale_q)}元。")
    text += f"近12个月销售额{n(total)}元，小规模纳税人年销售额上限{n(limit)}元。"
    if not effective:
        text += "（该公告在本期不在适用期内。）"
    flags.append({
        "code": "VAT_THRESHOLD",
        "plain_text_zh": text,
        "numbers": {"quarter_resale": resale_q, "quarter_threshold": thr["thresholds"]["quarter"],
                    "month_max_resale": resale_m, "month_threshold": thr["thresholds"]["month"],
                    "quarter_status": "below" if vq["exempt"] else "reached",
                    "month_status": "below" if vm["exempt"] else "reached",
                    "levy_rate": thr["levy_rate"], "annual_sales": total, "small_scale_limit": limit,
                    "rule_in_effect": effective},
        "rule_ids": ["vat_ann2026_no10_threshold", "vat_small_scale_taxpayer"],
    })

    if q["needs_confirmation"]:
        flags.append({
            "code": "NEEDS_CONFIRMATION",
            "plain_text_zh": "有商品无法判断是自产还是转卖，需要您确认：" + "、".join(
                f"{p['product']}（{p['orders']}单，{n(p['amount'])}元）" for p in q["needs_confirmation"]),
            "numbers": {"products": q["needs_confirmation"]},
            "rule_ids": ["vat_law_art24_own_produce"],
        })

    assert_wording([f["plain_text_zh"] for f in flags])
    used = {i for f in flags for i in f["rule_ids"]}
    result = {"period": period, "flags": flags, "rules": rules_view(rules, used), "disclaimer": DISCLAIMER}
    chain.append(s, "analysis", "compliance_checked", {"customer_id": customer_id, "period": period,
                 "flags": [f["code"] for f in flags], "rule_ids": sorted(used)})
    return result
