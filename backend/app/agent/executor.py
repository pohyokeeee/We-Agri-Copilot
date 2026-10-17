"""Saga executor: run a plan's nodes in dependency order, stop before every 🟡/🔴 step for approval, undo on request.

The plan names tools; the tier engine and the bank's approval flow decide everything that matters:
  * a green (analysis) node runs by itself;
  * a write node first opens a real approval at the bank (read-back, confirm, PIN, co-signer), the graph pauses, and the
    node only executes when /agent/approve brings the approved token, which the bank re-checks;
  * "贷款先不要" / "算了" undo executed nodes with their compensating calls, newest first.
Every step writes an audit row stamped with the plan's trace_id.
"""
import copy
import uuid
from contextvars import ContextVar

from sqlmodel import Session, select

from app import clock, trace
from app.agent import graph, planner_mock, tools
from app.agent.dag import Dag
from app.mockbank import service as svc
from app.models import AgentAudit, AgentHandover, AgentPlan, BankApproval, CosignRequest
from app.risk.tiers import classify

_S: ContextVar[Session] = ContextVar("agent_session")
MARKER = {"green": "🟢", "yellow": "🟡", "red": "🔴"}
OK_DEPS = {"done", "skipped", "dropped"}  # a later node may run after these
SETTLED = {"done", "skipped", "undone", "dropped", "failed", "blocked"}
ENDED = {"done", "cancelled", "handed_over", "rejected"}  # nothing more can happen to the plan
FINANCING = {"prefill_financing", "submit_financing"}
STATUS_ZH = {"pending": "等待", "waiting": "等您确认", "done": "已完成", "skipped": "不用做", "undone": "已撤销", "dropped": "不办了",
             "failed": "没办成", "blocked": "没法做"}


class AgentError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status, self.detail = status, detail


# ---------- small helpers ----------
def _audit(s: Session, plan: AgentPlan, event: str, **kw) -> None:
    svc.audit_step(s, event, plan.customer_id, actor="agent", **kw)


def _save(s: Session, plan: AgentPlan, st: dict) -> None:
    plan.state = copy.deepcopy(st)  # reassign: SQLAlchemy does not see changes made inside a JSON value
    s.add(plan)
    s.flush()


def _dag(plan: AgentPlan) -> Dag:
    return Dag.model_validate(plan.dag_json["dag"])


def latest(s: Session, session_id: str) -> AgentPlan | None:
    return s.exec(select(AgentPlan).where(AgentPlan.session_id == session_id).order_by(AgentPlan.id.desc())).first()


def _ctx(s: Session, plan: AgentPlan, st: dict, dnode=None) -> tools.Ctx:
    cust, acct = svc.get_customer(s, plan.customer_id)
    results = {k: v["result"] for k, v in st["nodes"].items() if v["result"] is not None}
    return tools.Ctx(s, cust, acct, tools.resolve(dnode.args, results) if dnode else {}, results)


def _tier_of(node: dict) -> dict:
    ap = node.get("approval")
    if ap:
        return {"base_tier": ap["tier_base"], "final_tier": ap["tier"], "reasons": ap["reasons"]}
    return {"base_tier": node["tier_base"], "final_tier": node["tier_base"], "reasons": []}


def _revoke(s: Session, plan: AgentPlan, node: dict) -> None:
    """The plan changed: an approval (even a granted, unused token) for this node must not stay usable."""
    if not node.get("approval"):
        return
    ap = s.get(BankApproval, node["approval"]["approval_id"])
    if ap and ap.status in ("pending", "approved"):
        ap.status = "declined"
        s.add(ap)
        for cr in s.exec(select(CosignRequest).where(CosignRequest.approval_id == ap.id, CosignRequest.status == "pending")):
            cr.status, cr.decided_at = "declined", clock.now()
            s.add(cr)
        _audit(s, plan, "cancelled", ap=ap, method="agent", result="approval revoked: the plan changed")


