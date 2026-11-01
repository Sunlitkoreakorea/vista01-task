import { STUDY, PRACTICE, STIMULI } from "./stimuli.mjs";
import {
  ACTIVE_SESSION_KEY,
  classifyResponse,
  checksum,
  isValidCode,
  loadSessions,
  makeSession,
  normalizeCode,
  removeSession,
  rowsToCsv,
  saveSession,
  sessionRows,
} from "./logic.mjs";

const elements = Object.fromEntries([
  "welcome-screen", "instruction-screen", "trial-screen", "practice-complete-screen", "complete-screen",
  "start-form", "participant-code", "consent-check", "start-error", "resume-panel", "resume-detail",
  "resume-button", "discard-button", "practice-button", "experiment-button", "trial-kicker", "trial-title",
  "progress-text", "progress-bar", "stimulus-video", "video-gate", "play-button", "countdown", "played-badge",
  "choice-panel", "confidence-panel", "confidence-range", "confidence-output", "next-button", "trial-error",
  "receipt-code", "download-button", "new-session-button",
].map((id) => [id, document.getElementById(id)]));

const screens = ["welcome-screen", "instruction-screen", "trial-screen", "practice-complete-screen", "complete-screen"];
let session = null;
let currentTrial = null;
let practiceMode = false;
let videoEndedAt = null;
let choiceLocked = false;
let countdownTimer = null;

function showScreen(id) {
  for (const screen of screens) elements[screen].hidden = screen !== id;
  window.scrollTo({ top: 0, behavior: "instant" });
}

function setError(element, message = "") {
  element.textContent = message;
  element.hidden = !message;
}

function save() {
  if (session) saveSession(session);
}

function getActiveIncompleteSession() {
  const activeId = localStorage.getItem(ACTIVE_SESSION_KEY);
  const active = activeId ? loadSessions()[activeId] : null;
  return active && !active.completedAt ? active : null;
}

function renderResume() {
  const active = getActiveIncompleteSession();
  elements["resume-panel"].hidden = !active;
  elements["start-form"].hidden = Boolean(active);
  if (active) {
    elements["resume-detail"].textContent = `${active.participantCode} / ${active.responses.length}개 응답 저장됨`;
  }
}

function routeSession() {
  if (!session.instructionSeen) {
    showScreen("instruction-screen");
  } else if (!session.practiceComplete) {
    startPractice();
  } else if (session.pending) {
    restorePendingChoice();
  } else if (session.currentIndex < session.assignedTrials.length) {
    startMainTrial();
  } else {
    finishSession();
  }
}

elements["start-form"].addEventListener("submit", (event) => {
  event.preventDefault();
  const code = normalizeCode(elements["participant-code"].value);
  if (!isValidCode(code)) {
    setError(elements["start-error"], "영문, 숫자, 하이픈만 사용해 4자 이상 입력해 주세요.");
    return;
  }
  if (!elements["consent-check"].checked) {
    setError(elements["start-error"], "연구 참여 확인란을 선택해 주세요.");
    return;
  }
  const duplicate = Object.values(loadSessions()).find((item) => item.participantCode === code && item.completedAt);
  if (duplicate) {
    setError(elements["start-error"], "이 참가자 코드는 이미 완료되었습니다. 연구자에게 문의해 주세요.");
    return;
  }
  session = makeSession(code, STIMULI, STUDY);
  save();
  setError(elements["start-error"]);
  showScreen("instruction-screen");
});

elements["resume-button"].addEventListener("click", () => {
  session = getActiveIncompleteSession();
  if (session) routeSession();
});

elements["discard-button"].addEventListener("click", () => {
  const active = getActiveIncompleteSession();
  if (!active || !confirm("진행 중인 응답을 완전히 삭제할까요?")) return;
  removeSession(active.sessionId);
  renderResume();
});

elements["practice-button"].addEventListener("click", () => {
  session.instructionSeen = true;
  save();
  startPractice();
});

elements["experiment-button"].addEventListener("click", startMainTrial);

function startPractice() {
  practiceMode = true;
  currentTrial = { ...PRACTICE, condition: "practice", sourceIndex: -1 };
  prepareTrial();
}

function startMainTrial() {
  practiceMode = false;
  currentTrial = session.assignedTrials[session.currentIndex];
  prepareTrial();
}

function prepareTrial() {
  choiceLocked = false;
  videoEndedAt = null;
  elements["trial-title"].textContent = "사건의 순서를 관찰해 주세요.";
  elements["choice-panel"].hidden = true;
  elements["confidence-panel"].hidden = true;
  elements["played-badge"].hidden = true;
  elements["video-gate"].hidden = false;
  elements["play-button"].hidden = false;
  elements.countdown.hidden = true;
  setError(elements["trial-error"]);
  elements["stimulus-video"].controls = false;
  elements["stimulus-video"].src = currentTrial.video;
  elements["stimulus-video"].load();
  elements["choice-panel"].querySelectorAll("button[data-response]").forEach((button) => {
    button.disabled = false;
    button.classList.remove("selected");
  });

  if (practiceMode) {
    elements["trial-kicker"].textContent = "연습 시행";
    elements["progress-text"].textContent = "연습";
    elements["progress-bar"].style.width = "0%";
  } else {
    const position = session.currentIndex + 1;
    elements["trial-kicker"].textContent = "본 실험";
    elements["progress-text"].textContent = `${position} / ${session.assignedTrials.length}`;
    elements["progress-bar"].style.width = `${((position - 1) / session.assignedTrials.length) * 100}%`;
  }
  showScreen("trial-screen");
}

