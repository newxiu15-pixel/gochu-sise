"""고추 공판장 시세 수집기.

    python collect.py              오늘 시세만 가져와 갱신 (매일 자동 실행)
    python collect.py --backfill   과거 글까지 훑어 1~2년치를 채운다 (처음 한 번)

수집한 값은 data/prices.json 한 파일에 쌓인다. DB 없음.
"""

import argparse
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sources import seoandong, seoandong_backup

KST = timezone(timedelta(hours=9))
DATA = Path(__file__).parent / "data" / "prices.json"
DOCS_DATA = Path(__file__).parent / "docs" / "prices.json"


def load():
    if DATA.exists():
        return json.loads(DATA.read_text(encoding="utf-8"))
    return {"updated": None, "markets": {}}


def save(store, status=None):
    """status 를 함께 남긴다.

    새 시세가 없는 날에도 status 는 매번 바뀌므로 파일이 항상 갱신된다.
    그래야 화면에서 '오늘 확인했다'는 사실을 아버지가 볼 수 있다.
    """
    now = datetime.now(KST).isoformat(timespec="seconds")
    store["updated"] = now
    if status is not None:
        status["checked"] = now
        store["status"] = status
    text = json.dumps(store, ensure_ascii=False, separators=(",", ":"))
    for path in (DATA, DOCS_DATA):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")


def _is_backup(items):
    return any(v.get("src") for v in items.values())


def merge(store, market_id, market_name, days):
    """수집한 날짜별 시세를 저장소에 합친다. 반환: 새로 들어온 날짜 수.

    게시판 값이 정확하다. 백업(농넷)은 게시판 값이 없는 날만 채운다.
    이 구분이 없으면 백업이 최고가·최저가가 담긴 기존 값을 밀어낸다.
    """
    market = store["markets"].setdefault(market_id, {"name": market_name, "days": {}})
    market["name"] = market_name
    before = set(market["days"])

    for date, items in days.items():
        cur = market["days"].get(date)
        if cur and _is_backup(items) and not _is_backup(cur):
            continue  # 이미 게시판 값이 있는 날은 건드리지 않는다
        market["days"][date] = items

    market["days"] = dict(sorted(market["days"].items()))
    return len(set(market["days"]) - before)


def run_daily():
    """게시판 1페이지(최근 20 경매일)를 확인한다. 며칠 걸러도 알아서 복구된다.

    게시판이 안 열리거나 표 모양이 바뀌면 농넷 API로 평균가만이라도 받아온다.
    둘 다 실패해야 오류로 끝난다.
    """
    store = load()
    board, backup = {}, {}
    errors = []

    try:
        board = seoandong.collect(pages=1, delay=0.4)
        print(f"게시판: {len(board)}일치")
    except Exception as e:
        errors.append(f"게시판: {e}")
        print(f"게시판 실패: {e}")

    try:
        today = datetime.now(KST)
        backup = seoandong_backup.collect(
            (today - timedelta(days=45)).strftime("%Y%m%d"), today.strftime("%Y%m%d")
        )
        print(f"농넷 백업: {len(backup)}일치")
    except Exception as e:
        errors.append(f"농넷: {e}")
        print(f"농넷 백업 실패: {e}")

    status = {
        "ok": bool(board or backup),
        "board": bool(board),
        "backup": bool(backup),
        "message": " / ".join(errors),
    }

    if not board and not backup:
        # 시세는 못 받았어도 상태는 반드시 남긴다. 화면이 빨간 경고를 띄우는 근거가 된다.
        save(store, status)
        print("두 경로 모두 실패. 상태만 기록한다.")
        return 1

    # 게시판 값이 정확하다. 백업은 게시판에 없는 날만 메운다.
    days = dict(backup)
    days.update(board)

    added = merge(store, seoandong.MARKET_ID, seoandong.MARKET_NAME, days)
    status["latest"] = max(days)
    save(store, status)
    print(f"수집 완료: 새로 {added}일 추가. 최신 {max(days)}")
    return 0 if status["board"] else 1  # 백업만 살아도 손볼 신호는 보낸다


def run_backfill(pages):
    store = load()
    total = 0
    for page in range(1, pages + 1):
        posts = seoandong.list_posts(page)
        if not posts:
            print(f"{page}페이지: 글 없음. 중단")
            break

        days = {}
        for wr_id, _ in posts:
            try:
                date, items = seoandong.fetch_post(wr_id)
            except Exception as e:  # 글 하나가 깨져도 전체가 멈추지 않게
                print(f"  글 {wr_id} 건너뜀: {e}")
                continue
            if date and items:
                days[date] = items
            time.sleep(0.4)

        added = merge(store, seoandong.MARKET_ID, seoandong.MARKET_NAME, days)
        total += added
        save(store)  # 중간에 끊겨도 여기까지는 남는다
        span = f"{min(days)} ~ {max(days)}" if days else "없음"
        print(f"{page}/{pages}페이지: {len(days)}건 ({span}), 새로 {added}일")

    all_days = store["markets"][seoandong.MARKET_ID]["days"]
    print(f"\n백필 완료: 총 {len(all_days)}일, 새로 {total}일 추가")
    print(f"보유 기간: {min(all_days)} ~ {max(all_days)}")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backfill", action="store_true", help="과거 글까지 수집")
    ap.add_argument("--pages", type=int, default=34, help="백필할 게시판 페이지 수 (1페이지=15일)")
    args = ap.parse_args()

    if args.backfill:
        return run_backfill(args.pages)
    return run_daily()


if __name__ == "__main__":
    sys.exit(main())