# ---------- creating, checking ----------
def create_plan(s: Session, session_id: str, customer_id: int, text: str, dag: Dag) -> AgentPlan:
    """Validate, store with a hash, audit. Raises tools.PlanRejected (nothing is stored then)."""
    tools.validate(dag)
    digest = dag.digest()
    nodes = {n.id: {"tool": n.tool, "label_zh": n.label_zh, "depends_on": n.depends_on, "status": "pending",
                    "tier_base": tools.base_tier(tools.TOOLS[n.tool].action), "result": None, "summary_zh": "", "body": None,
                    "approval": None, "readback_zh": "", "error": ""} for n in dag.nodes}
    plan = AgentPlan(session_id=session_id, customer_id=customer_id, utterance=text, trace_id=trace.current() or "",
                     dag_json={"dag": dag.model_dump(), "hash": digest},
                     state={"thread": uuid.uuid4().hex, "order": dag.order(), "nodes": nodes, "pending": None, "notice_zh": ""})
    s.add(plan)
    s.flush()
    _audit(s, plan, "agent_plan_created", method="mock planner (templates)", result="validated", utterance=text,
           dag=dag.model_dump(), dag_hash=digest, plan_id=plan.id, session_id=session_id)
    return plan


def record_rejection(s: Session, customer_id: int, text: str, reason: str, raw=None) -> None:
    svc.audit_step(s, "agent_plan_rejected", customer_id, actor="agent", method="validation", result=f"rejected: {reason}",
                   utterance=text, dag=raw)


def verify(s: Session, plan: AgentPlan) -> Dag:
    """The stored plan must still be the one that was validated and audited. Otherwise the plan is stopped."""
    try:
        dag = _dag(plan)
        tools.validate(dag)
        if dag.digest() != plan.dag_json["hash"]:
            raise tools.PlanRejected("计划和制定时不一样")
        row = s.exec(select(AgentAudit).where(AgentAudit.event == "agent_plan_created",
                                              AgentAudit.payload["plan_id"].as_integer() == plan.id)).first()
        if row is None or row.payload.get("dag_hash") != dag.digest():
            raise tools.PlanRejected("计划和审计记录里的不一样")
    except (tools.PlanRejected, ValueError, KeyError) as e:
        plan.status = "rejected"
        s.add(plan)
        trace.adopt(plan.trace_id)
        _audit(s, plan, "agent_plan_rejected", method="integrity check", result=f"rejected: {e}", plan_id=plan.id)
        s.commit()
        raise AgentError(409, f"计划被改动过，已经停下：{e}")
    return dag


# ---------- running ----------
def run_node(nid: str, plan_id: int, ask) -> None:
    """One graph node. Safe to run again from the top after a resume: before ask() it only reads and records its own state."""
    s = _S.get()
    plan = s.get(AgentPlan, plan_id)
    st = copy.deepcopy(plan.state)
    node = st["nodes"][nid]
    if plan.status in ENDED or plan.status == "failed" or node["status"] in SETTLED:
        return
    dnode = _dag(plan).node(nid)
    bad = [d for d in node["depends_on"] if st["nodes"][d]["status"] not in OK_DEPS]
    if bad:
        node.update(status="blocked", error=f"前面的步骤没完成：{'、'.join(bad)}")
        _save(s, plan, st)
        return
    ctx, tool = _ctx(s, plan, st, dnode), tools.TOOLS[node["tool"]]
    try:
        if tool.run:
            result, summary = tool.run(ctx)
            node.update(status="done", result=result, summary_zh=summary)
            _audit(s, plan, "agent_node_done", tier=classify("analysis", now=clock.now()), method="auto", result=summary, node_id=nid, tool=node["tool"])
        else:
            body = node["body"] or tool.prepare(ctx)
            if body is None:
                node.update(status="skipped", result={}, summary_zh="这一步用不上，跳过")
                _audit(s, plan, "agent_node_done", tier=_tier_of(node), method="auto", result="skipped: nothing to do", node_id=nid, tool=node["tool"])
            else:
                node.update(status="waiting", body=body)
                _save(s, plan, st)  # visible to the client before the graph pauses
                token = ask({"node_id": nid})  # pauses here; on resume returns the approved token
                if not token:
                    raise tools.ToolError(None, "没有收到批准")
                kind, out = tool.call(ctx, body, token)
                if kind != "ok":
                    raise tools.ToolError(None, "批准之后银行又要批准，已停下")
                result, summary = tool.done(ctx, body, out)
                node.update(status="done", result=result, summary_zh=summary)
                _audit(s, plan, "agent_node_done", tier=_tier_of(node), method="approved" if node["approval"] else "auto", result=summary,
                       node_id=nid, tool=node["tool"])
    except tools.ToolError as e:
        node.update(status="failed", error=e.detail)
        st["notice_zh"] = f"这一步没办成：{e.detail}。可以说「算了」撤销已经办的，或说「找人工」。"
        plan.status = "failed"
        _audit(s, plan, "agent_node_failed", tier=_tier_of(node), method="auto", result=f"failed: {e.detail}", node_id=nid, tool=node["tool"])
    _save(s, plan, st)


