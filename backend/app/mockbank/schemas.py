from pydantic import BaseModel, Field

PIN = Field(pattern=r"^\d{6}$")


class TransferIn(BaseModel):
    customer_id: int = 1
    payee_id: int
    amount: float = Field(gt=0)
    approval_token: str | None = None


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


class CosignIn(BaseModel):
    cosigner_id: int
    pin: str = PIN
    approve: bool = True


class LockIn(BaseModel):
    customer_id: int = 1


class UnlockIn(BaseModel):
    customer_id: int = 1
    approval_token: str | None = None
