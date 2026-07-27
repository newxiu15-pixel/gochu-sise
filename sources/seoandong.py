"""서안동농협 고추공판장 시세 수집.

출처: https://s-andong.com 농산물공판장 > 고추가격시세 게시판
매일 경매 후 품종별 최고가/최저가/출하물량/평균단가가 표로 올라온다.
"""

import re
import time

import requests
import urllib3
from bs4 import BeautifulSoup

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

MARKET_ID = "seoandong"
MARKET_NAME = "서안동농협 고추공판장"

BASE = "https://s-andong.com/board/index.php"
LIST_URL = BASE + "?doc=program/board.php&bo_table=newm33"
VIEW_URL = BASE + "?doc=program/board.php&bo_table=newm33&wr_id={}"

# 게시판이 CP949 이고 중간 인증서가 빠져 있어 verify=False 로 접근한다.
ENCODING = "cp949"
TIMEOUT = 25

TITLE_RE = re.compile(r"(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*고추시세")
NUM_RE = re.compile(r"[\d,]+")

# 건고추는 근, 홍고추류는 kg 단위로 거래된다.
KG_ITEMS = ("홍고추", "홍청양")


def _fetch(url):
    r = requests.get(url, timeout=TIMEOUT, verify=False)
    r.raise_for_status()
    r.encoding = ENCODING
    return r.text


def _num(text):
    """'13,300 원' -> 13300 / '원' -> None (그날 출하 없음)"""
    m = NUM_RE.search(text or "")
    if not m:
        return None
    return int(m.group().replace(",", ""))


def list_posts(page=1):
    """게시판 목록에서 (wr_id, 날짜) 쌍을 뽑는다. 날짜는 'YYYY-MM-DD'."""
    html = _fetch(LIST_URL + f"&page={page}")
    out = []
    for wr_id, label in re.findall(r"wr_id=(\d+)[^>]*>(.{0,80}?)</a>", html, re.S):
        m = TITLE_RE.search(re.sub(r"<[^>]+>", "", label))
        if m:
            y, mo, d = m.groups()
            date = f"{y}-{int(mo):02d}-{int(d):02d}"
            pair = (int(wr_id), date)
            if pair not in out:
                out.append(pair)
    return out


def parse_post(html):
    """게시글 HTML에서 날짜와 품종별 시세를 뽑는다.

    반환: (date, {품종명: {high, low, avg, volume, unit}}) 또는 (None, {})
    """
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(" ", strip=True)

    m = TITLE_RE.search(text)
    if not m:
        return None, {}
    y, mo, d = m.groups()
    date = f"{y}-{int(mo):02d}-{int(d):02d}"

    items = {}
    for row in soup.find_all("tr"):
        # 중첩 테이블이라 자식 셀만 본다. 안 그러면 표 전체가 한 칸으로 잡힌다.
        cells = [c.get_text(" ", strip=True) for c in row.find_all(["td", "th"], recursive=False)]
        if len(cells) < 5:
            continue
        name = cells[0]
        # 시세 행은 첫 칸이 품종명, 이어서 최고/최저/물량/평균이 온다.
        if not name or len(name) > 20 or name == "품종별":
            continue
        if not any(k in name for k in ("화건", "청양", "양건", "고추")):
            continue

        high, low, volume, avg = (_num(c) for c in cells[1:5])
        if high is None and low is None and avg is None:
            continue  # 그날 출하가 없던 품종

        items[name] = {
            "high": high,
            "low": low,
            "avg": avg,
            "volume": volume,
            "unit": "kg" if name.startswith(KG_ITEMS) else "근",
        }

    return date, items


def fetch_post(wr_id):
    """글 하나를 받아 파싱한다."""
    return parse_post(_fetch(VIEW_URL.format(wr_id)))


def collect(pages=1, delay=0.5):
    """최근 글들을 수집한다. 반환: {날짜: {품종: 시세}}"""
    result = {}
    for page in range(1, pages + 1):
        for wr_id, _ in list_posts(page):
            date, items = fetch_post(wr_id)
            if date and items:
                result[date] = items
            time.sleep(delay)
    return result
