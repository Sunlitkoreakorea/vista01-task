export const STORAGE_KEY = "vista01.sessions.v4";
export const ACTIVE_SESSION_KEY = "vista01.active-session.v4";
export const CONDITIONS = Object.freeze(["x", "y"]);
export const RESPONSE_CODES = Object.freeze(["A", "B", "S", "U"]);

export function normalizeCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

export function isValidCode(value) {
  return /^[A-Z0-9-]{4,20}$/.test(normalizeCode(value));
}

export function hash32(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createRng(seed) {
  let state = seed >>> 0;
  return function next() {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled(items, rng) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(rng() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function assignTrials(participantCode, stimuli) {
  const code = normalizeCode(participantCode);
  const seed = hash32(code);
  const assigned = stimuli.map((stimulus, sourceIndex) => {
    const condition = CONDITIONS[(seed + sourceIndex) % CONDITIONS.length];
    return {
      id: stimulus.id,
      actualOrder: stimulus.actualOrder,
      condition,
      video: stimulus.videos[condition],
      sourceIndex,
    };
  });
  return shuffled(assigned, createRng(seed ^ 0x9e3779b9));
}

export function choiceOrderForParticipant(participantCode) {
  const seed = hash32(normalizeCode(participantCode));
  return (seed >>> 1) % 2 === 0 ? ["A", "B", "S", "U"] : ["B", "A", "S", "U"];
}

export function makeSession(participantCode, stimuli, study, now = new Date()) {
  const code = normalizeCode(participantCode);
  const randomPart = globalThis.crypto?.randomUUID?.() ?? `${now.getTime()}-${hash32(code)}`;
  return {
    sessionId: randomPart,
    studyId: study.id,
    studyVersion: study.version,
    participantCode: code,
    startedAt: now.toISOString(),
    completedAt: null,
    consentConfirmed: true,
    consentConfirmedAt: now.toISOString(),
    instructionSeen: false,
    practiceComplete: false,
    practiceAttempts: 0,
    breakTaken: false,
    breakStartedAt: null,
    breakEndedAt: null,
    choiceOrder: choiceOrderForParticipant(code),
    currentIndex: 0,
    assignedTrials: assignTrials(code, stimuli),
    presentationCounts: {},
    responses: [],
    pending: null,
  };
}

export function classifyResponse(actualOrder, response) {
  const assertedOrder = response === "A" || response === "B";
  const simultaneous = response === "S";
  const unable = response === "U";
  return {
    assertedOrder,
    simultaneous,
    unable,
    correctSpecific: assertedOrder && response === actualOrder,
    falseAssertion: assertedOrder && response !== actualOrder,
  };
}

function breakDurationMs(session) {
  if (!session.breakStartedAt || !session.breakEndedAt) return "";
  return Math.max(0, new Date(session.breakEndedAt) - new Date(session.breakStartedAt));
}

export function sessionRows(session) {
  return session.responses.map((response) => ({
    study_id: session.studyId,
    study_version: session.studyVersion,
    session_id: session.sessionId,
    participant_code: session.participantCode,
    started_utc: session.startedAt,
    completed_utc: session.completedAt ?? "",
    consent_confirmed_utc: session.consentConfirmedAt ?? "",
    practice_attempts: session.practiceAttempts ?? "",
    choice_order: (session.choiceOrder ?? []).join(">"),
    break_duration_ms: breakDurationMs(session),
    trial_position: response.trialPosition,
    stimulus_id: response.stimulusId,
    source_index: response.sourceIndex,
    condition: response.condition,
    actual_order: response.actualOrder,
    response: response.response,
    asserted_order: Number(response.assertedOrder),
    false_assertion: Number(response.falseAssertion),
    correct_specific: Number(response.correctSpecific),
    simultaneous: Number(response.simultaneous),
    unable: Number(response.unable),
    confidence: response.confidence,
    response_time_ms: response.responseTimeMs,
    confidence_response_time_ms: response.confidenceResponseTimeMs,
    resumed_during_confidence: Number(Boolean(response.resumedDuringConfidence)),
    presentation_count: response.presentationCount ?? 1,
    repeat_presentation: Number((response.presentationCount ?? 1) > 1),
    visibility_interrupted: Number(Boolean(response.visibilityInterrupted)),
    playback_stalls: response.playbackStalls ?? 0,
    playback_stall_ms: response.playbackStallMs ?? 0,
    video_duration_ms: response.videoDurationMs ?? "",
    video_path: response.video,
  }));
}

export function computeSessionMetrics(session) {
  const rows = sessionRows(session);
  const falseAssertions = rows.reduce((sum, row) => sum + row.false_assertion, 0);
  const simultaneous = rows.reduce((sum, row) => sum + row.simultaneous, 0);
  const unable = rows.reduce((sum, row) => sum + row.unable, 0);
  const qualityFlags = rows.reduce((sum, row) => sum + Number(
    row.repeat_presentation === 1
    || row.visibility_interrupted === 1
    || row.playback_stalls > 0
    || row.resumed_during_confidence === 1
  ), 0);
  return {
    trials: rows.length,
    falseAssertions,
    simultaneous,
    unable,
    qualityFlags,
    falseAssertionRate: rows.length ? falseAssertions / rows.length : 0,
  };
}

function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function rowsToCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const body = rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(","));
  return [`\uFEFF${headers.join(",")}`, ...body].join("\r\n");
}

export function loadSessions(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveSession(session, storage = globalThis.localStorage) {
  const sessions = loadSessions(storage);
  sessions[session.sessionId] = session;
  storage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  storage.setItem(ACTIVE_SESSION_KEY, session.sessionId);
}

export function removeSession(sessionId, storage = globalThis.localStorage) {
  const sessions = loadSessions(storage);
  delete sessions[sessionId];
  storage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  if (storage.getItem(ACTIVE_SESSION_KEY) === sessionId) storage.removeItem(ACTIVE_SESSION_KEY);
}

export async function checksum(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
