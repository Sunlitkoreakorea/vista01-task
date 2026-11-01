import { STUDY, PRACTICE, STIMULI } from "./stimuli.mjs?v=5";
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
} from "./logic.mjs?v=5";

const elements = Object.fromEntries([
  "welcome-screen", "instruction-screen", "trial-screen", "practice-feedback-screen", "practice-complete-screen", "break-screen", "complete-screen",
  "start-form", "participant-code", "consent-check", "start-error", "resume-panel", "resume-detail",
  "resume-button", "discard-button", "practice-button", "practice-retry-button", "experiment-button", "continue-button",
  "trial-kicker", "trial-title", "progress-text", "progress-bar", "stimulus-video", "video-gate", "play-button", "play-label", "countdown", "played-badge",
  "choice-panel", "confidence-panel", "confidence-question", "confidence-range", "confidence-output", "next-button", "trial-error",
  "receipt-code", "download-button", "new-session-button",
].map((id) => [id, document.getElementById(id)]));

const screens = ["welcome-screen", "instruction-screen", "trial-screen", "practice-feedback-screen", "practice-complete-screen", "break-screen", "complete-screen"];
let session = null;
let currentTrial = null;
let practiceMode = false;
let practicePending = null;
let videoEndedAt = null;
let choiceMadeAt = null;
let choiceLocked = false;
let confidenceTouched = false;
let countdownTimer = null;
let playbackActive = false;
let visibilityInterrupted = false;
let playbackStalls = 0;
let playbackStallMs = 0;
let stallStartedAt = null;
let preloadVideo = null;

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
  } else if (session.currentIndex === STUDY.breakAfter && !session.breakTaken) {
    showBreak();
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
    setError(elements["start-error"], "참여 확인란을 선택해 주세요.");
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

elements["practice-retry-button"].addEventListener("click", startPractice);
elements["experiment-button"].addEventListener("click", startMainTrial);
elements["continue-button"].addEventListener("click", () => {
  session.breakTaken = true;
  session.breakEndedAt = new Date().toISOString();
  save();
  startMainTrial();
});

function startPractice() {
  practiceMode = true;
  practicePending = null;
  currentTrial = { ...PRACTICE, condition: "practice", sourceIndex: -1 };
  prepareTrial();
}

function startMainTrial() {
  practiceMode = false;
  currentTrial = session.assignedTrials[session.currentIndex];
  prepareTrial();
}

function applyChoiceOrder() {
  const order = session?.choiceOrder ?? ["A", "B", "S", "U"];
  for (const button of elements["choice-panel"].querySelectorAll("button[data-response]")) {
    button.style.order = String(order.indexOf(button.dataset.response) + 1);
  }
}

function resetConfidence() {
  confidenceTouched = false;
  elements["confidence-range"].value = "50";
  elements["confidence-range"].classList.add("unanswered");
  elements["confidence-output"].value = "선택 필요";
  elements["confidence-output"].classList.add("unanswered");
  elements["next-button"].disabled = true;
}

function setVideoReady(ready) {
  elements["play-button"].disabled = !ready;
  elements["play-label"].textContent = ready ? "영상 시작" : "영상 준비 중";
}

function prepareTrial() {
  choiceLocked = false;
  videoEndedAt = null;
  choiceMadeAt = null;
  playbackActive = false;
  visibilityInterrupted = false;
  playbackStalls = 0;
  playbackStallMs = 0;
  stallStartedAt = null;
  elements["trial-title"].textContent = "기준선 통과 순서를 관찰해 주세요.";
  elements["choice-panel"].hidden = true;
  elements["confidence-panel"].hidden = true;
  elements["played-badge"].hidden = true;
  elements["video-gate"].hidden = false;
  elements["play-button"].hidden = false;
  elements.countdown.hidden = true;
  setError(elements["trial-error"]);
  setVideoReady(false);
  resetConfidence();
  applyChoiceOrder();
  elements["stimulus-video"].controls = false;
  elements["stimulus-video"].src = currentTrial.video;
  elements["stimulus-video"].load();
  elements["choice-panel"].querySelectorAll("button[data-response]").forEach((button) => {
    button.disabled = false;
    button.classList.remove("selected");
  });

  if (practiceMode) {
    elements["trial-kicker"].textContent = `연습 시행 ${session.practiceAttempts + 1}`;
    elements["progress-text"].textContent = "연습";
    elements["progress-bar"].style.width = "0%";
  } else {
    const position = session.currentIndex + 1;
    elements["trial-kicker"].textContent = "본 실험";
    elements["progress-text"].textContent = `${position} / ${session.assignedTrials.length}`;
    elements["progress-bar"].style.width = `${((position - 1) / session.assignedTrials.length) * 100}%`;
    preloadNextTrial();
  }
  showScreen("trial-screen");
  if (elements["stimulus-video"].readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) setVideoReady(true);
}

function preloadNextTrial() {
  const nextTrial = session.assignedTrials[session.currentIndex + 1];
  if (!nextTrial) return;
  preloadVideo = document.createElement("video");
  preloadVideo.preload = "auto";
  preloadVideo.src = nextTrial.video;
  preloadVideo.load();
}

elements["stimulus-video"].addEventListener("loadeddata", () => setVideoReady(true));
elements["stimulus-video"].addEventListener("canplay", () => setVideoReady(true));
elements["stimulus-video"].addEventListener("waiting", () => {
  if (playbackActive && stallStartedAt === null) stallStartedAt = performance.now();
});
elements["stimulus-video"].addEventListener("stalled", () => {
  if (playbackActive && stallStartedAt === null) stallStartedAt = performance.now();
});
elements["stimulus-video"].addEventListener("playing", () => {
  if (stallStartedAt === null) return;
  const duration = Math.round(performance.now() - stallStartedAt);
  if (duration >= 150) {
    playbackStalls += 1;
    playbackStallMs += duration;
  }
  stallStartedAt = null;
});

elements["play-button"].addEventListener("click", () => {
  if (elements["play-button"].disabled) return;
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
    countdownTimer = null;
    elements.countdown.hidden = true;
    elements["video-gate"].hidden = true;
    try {
      elements["stimulus-video"].currentTime = 0;
      visibilityInterrupted = document.hidden;
      playbackActive = true;
      await elements["stimulus-video"].play();
      if (!practiceMode) {
        session.presentationCounts ??= {};
        session.presentationCounts[currentTrial.id] = (session.presentationCounts[currentTrial.id] ?? 0) + 1;
        save();
      }
    } catch {
      playbackActive = false;
      elements["video-gate"].hidden = false;
      elements["play-button"].hidden = false;
      setError(elements["trial-error"], "영상을 재생하지 못했습니다. 브라우저 설정을 확인한 뒤 다시 시도해 주세요.");
    }
  }, 650);
});

