export const STUDY = Object.freeze({
  id: "vista01-main-rc",
  version: "1.0.0-rc1",
  title: "VISTA-01 시각 순서 과제",
  breakAfter: 12,
  responseLabels: Object.freeze({
    A: "빨간 물체가 먼저",
    B: "파란 물체가 먼저",
    S: "거의 동시에 통과",
    U: "순서를 구분할 수 없음",
  }),
});

export const PRACTICE = Object.freeze({
  id: "practice_01",
  actualOrder: "B",
  video: "assets/videos/practice.mp4?v=4",
});

const ACTUAL_ORDERS = Array.from({ length: 24 }, (_, index) => {
  const pair = Math.floor(index / 2);
  const first = Math.floor(pair / 3) % 2 === 0 ? "A" : "B";
  return index % 2 === 0 ? first : first === "A" ? "B" : "A";
});

export const STIMULI = Object.freeze(ACTUAL_ORDERS.map((actualOrder, index) => {
  const number = String(index + 1).padStart(2, "0");
  return Object.freeze({
    id: `s${number}`,
    actualOrder,
    videos: Object.freeze({
      x: `assets/videos/s${number}_x.mp4?v=4`,
      y: `assets/videos/s${number}_y.mp4?v=4`,
    }),
  });
}));
