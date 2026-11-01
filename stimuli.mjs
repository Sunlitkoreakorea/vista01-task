export const STUDY = Object.freeze({
  id: "vista01-demo",
  version: "0.1.0-demo",
  title: "VISTA-01 시각 순서 과제",
  responseLabels: Object.freeze({ A: "빨간 물체가 먼저", B: "파란 물체가 먼저", U: "판단할 수 없음" }),
});

export const PRACTICE = Object.freeze({
  id: "practice_01",
  actualOrder: "B",
  video: "assets/videos/practice.mp4",
});

export const STIMULI = Object.freeze([
  {
    id: "s01",
    actualOrder: "B",
    videos: { x: "assets/videos/s01_x.mp4", y: "assets/videos/s01_y.mp4" },
  },
  {
    id: "s02",
    actualOrder: "B",
    videos: { x: "assets/videos/s02_x.mp4", y: "assets/videos/s02_y.mp4" },
  },
  {
    id: "s03",
    actualOrder: "B",
    videos: { x: "assets/videos/s03_x.mp4", y: "assets/videos/s03_y.mp4" },
  },
  {
    id: "s04",
    actualOrder: "A",
    videos: { x: "assets/videos/s04_x.mp4", y: "assets/videos/s04_y.mp4" },
  },
  {
    id: "s05",
    actualOrder: "A",
    videos: { x: "assets/videos/s05_x.mp4", y: "assets/videos/s05_y.mp4" },
  },
  {
    id: "s06",
    actualOrder: "A",
    videos: { x: "assets/videos/s06_x.mp4", y: "assets/videos/s06_y.mp4" },
  },
]);

