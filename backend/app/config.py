from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    # later files win: backend/.env overrides repo-root .env
    model_config = SettingsConfigDict(
        env_file=(BACKEND_DIR.parent / ".env", BACKEND_DIR / ".env"), extra="ignore"
    )

    database_url: str = f"sqlite:///{(BACKEND_DIR / 'data' / 'app.db').as_posix()}"
    checkpoint_db: str = (BACKEND_DIR / "data" / "checkpoints.db").as_posix()

    dashscope_api_key: str = ""
    dashscope_base_url: str = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
    qwen_planner: str = "qwen-plus"
    qwen_classifier: str = "qwen-flash"
    llm_mock: bool = False
    # demo clock: "today" for all date logic (Asia/Shanghai); empty = real date
    demo_today: str = "2026-07-25"
    llm_cache_dir: str = (BACKEND_DIR / "data" / "llm_cache").as_posix()


settings = Settings()
