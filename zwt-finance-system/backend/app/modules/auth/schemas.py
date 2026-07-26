from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class ApiSchema(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
        serialize_by_alias=True,
    )


class LoginRequest(ApiSchema):
    username: str = Field(min_length=1, max_length=80)
    # 上限 1024 是为了防止超长输入把 scrypt 派生变成计算炸弹；
    # 下限不设人为门槛，弱口令由管理员建号时把关。
    password: str = Field(min_length=1, max_length=1024)


class CurrentUserResponse(ApiSchema):
    username: str
    display_name: str
    role: str
    permissions: list[str]


class LogoutResponse(ApiSchema):
    revoked: int
