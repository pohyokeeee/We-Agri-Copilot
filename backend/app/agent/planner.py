"""The planner. With a live model, qwen-plus proposes a DAG as JSON and CODE decides whether to accept it.

The model never sets what matters: its tier and undo fields are ignored (the registry fills them in), amounts and payees
must be {"$ref"} results of earlier steps, and a literal number or name is accepted only if the user actually said it.
Bad JSON, an unknown tool, a rule violation: one re-plan with the error; still bad: the fixed templates (planner_mock),
which also supply the clarifying question for a request nobody understands. No key, LLM_MOCK=1 or a model that is down:
templates, silently. The text planned is only ever the user's own words (Untrusted text is refused up front).
"""
import logging
import re

from app.agent import planner_mock, tools
from app.agent.dag import Dag, DagNode
from app.agent.grounding import check_wording, numbers_in
from app.agent.roles import ROLE_OF
from app.config import settings
from app.llm import qwen
from app.risk.untrusted import ensure_trusted

log = logging.getLogger("planner")
MAX_NODES = 10
ARG_KEYS = {
    "check_compliance": set(), "match_policies": set(), "forecast_procurement": set(), "plan_supplier_payments": set(),
    "resolve_payee": {"query"}, "reserve_funds": {"label", "amount"}, "prefill_financing": {"amount"},
    "submit_financing": {"application_id"}, "schedule_conditional_transfers": {"suppliers", "run_on"},
    "transfer_money": {"payee_id", "amount", "purpose", "spoken_as"},
}
CATALOG = """工具目录（只能用这些）：
- check_compliance：检查合规。没有参数。
- match_policies：查可能符合的补贴和贷款。没有参数。
- forecast_procurement：预测下个采购季要花多少钱、现金够不够。没有参数。结果可引用：reserve_amount, loan_amount, suppliers, window_start
- plan_supplier_payments：查去年付给各家供应商的钱。没有参数。结果可引用：suppliers, window_start
- resolve_payee：按名字或外号找收款人。参数 query=用户说的名字。结果可引用：payee_id
- reserve_funds：预留一笔钱（要确认）。参数 label，amount（必须引用）。
- prefill_financing：预填贷款申请草稿（要确认）。参数 amount（必须引用）。结果可引用：application_id
- submit_financing：正式发出贷款申请（要密码和家人确认）。参数 application_id（必须引用）。
- schedule_conditional_transfers：安排送货时付给各家供应商（要密码和家人确认）。参数 suppliers, run_on（必须引用）。
- transfer_money：给一个人转账（要确认）。参数 payee_id（必须引用 resolve_payee 的结果）；amount、purpose 只能是用户亲口说的数字和用途；spoken_as=用户说的名字。"""
RULES = """规则：
1. 只输出 JSON，不要别的话。格式：{"nodes":[{"id":"N1","tool":"工具名","label_zh":"一句短话","depends_on":[],"args":{}}]}。
   看不懂用户要什么时，只输出一个问题：{"question_zh":"..."}。
2. 不要写等级（tier）和撤销办法：系统自己决定。
3. 钱的数目和收款人不能自己编：要写成 {"$ref":"节点id.字段"}，引用前面步骤的结果。只有用户亲口说出的数字、名字才能直接写。
4. 用 depends_on 把先后顺序连起来。"""


def _brief(dag: Dag) -> str:
    import json

    return json.dumps({"nodes": [{"id": n.id, "tool": n.tool, "label_zh": n.label_zh, "depends_on": n.depends_on, "args": n.args}
                                 for n in dag.nodes]}, ensure_ascii=False)


def system_prompt() -> str:
    examples = [("下个月要收蜂蜜了，帮我准备一下", planner_mock.prepare_for_honey()), ("像去年一样给六家付蜂蜜钱", planner_mock.pay_like_last_year()),
                ("给老李转800，蜂蜜钱", planner_mock.one_transfer("老李", 800.0, "蜂蜜钱"))]
    shown = "\n".join(f"用户：{q}\n答：{_brief(d)}" for q, d in examples)
    return f"你是帮农户办银行事务的计划员，只负责把话变成步骤。\n{CATALOG}\n{RULES}\n例子：\n{shown}"


def _messages(text: str, error: str) -> list[dict]:
    msgs = [{"role": "system", "content": system_prompt()}, {"role": "user", "content": f"用户说：{text}"}]
    if error:
        msgs.append({"role": "user", "content": f"上一次的答案不合格：{error}。请只用工具目录里的工具，重新输出 JSON。"})
    return msgs


