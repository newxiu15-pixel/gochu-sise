"""서안동 공판장 시세 — 두 번째 경로 (농넷 API).

게시판(seoandong.py)이 주 소스다. 이 파일은 게시판이 열리지 않거나
표 모양이 바뀌어 파싱이 깨졌을 때를 위한 대비책이다.

농넷은 최근 30 경매일치 품종별 평균단가만 준다. 최고가·최저가는 없다.
그래도 평균가와 그래프는 끊기지 않으니 아무것도 못 보는 상황은 면한다.
"""

import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

API = "https://www.nongnet.or.kr/front/M000000204/marketInfo/jsonSeoanSpcsDaily.do"
REFERER = "https://www.nongnet.or.kr/front/M000000204/marketInfo/seoan.do"
TIMEOUT = 25

# 농넷 품종명을 게시판 표기에 맞춘다.
# 농넷은 하우스/노지를 나누지 않아 '화건 손꼭무' 하나로 합쳐 들어온다.
RENAME = {
    "화건(손꼭무)": "화건 손꼭무",
    "화건(꼭무)": "화건 꼭무",
    "청양(손꼭무)": "청양 손꼭무",
    "청양(꼭무)": "청양 꼭무",
}


def collect(start_ymd, end_ymd):
    """반환: {날짜: {품종: {high:None, low:None, avg, volume, unit}}}"""
    r = requests.post(
        API,
        data={"searchStartDt": start_ymd, "searchEndDt": end_ymd, "searchSpcs": ""},
        headers={"X-Requested-With": "XMLHttpRequest", "Referer": REFERER},
        timeout=TIMEOUT,
        verify=False,
    )
    r.raise_for_status()
    data = r.json()
    if data.get("errorCode") != "000":
        raise RuntimeError(f"농넷 응답 오류: {data.get('errorMessage')}")

    days = {}
    for row in data.get("priceList", []):
        ymd = row["autiYmd"]
        date = f"{ymd[:4]}-{ymd[4:6]}-{ymd[6:]}"
        name = RENAME.get(row["spcsNm"], row["spcsNm"])
        days.setdefault(date, {})[name] = {
            "high": None,
            "low": None,
            "avg": round(row["avrgPrce"]),
            "volume": row.get("tkinVolm"),
            "unit": "근",
            "src": "농넷",  # 게시판 값과 구분하려고 남긴다
        }
    return days