def ensure_approval(s: Session, plan: AgentPlan, nid: str) -> None:
    """Open (or reuse) the bank approval for the waiting node and store its read-back."""
    st = copy.deepcopy(plan.state)
    node = st["nodes"][nid]
    if node["status"] != "waiting":
        return
    ap = node["approval"] and s.get(BankApproval, node["approval"]["approval_id"])
    if ap and ap.status in ("pending", "approved"):
        return
    ctx, tool = _ctx(s, plan, st, _dag(plan).node(nid)), tools.TOOLS[node["tool"]]
    try:
        kind, view = tool.call(ctx, node["body"], None)  # no token: the bank only opens an approval
        if kind != "approval":
            raise tools.ToolError(None, "银行没有要求批准，已停下")
    except tools.ToolError as e:
        node.update(status="failed", error=e.detail)
        st["notice_zh"] = f"这一步没办成：{e.detail}。可以说「算了」撤销已经办的，或说「找人工」。"
        plan.status = "failed"
        _audit(s, plan, "agent_node_failed", tier=_tier_of(node), method="approval", result=f"failed: {e.detail}", node_id=nid, tool=node["tool"])
        return _save(s, plan, st)
    node["approval"] = {k: view[k] for k in ("approval_id", "tier", "tier_base", "reasons")}
    node["readback_zh"] = tool.readback(ctx, node["body"], view)
    _save(s, plan, st)
    _audit(s, plan, "agent_node_waiting", tier=_tier_of(node), method="approval", result="waiting for you", node_id=nid, tool=node["tool"],
           approval_id=view["approval_id"], readback_zh=node["readback_zh"])


def advance(s: Session, plan: AgentPlan, resume: str = "") -> None:
    """Run (or continue) the graph until the next approval or the end, then record where it stopped."""
    token = _S.set(s)
    try:
        pending = graph.run(plan.state["order"], plan.state["thread"], plan.id, run_node, resume)
    finally:
        _S.reset(token)
    st = copy.deepcopy(plan.state)
    st["pending"] = pending if plan.status != "failed" else None
    _save(s, plan, st)
    if plan.status == "failed":
        return
    if pending:
        ensure_approval(s, plan, pending)
        plan.status = "paused" if plan.paused else "waiting"
    else:
        plan.status = "done"
        _audit(s, plan, "agent_plan_done", method="auto", result="all steps finished")
    s.add(plan)



def _resume_if_needed(s: Session, plan: AgentPlan) -> None:
    """After a command changed node states: if the node the graph paused at no longer needs approval, let it move on."""
    st = plan.state
    p = st.get("pending")
    if plan.paused or not p or plan.status in ENDED:
        return
    if st["nodes"][p]["status"] == "waiting":
        ensure_approval(s, plan, p)  # (re)open the approval if the earlier one was declined or timed out
    else:
        advance(s, plan, "")


