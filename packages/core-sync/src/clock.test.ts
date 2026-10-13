import { describe, expect, it } from "vitest";

import { compareHlc, HybridLogicalClock, type HlcTimestamp } from "./clock.js";

function ts(wall: number, counter: number, deviceId: string): HlcTimestamp {
  return { wall, counter, deviceId };
}

describe("compareHlc", () => {
  it("先比 wall", () => {
    expect(compareHlc(ts(1, 9, "z"), ts(2, 0, "a"))).toBeLessThan(0);
    expect(compareHlc(ts(2, 0, "a"), ts(1, 9, "z"))).toBeGreaterThan(0);
  });

  it("wall 相同则比 counter", () => {
    expect(compareHlc(ts(1, 1, "z"), ts(1, 2, "a"))).toBeLessThan(0);
  });

  it("wall 与 counter 都相同则比 deviceId，保证任意两个时间戳都有确定顺序", () => {
    expect(compareHlc(ts(1, 1, "a"), ts(1, 1, "b"))).toBeLessThan(0);
    expect(compareHlc(ts(1, 1, "b"), ts(1, 1, "a"))).toBeGreaterThan(0);
    expect(compareHlc(ts(1, 1, "a"), ts(1, 1, "a"))).toBe(0);
  });
});

describe("HybridLogicalClock", () => {
  it("拒绝空 deviceId（它承担全序决胜，不能为空）", () => {
    expect(() => new HybridLogicalClock("")).toThrow(TypeError);
  });

  it("尚未产生事件时 peek 为 undefined", () => {
    const clock = new HybridLogicalClock("A", () => 1_000);
    expect(clock.peek()).toBeUndefined();
    clock.tick();
    expect(clock.peek()).toBeDefined();
  });

  it("物理时钟前进时 counter 归零", () => {
    let now = 1_000;
    const clock = new HybridLogicalClock("A", () => now);

    expect(clock.tick()).toEqual(ts(1_000, 0, "A"));
    now = 2_000;
    expect(clock.tick()).toEqual(ts(2_000, 0, "A"));
  });

  it("同一毫秒内 counter 递增", () => {
    const clock = new HybridLogicalClock("A", () => 1_000);
    expect(clock.tick()).toEqual(ts(1_000, 0, "A"));
    expect(clock.tick()).toEqual(ts(1_000, 1, "A"));
    expect(clock.tick()).toEqual(ts(1_000, 2, "A"));
  });

  it("墙钟回拨时不倒退", () => {
    let now = 5_000;
    const clock = new HybridLogicalClock("A", () => now);
    const first = clock.tick();
    now = 1_000; // 回拨
    expect(compareHlc(clock.tick(), first)).toBeGreaterThan(0);
  });

  it("observe 产出严格大于远端的时间戳（本地 counter 落后于远端时的关键性质）", () => {
    // 若把 observe 写成「wall = max(...) 然后 counter + 1」，这里会得到 (1000, 1, A)，
    // 而远端是 (1000, 5, B) —— 我们会产出一个早于刚刚观察到的事件的时间戳，
    // 因果序被破坏。这个用例就是防止那种写法。
    const clock = new HybridLogicalClock("A", () => 1_000);
    clock.tick(); // (1000, 0, A)

    const remote = ts(1_000, 5, "B");
    const observed = clock.observe(remote);

    expect(compareHlc(observed, remote)).toBeGreaterThan(0);
  });

  it("observe 返回的时间戳严格大于本地此前的时间戳", () => {
    const clock = new HybridLogicalClock("A", () => 1_000);
    const first = clock.tick();
    const second = clock.tick();

    expect(compareHlc(second, first)).toBeGreaterThan(0);
    expect(compareHlc(clock.observe(ts(500, 0, "B")), second)).toBeGreaterThan(0);
  });

  it("远端 wall 领先时采用远端 counter", () => {
    const clock = new HybridLogicalClock("A", () => 1_000);
    expect(clock.observe(ts(2_000, 7, "B"))).toEqual(ts(2_000, 8, "A"));
  });

  it("两台设备互相 observe 后不会产生相同时间戳", () => {
    const a = new HybridLogicalClock("A", () => 1_000);
    const b = new HybridLogicalClock("B", () => 1_000);

    const eventA = a.tick();
    const eventB = b.observe(eventA);
    const eventA2 = a.observe(eventB);

    expect(compareHlc(eventB, eventA)).toBeGreaterThan(0);
    expect(compareHlc(eventA2, eventB)).toBeGreaterThan(0);
  });

  it("三台设备互相观察后事件顺序一致且无环", () => {
    const clocks = ["A", "B", "C"].map((id) => new HybridLogicalClock(id, () => 1_000));

    const events: HlcTimestamp[] = [];
    events.push(clocks[0]!.tick());
    events.push(clocks[1]!.observe(events[0]!));
    events.push(clocks[2]!.observe(events[1]!));
    events.push(clocks[0]!.observe(events[2]!));

    for (let i = 1; i < events.length; i += 1) {
      expect(compareHlc(events[i]!, events[i - 1]!)).toBeGreaterThan(0);
    }
  });
});
