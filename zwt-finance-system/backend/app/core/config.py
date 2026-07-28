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
    # 四份模板与泰文字体都随应用发布，默认指向仓库里的 assets，clone 下来即可
    # 出票，不需要另外准备运行期文件。业务换版式时用 ZWT_*_TEMPLATE_PATH 覆盖。
    #
    # TAX INV 的 xlsx 与 PDF 底版是一对：底版的叠加坐标是从这份 xlsx 制版量出来
    # 的，pdf_layout.py 里记着它的 sha256。覆盖 xlsx 而不重新制版，两份交付物会
    # 印出不同的数字，所以 Initialize-ZwtDev.ps1 会校验这个校验和。
    wht_template_path: Path = (
        Path(__file__).parents[1] / "assets" / "templates" / "WHT-Template.xlsx"
    )
    wht_pdf_template_path: Path = (
        Path(__file__).parents[1] / "assets" / "templates" / "WHT-Template.pdf"
    )
    tax_invoice_template_path: Path = (
        Path(__file__).parents[1] / "assets" / "templates" / "TAX-INV-Template.xlsx"
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
    bootstrap_admin_username: str = "admin"

    # 会话：滑动过期 8 小时（覆盖一个完整工作日的连续操作），绝对上限 12 小时，
    # 之后无论多活跃都必须重新登录。Cookie 只在同源的 /api 下发送。
    session_idle_minutes: int = Field(default=480, ge=5, le=1440)
    session_absolute_minutes: int = Field(default=720, ge=15, le=10080)
    session_cookie_name: str = "zwt_session"
    csrf_cookie_name: str = "zwt_csrf"
    # 开发期 Vite 走 http://127.0.0.1:5273，Secure Cookie 不会被发送；
    # 生产由 Caddy 提供 HTTPS，必须置 true。随 environment 自动切换，
    # 需要在本机测 HTTPS 时可显式覆盖。
    session_cookie_secure: bool | None = None

    @property
    def cookies_require_https(self) -> bool:
        if self.session_cookie_secure is not None:
            return self.session_cookie_secure
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