# ---------- the three entry points ----------
def message(s: Session, session_id: str, customer_id: int, text: str) -> dict:
    plan = latest(s, session_id)
    if cmd := planner_mock.command_of(text):
        if not plan:
            return {"session_id": session_id, "status": "question", "question_zh": "现在没有在办的事。", "nodes": [], "pending": None}
        return command(s, plan, cmd)
    if plan and plan.status not in ENDED:
        trace.adopt(plan.trace_id)
        v = view(s, plan)
        v["notice_zh"] = "上一件事还没办完。说「继续」接着办，或者说「算了」撤销。"
        return v
    result = planner_mock.plan(text)
    if isinstance(result, str):
        return {"session_id": session_id, "status": "question", "question_zh": result, "nodes": [], "pending": None}
    try:
        plan = create_plan(s, session_id, customer_id, text, result)
    except tools.PlanRejected as e:
        record_rejection(s, customer_id, text, str(e), result.model_dump())
        s.commit()  # the refusal is on the record although the request fails
        raise
    advance(s, plan)
    return view(s, plan)


def approve(s: Session, plan: AgentPlan, node_id: str, token: str) -> dict:
    """Resume the plan with an approved token. The bank judges the token (granted, this exact request, unused, in time)
    BEFORE the plan moves; a wrong token changes nothing."""
    verify(s, plan)
    trace.adopt(plan.trace_id)
    st = plan.state
    if plan.status in ENDED or plan.status == "failed":
        raise AgentError(409, "这件事已经结束了")
    if plan.paused:
        raise AgentError(409, "已暂停。先说「继续」。")
    node = st["nodes"].get(node_id)
    if not node or st.get("pending") != node_id or node["status"] != "waiting":
        raise AgentError(409, "现在等的不是这一步")
    ctx, tool = _ctx(s, plan, st, _dag(plan).node(node_id)), tools.TOOLS[node["tool"]]
    action, payload = tool.gate(ctx, node["body"])
    svc.check_token(s, ctx.cust, action, payload, token, spend=False)  # 403 + an audit row on any mismatch
    _audit(s, plan, "agent_command", method="approval token", result="resumed", node_id=node_id, command="approve")
    advance(s, plan, token)
    return view(s, plan)


def _undo(s: Session, plan: AgentPlan, st: dict, nid: str, failed: list[str]) -> None:
    node, dnode = st["nodes"][nid], _dag(plan).node(nid)
    if node["status"] == "done" and node["tool"] in tools.TOOLS and dnode.undo:
        try:
            note = tools.UNDO[dnode.undo["tool"]](_ctx(s, plan, st), node["result"])
        except tools.ToolError as e:
            failed.append(f"{node['label_zh']}（{e.detail}）")
            return
        node["status"] = "undone"
        _audit(s, plan, "agent_undo", tier=_tier_of(node), method="compensation", result=note, node_id=nid, tool=dnode.undo["tool"])
    elif node["status"] == "done":
        failed.append(f"{node['label_zh']}（钱已经转出，不能撤销）")
    elif node["status"] in ("pending", "waiting"):
        _revoke(s, plan, node)
        node["status"] = "dropped"


def _financing_branch(dag: Dag) -> set[str]:
    """The financing nodes plus every node that depends ONLY on them (a node that also needs something else stays)."""
    branch = {n.id for n in dag.nodes if n.tool in FINANCING}
    grew = True
    while grew:
        grew = False
        for n in dag.nodes:
            if n.id not in branch and n.depends_on and set(n.depends_on) <= branch:
                branch.add(n.id)
                grew = True
    return branch


