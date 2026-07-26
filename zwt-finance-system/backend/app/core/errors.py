"""跨模块共用的业务异常基类。

main.py 只为 ServiceError 注册一个处理器，子类靠 status_code 决定响应码。
放在 core 是为了让 auth 这类与业务模块无关的代码不必去继承 WHT 的异常。
"""


class ServiceError(RuntimeError):
    status_code = 400


class AuthenticationError(ServiceError):
    status_code = 401


class AuthorizationError(ServiceError):
    status_code = 403
