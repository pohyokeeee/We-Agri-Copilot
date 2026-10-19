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

    # which OpenAI-compatible provider answers chat and speech-to-text. dashscope = Qwen (production); groq = stand-in for the demo.
    # Each provider has its own key: a key is never sent to the other provider.
    llm_provider: Literal["dashscope", "groq"] = "dashscope"
    groq_api_key: str = ""
    groq_base_url: str = "https://api.groq.com/openai/v1"
    groq_planner: str = "openai/gpt-oss-120b"
    groq_classifier: str = "openai/gpt-oss-20b"
    groq_asr: str = "whisper-large-v3-turbo"

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
    # demo clock: "today" for all date logic (Asia/Shanghai); empty = real date
    demo_today: str = "2026-07-25"
    llm_cache_dir: str = (BACKEND_DIR / "data" / "llm_cache").as_posix()
    tts_cache_dir: str = (BACKEND_DIR / "data" / "tts_cache").as_posix()

    # the selected provider's values: the rest of the code reads these, never the per-provider fields
    @property
    def provider_name(self) -> str:
        return "Groq" if self.llm_provider == "groq" else "DashScope"

    @property
    def llm_key(self) -> str:
        return self.groq_api_key if self.llm_provider == "groq" else self.dashscope_api_key

    @property
    def llm_base_url(self) -> str:
        return self.groq_base_url if self.llm_provider == "groq" else self.dashscope_base_url

    @property
    def llm_planner(self) -> str:
        return self.groq_planner if self.llm_provider == "groq" else self.qwen_planner

    @property
    def llm_classifier(self) -> str:
        return self.groq_classifier if self.llm_provider == "groq" else self.qwen_classifier

    @property
    def llm_asr(self) -> str:
        return self.groq_asr if self.llm_provider == "groq" else self.qwen_asr


settings = Settings()
