from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from ..database import get_db
from ..models import Account, AccountStatus
from ..schemas.schemas import AccountOut
from ..config import MAX_ACCOUNTS
from ..services.qrcode_service import start_qr_login, check_login_status, finish_login, validate_cookies, check_cookies_visible, pseudo_finish, pseudo_status, pseudo_validate
import datetime

router = APIRouter(prefix="/api/accounts", tags=["accounts"])

@router.get("", response_model=list[AccountOut])
async def list_accounts(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Account).order_by(Account.created_at.desc()))
    return result.scalars().all()

@router.post("/check-all")
async def check_all_accounts(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Account).where(Account.status == AccountStatus.online))
    online_accounts = result.scalars().all()
    expired = []
    for acc in online_accounts:
        try:
            valid = await validate_cookies(acc.id)
            if not valid:
                acc.status = AccountStatus.expired
                expired.append(acc.name)
        except Exception:
            pass
    await db.commit()
    return {"checked": len(online_accounts), "expired": expired}

@router.post("", response_model=AccountOut)
async def create_account(name: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(func.count(Account.id)))
    count = result.scalar()
    if count >= MAX_ACCOUNTS:
        raise HTTPException(400, f"账号已达上限 {MAX_ACCOUNTS} 个")
    acc = Account(name=name)
    db.add(acc)
    await db.commit()
    await db.refresh(acc)
    return acc

@router.delete("/{account_id}")
async def delete_account(account_id: int, db: AsyncSession = Depends(get_db)):
    acc = await db.get(Account, account_id)
    if not acc:
        raise HTTPException(404, "账号不存在")
    await db.delete(acc)
    await db.commit()
    return {"ok": True}

@router.get("/{account_id}/qrcode")
async def get_qrcode(account_id: int, db: AsyncSession = Depends(get_db)):
    acc = await db.get(Account, account_id)
    if not acc:
        raise HTTPException(404, "账号不存在")
    result = await start_qr_login(account_id)
    return {"qr_image": result["qr_image"], "account_id": account_id, "status": result.get("status", "")}

@router.get("/{account_id}/qrcode/status")
async def get_qrcode_status(account_id: int):
    return await check_login_status(account_id)

@router.post("/{account_id}/bind")
async def bind_account(account_id: int, db: AsyncSession = Depends(get_db)):
    acc = await db.get(Account, account_id)
    if not acc:
        raise HTTPException(404, "账号不存在")

    result = await finish_login(account_id)
    if result.get("ok"):
        acc.status = AccountStatus.online
        acc.cookies = result.get("cookies", "")
        acc.channel_name = result.get('nickname', '')
        acc.last_login = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        await db.commit()
        return {"ok": True, "status": "online", "name": acc.name}
    pseudo = pseudo_finish(account_id)
    if pseudo.get("ok"):
        acc.status = AccountStatus.online
        acc.cookies = pseudo.get("cookies", "")
        acc.last_login = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        await db.commit()
        return {"ok": True, "status": "online", "name": acc.name}
    return {"ok": False, "error": result.get("error", "绑定失败")}

@router.post("/{account_id}/validate")
async def check_account_valid(account_id: int, db: AsyncSession = Depends(get_db)):
    acc = await db.get(Account, account_id)
    if not acc:
        raise HTTPException(404, "账号不存在")
    result = await check_cookies_visible(account_id)
    if not result["valid"] and acc.status == AccountStatus.online:
        acc.status = AccountStatus.expired
        await db.commit()
    return {"account_id": account_id, "valid": result["valid"], "status": acc.status.value, "nickname": result.get("nickname", "")}
