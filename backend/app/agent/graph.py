"""LangGraph skeleton: interrupt before yellow/red nodes, SQLite checkpointer."""
from app.agent.dag import Dag


def build_graph(dag: Dag):
    """Compile `dag` into a LangGraph StateGraph.

    Green nodes run straight through; yellow/red nodes use interrupt_before so the user (and co-signer for
    red + protection_mode) can approve, edit or decline. Checkpointer: langgraph SqliteSaver at settings.checkpoint_db.
    """
    # TODO: import langgraph lazily here; map node.base_tier -> interrupt_before; resume with approval token
    raise NotImplementedError
