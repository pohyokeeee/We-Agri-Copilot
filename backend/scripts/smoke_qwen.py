"""The old name of scripts/smoke_llm.py, kept as an alias: python scripts\\smoke_qwen.py  (or -m scripts.smoke_qwen)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.smoke_llm import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