elements["stimulus-video"].addEventListener("ended", () => {
  if (stallStartedAt !== null) {
    const duration = Math.round(performance.now() - stallStartedAt);
    if (duration >= 150) {
      playbackStalls += 1;
      playbackStallMs += duration;
    }
    stallStartedAt = null;
  }
  playbackActive = false;
  videoEndedAt = performance.now();
  elements["played-badge"].hidden = false;
  elements["choice-panel"].hidden = false;
  const firstResponse = session.choiceOrder?.[0] ?? "A";
  elements["choice-panel"].querySelector(`[data-response="${firstResponse}"]`)?.focus();
});

elements["stimulus-video"].addEventListener("error", () => {
  playbackActive = false;
  stallStartedAt = null;
  setError(elements["trial-error"], "자극 영상을 불러오지 못했습니다. 연구자에게 알려 주세요.");
});

document.addEventListener("visibilitychange", () => {
  if (playbackActive && document.hidden) visibilityInterrupted = true;
});

function confidenceQuestion(response) {
  if (response === "S") return "두 물체가 거의 동시에 통과했다는 판단을 얼마나 확신합니까?";
  if (response === "U") return "영상만으로 순서를 구분할 수 없다는 판단을 얼마나 확신합니까?";
  return "선택한 통과 순서를 얼마나 확신합니까?";
}

function chooseResponse(response) {
  if (choiceLocked || elements["choice-panel"].hidden || !videoEndedAt) return;
  choiceLocked = true;
  choiceMadeAt = performance.now();
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
    confidence: null,
    responseTimeMs: Math.round(choiceMadeAt - videoEndedAt),
    confidenceResponseTimeMs: null,
    visibilityInterrupted,
    playbackStalls,
    playbackStallMs,
    videoDurationMs: Number.isFinite(elements["stimulus-video"].duration) ? Math.round(elements["stimulus-video"].duration * 1000) : null,
    resumedDuringConfidence: false,
    presentationCount: practiceMode ? 1 : (session.presentationCounts?.[currentTrial.id] ?? 1),
  };
  if (practiceMode) practicePending = pending;
  else {
    session.pending = pending;
    save();
  }
  elements["choice-panel"].querySelectorAll("button").forEach((button) => {
    button.classList.toggle("selected", button.dataset.response === response);
    button.disabled = true;
  });
  resetConfidence();
  elements["confidence-question"].textContent = confidenceQuestion(response);
  elements["confidence-panel"].hidden = false;
  elements["confidence-range"].focus();
}

