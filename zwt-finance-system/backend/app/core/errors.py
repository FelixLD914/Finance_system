"""跨模块共用的业务异常基类。

main.py 只为 ServiceError 注册一个处理器，子类靠 status_code 决定响应码。
放在 core 是为了让 auth 这类与业务模块无关的代码不必去继承 WHT 的异常。
"""


class ServiceError(RuntimeError):
    status_code = 400

    def __init__(self, message: str, *, issues: list[dict[str, object]] | None = None) -> None:
        """issues 用于逐条列出问题，例如批量导入里每一行的冲突原因。

        留空时响应体与以前完全一致（只有 detail），所以既有调用方不用改。
        带上时 main.py 的处理器会把它一起序列化出去，前端才能把错误落到
        具体某一行，而不是只给一句「导入失败」让人自己去表里翻。
        """
        super().__init__(message)
        self.issues = issues or []


class AuthenticationError(ServiceError):
    status_code = 401


class AuthorizationError(ServiceError):
    status_code = 403