elements["play-button"].addEventListener("click", async () => {
  elements["play-button"].hidden = true;
  let count = 3;
  elements.countdown.textContent = count;
  elements.countdown.hidden = false;
  countdownTimer = window.setInterval(async () => {
    count -= 1;
    if (count > 0) {
      elements.countdown.textContent = count;
      return;
    }
    window.clearInterval(countdownTimer);
    elements.countdown.hidden = true;
    elements["video-gate"].hidden = true;
    try {
      elements["stimulus-video"].currentTime = 0;
      await elements["stimulus-video"].play();
    } catch {
      elements["video-gate"].hidden = false;
      elements["play-button"].hidden = false;
      setError(elements["trial-error"], "영상을 재생하지 못했습니다. 브라우저 설정을 확인한 뒤 다시 시도해 주세요.");
    }
  }, 650);
});

elements["stimulus-video"].addEventListener("ended", () => {
  videoEndedAt = performance.now();
  elements["played-badge"].hidden = false;
  elements["choice-panel"].hidden = false;
  elements["choice-panel"].querySelector("button")?.focus();
});

elements["stimulus-video"].addEventListener("error", () => {
  setError(elements["trial-error"], "자극 영상을 불러오지 못했습니다. 연구자에게 알려 주세요.");
});

function chooseResponse(response) {
  if (choiceLocked || elements["choice-panel"].hidden || !videoEndedAt) return;
  choiceLocked = true;
  const classification = classifyResponse(currentTrial.actualOrder, response);
  const pending = {
    trialPosition: practiceMode ? 0 : session.currentIndex + 1,
    stimulusId: currentTrial.id,
    sourceIndex: currentTrial.sourceIndex,
    condition: currentTrial.condition,
    video: currentTrial.video,
    actualOrder: currentTrial.actualOrder,
    response,
    ...classification,
    confidence: 50,
    responseTimeMs: Math.round(performance.now() - videoEndedAt),
  };
  if (!practiceMode) {
    session.pending = pending;
    save();
  }
  elements["choice-panel"].querySelectorAll("button").forEach((button) => {
    button.classList.toggle("selected", button.dataset.response === response);
    button.disabled = true;
  });
  elements["confidence-range"].value = "50";
  elements["confidence-output"].value = "50";
  elements["confidence-panel"].hidden = false;
  elements["confidence-range"].focus();
  if (practiceMode) elements["next-button"].dataset.practicePending = JSON.stringify(pending);
}

elements["choice-panel"].addEventListener("click", (event) => {
  const button = event.target.closest("button[data-response]");
  if (button) chooseResponse(button.dataset.response);
});

document.addEventListener("keydown", (event) => {
  if (!elements["trial-screen"].hidden && !elements["choice-panel"].hidden) {
    const response = ({ a: "A", b: "B", u: "U" })[event.key.toLowerCase()];
    if (response) chooseResponse(response);
  }
});

elements["confidence-range"].addEventListener("input", () => {
  elements["confidence-output"].value = elements["confidence-range"].value;
  if (session?.pending) {
    session.pending.confidence = Number(elements["confidence-range"].value);
    save();
  }
});

elements["next-button"].addEventListener("click", () => {
  if (practiceMode) {
    delete elements["next-button"].dataset.practicePending;
    session.practiceComplete = true;
    save();
    showScreen("practice-complete-screen");
    return;
  }
  if (!session.pending) return;
  session.pending.confidence = Number(elements["confidence-range"].value);
  session.responses.push(session.pending);
  session.pending = null;
  session.currentIndex += 1;
  save();
  if (session.currentIndex < session.assignedTrials.length) startMainTrial();
  else finishSession();
});

function restorePendingChoice() {
  practiceMode = false;
  currentTrial = session.assignedTrials[session.currentIndex];
  showScreen("trial-screen");
  elements["trial-kicker"].textContent = "응답 복구";
  elements["trial-title"].textContent = "저장된 판단의 확신도를 확인해 주세요.";
  elements["progress-text"].textContent = `${session.currentIndex + 1} / ${session.assignedTrials.length}`;
  elements["progress-bar"].style.width = `${(session.currentIndex / session.assignedTrials.length) * 100}%`;
  elements["video-gate"].hidden = true;
  elements["played-badge"].hidden = false;
  elements["choice-panel"].hidden = true;
  elements["confidence-panel"].hidden = false;
  elements["confidence-range"].value = String(session.pending.confidence ?? 50);
  elements["confidence-output"].value = String(session.pending.confidence ?? 50);
}

async function finishSession() {
  if (!session.completedAt) {
    session.completedAt = new Date().toISOString();
    save();
  }
  showScreen("complete-screen");
  const digest = await checksum(sessionRows(session));
  elements["receipt-code"].textContent = digest.slice(0, 12).toUpperCase();
}

function download(name, text) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  link.download = name;
  document.body.append(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
}

elements["download-button"].addEventListener("click", () => {
  if (!session) return;
  download(`vista01_${session.participantCode}_${session.sessionId.slice(0, 8)}.csv`, rowsToCsv(sessionRows(session)));
});

elements["new-session-button"].addEventListener("click", () => {
  localStorage.removeItem(ACTIVE_SESSION_KEY);
  session = null;
  elements["start-form"].reset();
  elements["start-form"].hidden = false;
  elements["resume-panel"].hidden = true;
  showScreen("welcome-screen");
});

window.addEventListener("beforeunload", () => {
  if (countdownTimer) window.clearInterval(countdownTimer);
});

renderResume();
showScreen("welcome-screen");