def _check_literals(dag: Dag, utterance: str) -> None:
    """A literal in a plan is accepted only if the user said it: numbers must be in the sentence, names must be in it."""
    said_numbers, said_text = numbers_in(utterance), re.sub(r"[\s，。,.！!？?、：:；;]", "", utterance)
    for n in dag.nodes:
        for key, v in n.args.items():
            if isinstance(v, dict):
                continue  # a {"$ref"}: tools.validate already checked what it points at
            if key == "label":
                continue
            if isinstance(v, bool) or v is None or isinstance(v, list):
                raise tools.PlanRejected(f"{n.id}.{key}: 只能引用前面步骤的结果")
            if isinstance(v, (int, float)):
                if round(float(v), 2) not in said_numbers:
                    raise tools.PlanRejected(f"{n.id}.{key}: 数字 {v} 不是用户说的")
            elif re.sub(r"[\s，。,.！!？?、：:；;]", "", str(v)) not in said_text:
                raise tools.PlanRejected(f"{n.id}.{key}: “{v}” 不是用户说的")


def dag_from_llm(raw: dict, utterance: str) -> Dag:
    """Raises tools.PlanRejected (or ValueError for a malformed schema) unless every rule holds."""
    nodes_raw = raw.get("nodes")
    if not isinstance(nodes_raw, list) or not 1 <= len(nodes_raw) <= MAX_NODES:
        raise tools.PlanRejected(f"nodes 必须是 1 到 {MAX_NODES} 个步骤")
    nodes = []
    for n in nodes_raw:
        if not isinstance(n, dict) or not isinstance(n.get("id"), str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9]{0,5}", n["id"]):
            raise tools.PlanRejected("步骤的 id 不合格")
        tool = tools.TOOLS.get(n.get("tool"))
        if tool is None or n["tool"] not in ROLE_OF:
            raise tools.PlanRejected(f"{n['id']}: 不认识的工具 {n.get('tool')}")
        args = n.get("args") or {}
        deps = n.get("depends_on") or []
        if not isinstance(args, dict) or not isinstance(deps, list) or not all(isinstance(d, str) for d in deps):
            raise tools.PlanRejected(f"{n['id']}: args 或 depends_on 的格式不对")
        if extra := set(args) - ARG_KEYS[n["tool"]]:
            raise tools.PlanRejected(f"{n['id']}: 不允许的参数 {sorted(extra)}")
        label = str(n.get("label_zh") or n["tool"])[:30]
        if not check_wording(label)["ok"]:
            raise tools.PlanRejected(f"{n['id']}: 步骤名称用词不合格")
        # tier and undo come from the registry; whatever the model wrote for them is ignored
        nodes.append(DagNode(id=n["id"], tool=n["tool"], label_zh=label, args=args, depends_on=deps,
                             undo={"tool": tool.undo, "args": {}} if tool.undo else None, base_tier=tools.base_tier(tool.action)))
    dag = Dag(nodes=nodes)
    tools.validate(dag)
    _check_literals(dag, utterance)
    return dag


def plan(text: str) -> tuple[Dag | str, str]:
    """(a Dag or one clarifying question, where it came from)."""
    ensure_trusted(text, "计划")
    if not qwen.enabled():
        return planner_mock.plan(text), "templates"
    error = why = ""
    for attempt in (1, 2):  # the first answer, then ONE re-plan that is told what was wrong
        try:
            raw = qwen.json_chat(_messages(text, error), settings.llm_planner)
        except qwen.BadAnswer as e:  # it answered, but not in JSON: say so and ask once more
            error = why = str(e)
            continue
        except qwen.LLMError as e:  # the model is down or slow: asking again will not help
            why = str(e)
            break
        if "nodes" not in raw and isinstance(raw.get("question_zh"), str):
            q = raw["question_zh"].strip()[:80]
            if q and check_wording(q)["ok"]:
                return q, f"{settings.llm_planner} (question)"
            error = why = "问题不合格"
            continue
        try:
            return dag_from_llm(raw, text), f"{settings.llm_planner} (attempt {attempt})"
        except (tools.PlanRejected, ValueError) as e:
            error = why = str(e)[:200]
            log.warning("planner attempt %s rejected: %s", attempt, error)
    return planner_mock.plan(text), f"templates (fallback after {settings.llm_planner}: {why})"
