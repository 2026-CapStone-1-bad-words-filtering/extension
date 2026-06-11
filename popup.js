document.addEventListener("DOMContentLoaded", () => {
  const levelInput = document.getElementById("level");
  const levelText = document.getElementById("levelText");
  const levelDesc = document.getElementById("levelDesc");

  const levels = {
    1: {
      name: "순한맛 (1단계)",
      desc: "아주 심한 욕설만 차단합니다. (Threshold 0.95)",
    },
    2: {
      name: "보통맛 (2단계)",
      desc: "기본적인 비속어와 악플을 차단합니다. (Threshold 0.85)",
    },
    3: {
      name: "매운맛 (3단계)",
      desc: "조금이라도 공격적이면 모두 차단합니다. (Threshold 0.70)",
    },
  };

  // 1. 기존 설정 불러오기 (기본값 2)
  chrome.storage.local.get(["filterLevel"], (result) => {
    const savedLevel = result.filterLevel || 2;
    levelInput.value = savedLevel;
    levelText.innerText = levels[savedLevel].name;
    levelDesc.innerText = levels[savedLevel].desc;
  });

  // 2. 슬라이더 변경 시 저장
  levelInput.addEventListener("input", (e) => {
    const newLevel = parseInt(e.target.value);
    levelText.innerText = levels[newLevel].name;
    levelDesc.innerText = levels[newLevel].desc;

    chrome.storage.local.set({ filterLevel: newLevel });
  });
});
