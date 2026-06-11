// content.js
// 💡 로컬 테스트 시 "http://localhost:8000/api/detect/stream" 으로 변경하세요
const BACKEND_STREAM_URL = "https://api.yamyamee.me/api/detect/stream";
const textCache = new Map();
const inFlightTexts = new Set(); // 중복 전송 방지용 대기열
let scanTimer = null;
let currentLevel = 2; // 기본 강도 (2단계)

// 🚀 1. 크롬 스토리지에서 초기 레벨 불러오기 및 변경 감지
if (typeof chrome !== "undefined" && chrome.storage) {
  chrome.storage.local.get(["filterLevel"], (result) => {
    if (result.filterLevel) currentLevel = result.filterLevel;
  });

  // 팝업이나 UI에서 레벨이 변경되면 즉시 변수에 반영
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local" && changes.filterLevel) {
      currentLevel = changes.filterLevel.newValue;
      console.log(
        `[CleanWeb] 필터링 강도가 ${currentLevel}단계로 변경되었습니다.`,
      );
    }
  });
}

// 🚀 2. 레벨(1, 2, 3)을 서버가 이해하는 Threshold(0.95, 0.85, 0.60)로 변환
function getThreshold() {
  const thresholdMap = { 1: 0.95, 2: 0.85, 3: 0.6 };
  return thresholdMap[currentLevel] || 0.85;
}

// 📊 통계 수집용 객체
const filterStats = {
  totalScanned: 0,
  stage1Passed: 0,
  stage2TrieBlocked: 0,
  stage2AiBlocked: 0,
  stage2Clean: 0,
};

// 🎯 3. 타겟팅: 검사할 핵심 태그(댓글, 본문)만 콕 집어옵니다.
function getTargetElements() {
  const SELECTORS =
    ".usertxt, .u_cbox_contents, .yt-core-attributed-string, .comment-content, div[class*='xe_content'], .fdb_lst_ul .comment-content > div, td.comment .text_wrapper span.text";
  const elements = document.querySelectorAll(SELECTORS);
  const validElements = [];

  filterStats.totalScanned = elements.length;

  elements.forEach((el) => {
    if (el.dataset.cleanweb === "true") return;

    const text = el.innerText.trim();
    if (text.length >= 2 && !/^[^a-zA-Z가-힣]+$/.test(text)) {
      validElements.push({ element: el, text: text });
    }
  });

  filterStats.stage1Passed = validElements.length;
  return validElements;
}

// 🌊 4. 모아서 서버로 전송 (스트리밍 방식)
async function scanAndFilter() {
  const targetData = getTargetElements();
  const pendingElements = [];
  const textsToCheck = [];

  for (const item of targetData) {
    if (textCache.has(item.text)) {
      if (textCache.get(item.text).isInappropriate)
        applyMasking(item.element, item.text);
    } else if (!inFlightTexts.has(item.text)) {
      pendingElements.push(item);
      textsToCheck.push(item.text);
    }
  }

  const uniqueTexts = [...new Set(textsToCheck)];
  if (uniqueTexts.length === 0) return;

  uniqueTexts.forEach((t) => inFlightTexts.add(t));
  console.log(
    `[CleanWeb] 🌊 검사 요청: ${uniqueTexts.length}개 (Threshold: ${getThreshold()})`,
  );

  try {
    const response = await fetch(BACKEND_STREAM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        texts: uniqueTexts,
        extension_mode: true,
        threshold: getThreshold(), // 🚀 선택된 단계의 Threshold 값 전송!
      }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    let currentTrieBlocked = 0;
    let currentAiBlocked = 0;
    let currentBatchClean = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const jsonStr = line.substring(6);
            const res = JSON.parse(jsonStr);

            textCache.set(res.text, res);
            inFlightTexts.delete(res.text);

            if (res.isInappropriate) {
              const reasonStr = res.reason || "";
              if (
                reasonStr.includes("1단계") ||
                reasonStr.toLowerCase().includes("trie") ||
                reasonStr.includes("사전")
              ) {
                currentTrieBlocked++;
              } else {
                currentAiBlocked++;
              }

              pendingElements
                .filter((p) => p.text === res.text)
                .forEach((p) => applyMasking(p.element, p.text));
            } else {
              currentBatchClean++;
            }
          } catch (e) {}
        }
      }
    }

    filterStats.stage2TrieBlocked += currentTrieBlocked;
    filterStats.stage2AiBlocked += currentAiBlocked;
    filterStats.stage2Clean += currentBatchClean;

    printFilteringReport(
      uniqueTexts.length,
      currentTrieBlocked,
      currentAiBlocked,
      currentBatchClean,
    );
  } catch (e) {
    uniqueTexts.forEach((t) => inFlightTexts.delete(t));
  }
}

