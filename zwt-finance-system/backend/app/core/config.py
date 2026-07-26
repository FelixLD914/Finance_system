from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(Path(__file__).parents[3] / ".env", ".env"),
        env_prefix="ZWT_",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "ZWT Finance API"
    environment: str = "development"
    api_prefix: str = "/api"
    api_host: str = "127.0.0.1"
    # BOI 系统占用 8000，ZWT 一律使用 "BOI + 100" 偏移，两套系统可同机并行。
    api_port: int = Field(default=8100, ge=1024, le=65535)
    api_workers: int = Field(default=1, ge=1, le=4)
    database_url: str = "postgresql+psycopg://zwt_finance_app:change-me@127.0.0.1:5432/zwt_finance"
    attachment_root: Path = Path(r"D:\ZWTFinance\data\attachments")
    wht_template_path: Path = Path(r"D:\ZWTFinance\data\templates\WHT-Template.xlsx")
    wht_pdf_template_path: Path = (
        Path(__file__).parents[1] / "assets" / "templates" / "WHT-Template.pdf"
    )
    tax_invoice_template_path: Path = (
        Path(r"D:\ZWTFinance\data\templates\TAX-INV-Template.xlsx")
    )
    tax_invoice_pdf_template_path: Path = (
        Path(__file__).parents[1] / "assets" / "templates" / "TAX-INV-Template.pdf"
    )
    thai_font_path: Path = (
        Path(__file__).parents[1] / "assets" / "fonts" / "Sarabun-Regular.ttf"
    )
    max_file_mib: int = Field(default=20, ge=1, le=20)
    log_level: str = "INFO"
    bot_api_base_url: str = "https://gateway.api.bot.or.th"
    bot_api_endpoint: str = "/Stat-ExchangeRate/v2/DAILY_AVG_EXG_RATE/"
    bot_api_key: str = ""
    bootstrap_admin_display_name: str = "系统管理员"


@lru_cache
def get_settings() -> Settings:
    return Settings()
