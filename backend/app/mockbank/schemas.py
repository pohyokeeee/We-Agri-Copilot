from pydantic import BaseModel, Field

PIN = Field(pattern=r"^\d{6}$")


class TransferIn(BaseModel):
    customer_id: int = 1
    payee_id: int
    amount: float = Field(gt=0)
    purpose: str = Field("", max_length=40)  # untrusted free text (from voice); part of what the token binds
    approval_token: str | None = None


class ReadbackIn(BaseModel):
    customer_id: int = 1
    payee_id: int
    amount: float = Field(gt=0)
    purpose: str = Field("", max_length=40)
    spoken_as: str | None = Field(None, max_length=20)  # what the user called the payee, e.g. 老李


class PlanIn(BaseModel):
    customer_id: int = 1
    category: str = "supplier_honey"  # which recurring purchase to repeat "like last year"
    purpose: str = "蜂蜜钱"


class ReserveIn(BaseModel):
    customer_id: int = 1
    label: str = ""
    amount: float = Field(gt=0)
    approval_token: str | None = None


class OrdersImportIn(BaseModel):
    csv: str  # raw CSV text in the platform's own export format


class MfaChallengeIn(BaseModel):
    approval_id: int


class MfaVerifyIn(BaseModel):
    approval_id: int
    challenge: str
    pin: str = PIN


class CosignApproveIn(BaseModel):
    cosigner_id: int
    pin: str = PIN


class CosignDeclineIn(BaseModel):
    cosigner_id: int


class LockIn(BaseModel):
    customer_id: int = 1


class UnlockIn(BaseModel):
    customer_id: int = 1
    approval_token: str | None = None
