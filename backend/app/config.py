from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    # later files win: backend/.env overrides repo-root .env
    model_config = SettingsConfigDict(
        env_file=(BACKEND_DIR.parent / ".env", BACKEND_DIR / ".env"), extra="ignore"
    )

    database_url: str = f"sqlite:///{(BACKEND_DIR / 'data' / 'app.db').as_posix()}"
    checkpoint_db: str = (BACKEND_DIR / "data" / "checkpoints.db").as_posix()

    # which OpenAI-compatible provider answers chat and speech-to-text. dashscope = Qwen (production); groq = stand-in for the demo;
    # ollama = a Qwen model on this machine (free, chat only: no speech). Each provider has its own key: a key is never sent to the other provider.
    llm_provider: Literal["dashscope", "groq", "ollama"] = "dashscope"
    groq_api_key: str = ""
    groq_base_url: str = "https://api.groq.com/openai/v1"
    groq_planner: str = "openai/gpt-oss-120b"
    groq_classifier: str = "openai/gpt-oss-20b"
    groq_asr: str = "whisper-large-v3-turbo"

    ollama_base_url: str = "http://localhost:11434/v1"
    ollama_planner: str = "qwen2.5:7b"
    ollama_classifier: str = "qwen2.5:7b"  # same model as the planner: a second one would not fit next to it in a 6 GB GPU

    dashscope_api_key: str = ""
    dashscope_base_url: str = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
    qwen_planner: str = "qwen-plus"
    qwen_classifier: str = "qwen-flash"
    qwen_asr: str = "qwen-audio-3.0-asr-flash"
    qwen_tts: str = "qwen3-tts-flash"
    tts_voice: str = "Cherry"
    llm_timeout: float = 10.0  # seconds, for every model call
    llm_mock: bool = False
    # browsers allowed to call the API (the H5 preview). Explicit origins (e.g. a tunnel URL), comma separated, plus a regex that
    # by default admits only localhost and private-LAN addresses on the preview port. Never "*".
    cors_origins: str = ""
    cors_origin_regex: str = r"^http://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+):10086$"
    # 1 = anyone who can reach the API may reset the demo (a shared demo server). Off: only requests from this machine can.
    demo_public: bool = False
    demo_per_minute: int = 20  # paid model calls per IP per minute, public demo only
    demo_daily_cap: int = 500  # paid model calls per day in total, public demo only
    # the built website, served by the backend when present (the Docker image copies web/dist here)
    web_dist: str = (BACKEND_DIR.parent / "web" / "dist").as_posix()
    # demo clock: "today" for all date logic (Asia/Shanghai); empty = real date
    demo_today: str = "2026-07-25"
    llm_cache_dir: str = (BACKEND_DIR / "data" / "llm_cache").as_posix()
    tts_cache_dir: str = (BACKEND_DIR / "data" / "tts_cache").as_posix()

    # the selected provider's values: the rest of the code reads these, never the per-provider fields
    @property
    def provider_name(self) -> str:
        return {"groq": "Groq", "ollama": "Ollama"}.get(self.llm_provider, "DashScope")

    @property
    def llm_key(self) -> str:
        if self.llm_provider == "ollama":
            return "ollama"  # a local server needs no key; the OpenAI client only wants a non-empty string
        return self.groq_api_key if self.llm_provider == "groq" else self.dashscope_api_key

    @property
    def llm_base_url(self) -> str:
        return {"groq": self.groq_base_url, "ollama": self.ollama_base_url}.get(self.llm_provider, self.dashscope_base_url)

    @property
    def llm_planner(self) -> str:
        return {"groq": self.groq_planner, "ollama": self.ollama_planner}.get(self.llm_provider, self.qwen_planner)

    @property
    def llm_classifier(self) -> str:
        return {"groq": self.groq_classifier, "ollama": self.ollama_classifier}.get(self.llm_provider, self.qwen_classifier)

    @property
    def llm_asr(self) -> str:
        return {"groq": self.groq_asr, "ollama": ""}.get(self.llm_provider, self.qwen_asr)  # Ollama has no speech-to-text


settings = Settings()