elements["choice-panel"].addEventListener("click", (event) => {
  const button = event.target.closest("button[data-response]");
  if (button) chooseResponse(button.dataset.response);
});

document.addEventListener("keydown", (event) => {
  if (!elements["trial-screen"].hidden && !elements["choice-panel"].hidden) {
    const response = ({ a: "A", b: "B", s: "S", u: "U" })[event.key.toLowerCase()];
    if (response) chooseResponse(response);
  }
});

elements["confidence-range"].addEventListener("input", () => {
  confidenceTouched = true;
  const value = Number(elements["confidence-range"].value);
  elements["confidence-output"].value = String(value);
  elements["confidence-output"].classList.remove("unanswered");
  elements["confidence-range"].classList.remove("unanswered");
  elements["next-button"].disabled = false;
  if (practiceMode && practicePending) practicePending.confidence = value;
  if (!practiceMode && session?.pending) {
    session.pending.confidence = value;
    save();
  }
});

elements["next-button"].addEventListener("click", () => {
  if (!confidenceTouched || elements["next-button"].disabled) return;
  const confidenceResponseTimeMs = choiceMadeAt ? Math.round(performance.now() - choiceMadeAt) : null;
  if (practiceMode) {
    if (!practicePending) return;
    practicePending.confidenceResponseTimeMs = confidenceResponseTimeMs;
    session.practiceAttempts += 1;
    const passed = practicePending.response === PRACTICE.actualOrder;
    practicePending = null;
    if (passed) {
      session.practiceComplete = true;
      save();
      showScreen("practice-complete-screen");
    } else {
      save();
      showScreen("practice-feedback-screen");
    }
    return;
  }
  if (!session.pending) return;
  session.pending.confidenceResponseTimeMs = confidenceResponseTimeMs;
  session.responses.push(session.pending);
  session.pending = null;
  session.currentIndex += 1;
  save();
  if (session.currentIndex === STUDY.breakAfter && !session.breakTaken) showBreak();
  else if (session.currentIndex < session.assignedTrials.length) startMainTrial();
  else finishSession();
});

function restoreConfidence(value) {
  confidenceTouched = Number.isFinite(value);
  elements["confidence-range"].value = String(confidenceTouched ? value : 50);
  elements["confidence-output"].value = confidenceTouched ? String(value) : "선택 필요";
  elements["confidence-range"].classList.toggle("unanswered", !confidenceTouched);
  elements["confidence-output"].classList.toggle("unanswered", !confidenceTouched);
  elements["next-button"].disabled = !confidenceTouched;
}

function restorePendingChoice() {
  practiceMode = false;
  currentTrial = session.assignedTrials[session.currentIndex];
  choiceMadeAt = null;
  session.pending.resumedDuringConfidence = true;
  save();
  showScreen("trial-screen");
  elements["trial-kicker"].textContent = "응답 복구";
  elements["trial-title"].textContent = "저장된 판단의 확신도를 확인해 주세요.";
  elements["progress-text"].textContent = `${session.currentIndex + 1} / ${session.assignedTrials.length}`;
  elements["progress-bar"].style.width = `${(session.currentIndex / session.assignedTrials.length) * 100}%`;
  elements["video-gate"].hidden = true;
  elements["played-badge"].hidden = false;
  elements["choice-panel"].hidden = true;
  elements["confidence-panel"].hidden = false;
  elements["confidence-question"].textContent = confidenceQuestion(session.pending.response);
  restoreConfidence(session.pending.confidence);
}

function showBreak() {
  if (!session.breakStartedAt) session.breakStartedAt = new Date().toISOString();
  save();
  showScreen("break-screen");
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
  elements["download-button"].textContent = "CSV 저장 완료";
});

elements["new-session-button"].addEventListener("click", () => {
  localStorage.removeItem(ACTIVE_SESSION_KEY);
  session = null;
  elements["start-form"].reset();
  elements["start-form"].hidden = false;
  elements["resume-panel"].hidden = true;
  elements["download-button"].textContent = "응답 CSV 저장";
  showScreen("welcome-screen");
});

window.addEventListener("beforeunload", () => {
  if (countdownTimer) window.clearInterval(countdownTimer);
  preloadVideo = null;
});

renderResume();
showScreen("welcome-screen");