// 🚫 5. 태그 통째로 마스킹 처리 및 원본 보기 토글
function applyMasking(element, originalText) {
  if (element.dataset.cleanweb === "true") return;

  element.innerHTML = "";

  const span = document.createElement("span");
  span.style.color = "#cbd5e0";
  span.style.backgroundColor = "#2d3748";
  span.style.padding = "2px 4px";
  span.style.borderRadius = "4px";
  span.style.fontStyle = "italic";
  span.style.fontSize = "0.9em";
  span.style.cursor = "pointer";
  span.title = "클릭하면 원본을 확인합니다.";
  span.innerText = "🚫 [차단됨]"; // 💡 요청하신 문구로 변경 완료

  element.dataset.cleanweb = "true";
  span.dataset.revealed = "false";

  span.addEventListener("click", function (e) {
    e.stopPropagation();
    if (this.dataset.revealed === "false") {
      this.innerText = `⚠️ ${originalText}`;
      this.style.color = "#c53030";
      this.style.backgroundColor = "#fed7d7";
      this.style.textDecoration = "line-through";
      this.dataset.revealed = "true";
    } else {
      this.innerText = "🚫 [차단됨]";
      this.style.color = "#cbd5e0";
      this.style.backgroundColor = "#2d3748";
      this.style.textDecoration = "none";
      this.dataset.revealed = "false";
    }
  });

  element.appendChild(span);
}

// 📊 6. 통계 리포트 콘솔 출력 함수
function printFilteringReport(
  currentSent,
  currentTrieBlocked,
  currentAiBlocked,
  currentClean,
) {
  currentSent = currentSent || 0;
  currentTrieBlocked = currentTrieBlocked || 0;
  currentAiBlocked = currentAiBlocked || 0;
  currentClean = currentClean || 0;
  const s1Filtered = filterStats.totalScanned - currentSent;

  console.log(
    "%c🎯 [CleanWeb] 이번 1회차(1 Try) 상세 필터링 흐름",
    "color: #e53e3e; font-weight: bold; font-size: 14px;",
  );
  console.table({
    "1단계 (발견)": {
      내용: "화면에서 찾은 총 태그 수",
      개수: `${filterStats.totalScanned}개`,
    },
    "2단계 (프론트 컷)": {
      내용: "노이즈 제거 (ㅋㅋ, ㅎㅎ 등)",
      개수: `-${s1Filtered}개`,
    },
    "3단계 (서버 전송)": {
      내용: "서버로 실제 보낸 문장",
      개수: `${currentSent}개`,
    },
    "4단계 (Trie 컷)": {
      내용: "1차 Trie 비속어 사전 차단",
      개수: `-${currentTrieBlocked}개`,
    },
    "5단계 (AI 컷)": {
      내용: "2차 BERT 딥러닝 문맥 차단",
      개수: `-${currentAiBlocked}개`,
    },
    "최종 결과": {
      내용: "정상적으로 통과된 클린 문장",
      개수: `${currentClean}개`,
    },
  });
}

// 🎛️ 7. 플로팅 UI 추가 함수 (크롬 스토리지 연동 완료)
function injectLevelUI() {
  if (document.getElementById("cleanweb-floating-ui")) return;

  const container = document.createElement("div");
  container.id = "cleanweb-floating-ui";
  container.style.cssText = `
    position: fixed; bottom: 20px; right: 20px;
    background-color: rgba(30, 41, 59, 0.95); color: white;
    padding: 15px 20px; border-radius: 12px;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
    z-index: 2147483647; font-family: 'Pretendard', sans-serif;
    width: 220px; backdrop-filter: blur(4px); border: 1px solid rgba(255, 255, 255, 0.1);
  `;

  const title = document.createElement("div");
  title.innerText = "🛡️ 화면 필터링 강도";
  title.style.fontWeight = "bold";
  title.style.fontSize = "14px";
  title.style.marginBottom = "10px";

  const levelLabels = {
    1: "1단계 - 약한 필터링",
    2: "2단계 - 중간 필터링",
    3: "3단계 - 강한 필터링",
  };

  const label = document.createElement("div");
  label.innerText = levelLabels[currentLevel];
  label.style.fontSize = "13px";
  label.style.color = "#94a3b8";
  label.style.marginBottom = "12px";
  label.style.textAlign = "center";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "1";
  slider.max = "3";
  slider.value = currentLevel;
  slider.style.width = "100%";
  slider.style.cursor = "pointer";

  slider.addEventListener("input", (e) => {
    const newLevel = parseInt(e.target.value);
    label.innerText = levelLabels[newLevel];
    // 변경된 값을 크롬 스토리지에 저장 (저장하면 상단의 onChanged 리스너가 받아서 currentLevel 업데이트)
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({ filterLevel: newLevel });
    } else {
      currentLevel = newLevel; // 확장 프로그램 환경이 아닐 때를 위한 예외 처리
    }
  });

  container.appendChild(title);
  container.appendChild(label);
  container.appendChild(slider);
  document.body.appendChild(container);
}

// 🚀 8. 최초 실행 및 화면 감시자
setTimeout(() => {
  scanAndFilter();
  injectLevelUI();
}, 1000);

const observer = new MutationObserver((mutations) => {
  let shouldScan = false;
  for (const mutation of mutations) {
    if (mutation.addedNodes.length > 0) shouldScan = true;
  }
  if (shouldScan) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => scanAndFilter(), 1000);
  }
});
observer.observe(document.body, { childList: true, subtree: true });