def command(s: Session, plan: AgentPlan, name: str) -> dict:
    trace.adopt(plan.trace_id)
    if plan.status != "rejected":
        verify(s, plan)
    st = copy.deepcopy(plan.state)
    _audit(s, plan, "agent_command", method="command", result=name, command=name, node_id=st.get("pending"))
    closed = plan.status in ("cancelled", "handed_over", "rejected") or (plan.status in ("done", "failed") and name in ("等一下", "继续"))
    if closed:  # "算了" and "找人工" still work on a finished or failed plan: it may need undoing or a person
        st["notice_zh"] = "这件事已经结束了。" if plan.status != "failed" else "这件事出错了。可以说「算了」撤销，或说「找人工」。"
    elif name == "等一下":
        plan.paused, plan.status = True, "paused"
        st["notice_zh"] = "好的，先等一下。说「继续」再接着办。"
    elif name == "继续":
        plan.paused = False
        plan.status = "waiting" if st.get("pending") else "running"
        st["notice_zh"] = "好的，接着办。"
    elif name == "贷款先不要":
        branch, failed = _financing_branch(_dag(plan)), []
        for nid in reversed([x for x in st["order"] if x in branch]):
            _undo(s, plan, st, nid, failed)
        st["notice_zh"] = "好的，贷款先不办了，预留的钱还在。" + (f"有些没能撤销：{'；'.join(failed)}。" if failed else "")
    elif name == "算了":
        failed = []
        for nid in reversed(st["order"]):
            _undo(s, plan, st, nid, failed)
        plan.status, st["pending"] = "cancelled", None
        st["notice_zh"] = "好的，不办了，已经办的都撤销了。" + (f"有些没能撤销：{'；'.join(failed)}。" if failed else "")
    elif name == "找人工":
        for node in st["nodes"].values():
            _revoke(s, plan, node)
        _save(s, plan, st)
        h = AgentHandover(session_id=plan.session_id, plan_id=plan.id, trace_id=plan.trace_id, reason="user asked for a person",
                          dag_json=copy.deepcopy(plan.dag_json), state=copy.deepcopy(st), created_at=clock.now().isoformat())
        s.add(h)
        s.flush()
        plan.status, st["pending"], st["handover_id"] = "handed_over", None, h.id
        st["notice_zh"] = f"好的，已经转给人工，编号 {h.id}。"
        _audit(s, plan, "agent_handover", method="user", result=f"handed over as #{h.id}", handover_id=h.id, plan_id=plan.id,
               dag=plan.dag_json["dag"], steps={k: v["status"] for k, v in st["nodes"].items()})
    _save(s, plan, st)
    if name in ("继续", "贷款先不要"):
        _resume_if_needed(s, plan)
    return view(s, plan)


# ---------- what the client sees ----------
def view(s: Session, plan: AgentPlan) -> dict:
    st, nodes = plan.state, []
    for nid in st["order"]:
        n = st["nodes"][nid]
        ap = s.get(BankApproval, n["approval"]["approval_id"]) if n.get("approval") else None
        live = svc.approval_view(ap) if ap else None
        tier = (live or {}).get("tier") or n["tier_base"]
        nodes.append({
            "id": nid, "tool": n["tool"], "label_zh": n["label_zh"], "depends_on": n["depends_on"], "status": n["status"],
            "status_zh": STATUS_ZH[n["status"]], "tier": tier, "tier_base": n["tier_base"], "marker": MARKER[tier],
            "summary_zh": n["summary_zh"], "error": n["error"],
            "approval": {k: live[k] for k in ("approval_id", "status", "next", "tier", "reasons_zh", "requires_pin", "requires_cosigner")} if live else None,
        })
    p = st.get("pending")
    pending = {"node_id": p, "readback_zh": st["nodes"][p]["readback_zh"], "approval": next(n["approval"] for n in nodes if n["id"] == p)} if p else None
    return {"session_id": plan.session_id, "plan_id": plan.id, "trace_id": plan.trace_id, "status": plan.status, "paused": plan.paused,
            "utterance": plan.utterance, "notice_zh": st.get("notice_zh", ""), "nodes": nodes, "pending": pending,
            "handover_id": st.get("handover_id")}
