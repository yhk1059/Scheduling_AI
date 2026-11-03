import { describe, expect, it } from "vitest";

import { keepSegments, trimFilter } from "./record-kit";

describe("keepSegments", () => {
  it("자를 구간을 뺀 나머지 구간을 순서대로 돌려준다", () => {
    expect(keepSegments([[5, 8], [12, 20]], 30)).toEqual([[0, 5], [8, 12], [20, 30]]);
  });

  it("겹치거나 순서가 섞인 구간을 합치고, 영상 길이 밖은 자른다", () => {
    expect(keepSegments([[12, 20], [5, 8], [7, 10], [28, 40]], 30)).toEqual([[0, 5], [10, 12], [20, 28]]);
  });

  it("너무 짧은 구간(0.1초 미만)은 버린다", () => {
    expect(keepSegments([[0, 5], [5.05, 9]], 10)).toEqual([[9, 10]]);
  });
});

describe("trimFilter", () => {
  it("남길 구간마다 잘라 이어 붙이는 ffmpeg 필터를 만든다", () => {
    expect(trimFilter([[0, 5], [8.25, 12]])).toBe(
      "[0:v]trim=start=0:end=5,setpts=PTS-STARTPTS[v0];[0:v]trim=start=8.25:end=12,setpts=PTS-STARTPTS[v1];[v0][v1]concat=n=2:v=1:a=0[out]",
    );
  });

  it("영상 길이를 모르면(Infinity) 마지막 구간을 끝까지 남긴다", () => {
    expect(trimFilter(keepSegments([[2, 4]], Infinity))).toBe(
      "[0:v]trim=start=0:end=2,setpts=PTS-STARTPTS[v0];[0:v]trim=start=4,setpts=PTS-STARTPTS[v1];[v0][v1]concat=n=2:v=1:a=0[out]",
    );
  });
});
