"""공판장별 수집 어댑터.

새 공판장을 붙일 때는 이 폴더에 파일 하나를 추가하고
MARKET_ID / MARKET_NAME / collect() 세 가지만 맞추면 된다.

    MARKET_ID   저장소 키로 쓸 영문 이름
    MARKET_NAME 화면에 뜰 공판장 이름
    collect()   {날짜: {품종: {high, low, avg, volume, unit}}} 반환

현재 연결된 곳
    seoandong  서안동농협 고추공판장
"""
