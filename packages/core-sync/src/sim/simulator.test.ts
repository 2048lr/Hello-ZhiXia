import { describe, expect, it } from "vitest";

import { compareHlc } from "../clock.js";
import { maxHlc, type JsonValue, type Op } from "../op.js";
import { createSimulator } from "./simulator.js";
import type { VirtualDevice } from "./device.js";

/** 把日志里的 payload 取出来排序，用于比较两台设备是否持有同一批内容。 */
function payloads(device: VirtualDevice): JsonValue[] {
  return device.log
    .all()
    .map((op: Op) => op.payload)
    .sort((a, b) => String(a).localeCompare(String(b)));
}

describe("基本收敛", () => {
  it("一台设备写入后，另一台最终收到", () => {
    const sim = createSimulator({ seed: 1 });
    const a = sim.addDevice("A");
    const b = sim.addDevice("B");

    a.write(a.newEntityId(), "note.create", "hello");

    expect(sim.settle().converged).toBe(true);
    expect(b.log.size).toBe(1);
    expect(b.log.all()[0]!.payload).toBe("hello");
  });

  it("三台设备各自写入后全部收敛到同一集合", () => {
    const sim = createSimulator({ seed: 2, antiEntropyInterval: 40 });
    const a = sim.addDevice("A");
    const b = sim.addDevice("B");
    const c = sim.addDevice("C");

    a.write(a.newEntityId(), "note.create", 1);
    sim.run(7);
    b.write(b.newEntityId(), "note.create", 2);
    sim.run(7);
    c.write(c.newEntityId(), "note.create", 3);

    expect(sim.settle({ maxMs: 5_000 }).converged).toBe(true);
    expect(sim.opCounts()).toEqual({ A: 3, B: 3, C: 3 });
  });

  it("同一批操作被反复投递时日志不重复增长", () => {
    const sim = createSimulator({ seed: 3, antiEntropyInterval: 20 });
    const a = sim.addDevice("A");
    const b = sim.addDevice("B");

    a.write(a.newEntityId(), "note.create", 1);
    const before = sim.stats().delivered;
    sim.settle({ maxMs: 3_000 });

    // anti-entropy 会一轮又一轮地重复交换同一批操作
    expect(sim.stats().delivered).toBeGreaterThan(before);
    expect(b.log.size).toBe(1);
  });
});

describe("分区", () => {
  it("分区期间完全不传播", () => {
    const sim = createSimulator({ seed: 11, antiEntropyInterval: 50 });
    const a = sim.addDevice("A");
    const b = sim.addDevice("B");

    sim.partition([["A"], ["B"]]);
    a.write(a.newEntityId(), "note.create", "from-A");
    sim.run(300);

    expect(a.log.size).toBe(1);
    expect(b.log.size).toBe(0);
    expect(sim.stats().droppedByPartition).toBeGreaterThan(0);
  });

  it("partition([]) 等价于 heal()，不会静默全网隔离", () => {
    // 曾经的行为：partition([]) 建出一个空 Map，被 #reachable 解释成
    // 「所有设备都不在任何组里」，于是每一对设备都不可达 —— 网络被静默冻死，
    // 而文档写的是「传空数组即 heal()」。调用方按文档愈合，测试却会以极难
    // 排查的方式失败。这个用例把契约钉死。
    const sim = createSimulator({ seed: 41, antiEntropyInterval: 40 });
    const a = sim.addDevice("A");
    const b = sim.addDevice("B");

    a.write(a.newEntityId(), "note.create", "before");
    expect(sim.settle({ maxMs: 2_000 }).converged).toBe(true);
    expect(b.log.size).toBe(1);

    sim.partition([]); // 按文档：等价于 heal()
    a.write(a.newEntityId(), "note.create", "after");

    expect(sim.settle({ maxMs: 3_000 }).converged).toBe(true);
    expect(b.log.size).toBe(2);
  });

  it("未出现在任何组里的设备仍被完全隔离（空数组修复不影响这条语义）", () => {
    const sim = createSimulator({ seed: 43, antiEntropyInterval: 40 });
    const a = sim.addDevice("A");
    const b = sim.addDevice("B");
    const lonely = sim.addDevice("lonely");

    sim.partition([["A", "B"]]); // lonely 不在任何组里
    a.write(a.newEntityId(), "note.create", "from-A");
    sim.run(300);

    expect(b.log.size).toBe(1);
    expect(lonely.log.size).toBe(0);
  });

  it("愈合后把缺失的操作补齐给从未拿到它的设备", () => {
    const sim = createSimulator({ seed: 12, antiEntropyInterval: 50 });
    const a = sim.addDevice("A");
    const b = sim.addDevice("B");

    sim.partition([["A"], ["B"]]);
    a.write(a.newEntityId(), "note.create", "from-A");
    sim.run(300);

    sim.heal();
    expect(sim.settle({ maxMs: 3_000 }).converged).toBe(true);
    expect(b.log.size).toBe(1);
    expect(b.log.all()[0]!.payload).toBe("from-A");
  });

  it("只响应、不主动发起对账的设备（如 Android 瘦客户端）也能拿到数据", () => {
    // 这个用例是变异测试催生的。把应答改成「missing 为空就不回复」后，
    // 其余分区用例全都照样通过 —— 因为它们两侧都会主动发起对账，
    // 方向性由发起方轮转保证，区分不出两种协议。只有这个用例能钉住差别。
    const sim = createSimulator({ seed: 16, antiEntropyInterval: 40 });
    const desktop = sim.addDevice("desktop");
    // 对应 ADR-0006：Android 后台受限，不应期待它周期性主动联网
    const mobile = sim.addDevice("mobile", { antiEntropy: false });

    sim.partition([["desktop"], ["mobile"]]);
    desktop.write(desktop.newEntityId(), "note.create", "from-desktop");
    sim.run(200);

    expect(mobile.log.size).toBe(0);

    sim.heal();
    expect(sim.settle({ maxMs: 3_000 }).converged).toBe(true);
    expect(mobile.log.size).toBe(1);
    expect(mobile.log.all()[0]!.payload).toBe("from-desktop");
  });

  it("分区两侧都写入，愈合后互相补齐", () => {
    const sim = createSimulator({ seed: 13, antiEntropyInterval: 50 });
    const a = sim.addDevice("A");
    const b = sim.addDevice("B");

    sim.partition([["A"], ["B"]]);
    a.write(a.newEntityId(), "note.create", "from-A");
    b.write(b.newEntityId(), "note.create", "from-B");
    sim.run(300);

    expect(a.log.size).toBe(1);
    expect(b.log.size).toBe(1);
    expect(payloads(a)).not.toEqual(payloads(b));

    sim.heal();
    expect(sim.settle({ maxMs: 3_000 }).converged).toBe(true);
    expect(a.log.size).toBe(2);
    expect(payloads(a)).toEqual(payloads(b));
  });

  it("三方分区（AB | C）愈合后全部收敛", () => {
    const sim = createSimulator({ seed: 14, antiEntropyInterval: 40 });
    const a = sim.addDevice("A");
    const b = sim.addDevice("B");
    const c = sim.addDevice("C");

    sim.partition([["A", "B"], ["C"]]);
    a.write(a.newEntityId(), "note.create", "ab-1");
    b.write(b.newEntityId(), "note.create", "ab-2");
    c.write(c.newEntityId(), "note.create", "c-1");
    sim.run(400);

    expect(a.log.size).toBe(2);
    expect(c.log.size).toBe(1);

    sim.heal();
    expect(sim.settle({ maxMs: 5_000 }).converged).toBe(true);
    for (const device of sim.devices()) {
      expect(device.log.size).toBe(3);
    }
  });

  it("长时间离线积累了 30 条操作，重连后全部补齐", () => {
    const sim = createSimulator({ seed: 15, antiEntropyInterval: 50 });
    const a = sim.addDevice("A");
    const b = sim.addDevice("B");
    const c = sim.addDevice("C");

    sim.partition([["A", "B"], ["C"]]);
    for (let i = 0; i < 30; i += 1) {
      c.write(c.newEntityId(), "note.create", i);
    }
    sim.run(1_000);

    expect(a.log.size).toBe(0);
    expect(c.log.size).toBe(30);

    sim.heal();
    expect(sim.settle({ maxMs: 10_000 }).converged).toBe(true);
    expect(a.log.size).toBe(30);
    expect(b.log.size).toBe(30);
  });
});

describe("丢包与乱序", () => {
  it("持续 50% 丢包下仍最终收敛", () => {
    const sim = createSimulator({ seed: 21, lossRate: 0.5, antiEntropyInterval: 40 });
    const a = sim.addDevice("A");
    const b = sim.addDevice("B");
    const c = sim.addDevice("C");

    for (let i = 0; i < 20; i += 1) {
      a.write(a.newEntityId(), "note.create", i);
      sim.run(7);
    }

    expect(sim.settle({ maxMs: 30_000 }).converged).toBe(true);
    expect(sim.stats().droppedByLoss).toBeGreaterThan(0);
    expect(a.log.size).toBe(20);
    expect(c.log.size).toBe(20);
  });

  it("丢包与乱序叠加下仍收敛，且两端持有完全相同的内容", () => {
    const sim = createSimulator({
      seed: 22,
      lossRate: 0.3,
      reorderRate: 0.8,
      reorderDelay: 200,
      antiEntropyInterval: 30,
    });
    const a = sim.addDevice("A");
    const b = sim.addDevice("B");

    const entity = a.newEntityId();
    for (let i = 0; i < 10; i += 1) {
      a.write(entity, "note.append", i);
      sim.run(3);
    }

    expect(sim.settle({ maxMs: 30_000 }).converged).toBe(true);
    expect(a.log.size).toBe(10);
    expect(payloads(b)).toEqual(payloads(a));
  });
});

describe("时钟偏移", () => {
  it("两台设备时钟相差 10 分钟仍能收敛，且排出相同顺序", () => {
    const sim = createSimulator({ seed: 31, antiEntropyInterval: 40 });
    const skewed = sim.addDevice("skewed", { clockSkew: -600_000 });
    const normal = sim.addDevice("normal");

    skewed.write(skewed.newEntityId(), "note.create", "from-skewed");
    normal.write(normal.newEntityId(), "note.create", "from-normal");

    // 只有 HLC 三元组（而不是墙钟）才能决定顺序，因此时钟偏移不影响收敛
    expect(sim.settle({ maxMs: 5_000 }).converged).toBe(true);
    expect(skewed.log.all().map((op) => op.opId)).toEqual(normal.log.all().map((op) => op.opId));
  });

  it("时钟落后的设备收到操作后再写入，其 HLC 仍晚于所收到的一切", () => {
    // 关掉 anti-entropy，只留下写入时的 push，让时序完全由延迟决定
    const sim = createSimulator({ seed: 32, antiEntropyInterval: 0 });
    const behind = sim.addDevice("behind", { clockSkew: -600_000 });
    const ahead = sim.addDevice("ahead");

    ahead.write(ahead.newEntityId(), "note.create", 1);
    ahead.write(ahead.newEntityId(), "note.create", 2);
    sim.run(60);

    expect(behind.log.size).toBe(2);

    const receivedMax = maxHlc(behind.log)!;
    const local = behind.write(behind.newEntityId(), "note.create", "local");

    // 若 VirtualDevice.receive 忘了 observe 远端 HLC，
    // 落后 10 分钟的墙钟会让这条本地操作排在收到的操作之前，因果序被破坏。
    expect(compareHlc(local.hlc, receivedMax)).toBeGreaterThan(0);
  });
});

describe("确定性", () => {
  function scenario(seed: number): { trace: string; counts: Record<string, number> } {
    const sim = createSimulator({
      seed,
      lossRate: 0.4,
      reorderRate: 0.5,
      antiEntropyInterval: 25,
    });
    const devices = [sim.addDevice("A"), sim.addDevice("B"), sim.addDevice("C")];

    for (let i = 0; i < 9; i += 1) {
      const device = devices[i % devices.length]!;
      device.write(device.newEntityId(), "note.create", i);
      sim.run(11);
    }
    sim.settle({ maxMs: 5_000 });

    return { trace: sim.traceDigest(), counts: sim.opCounts() };
  }

  it("相同种子产生完全相同的轨迹与结果", () => {
    const first = scenario(99);
    const second = scenario(99);

    expect(first.trace.length).toBeGreaterThan(0);
    expect(first.trace).toBe(second.trace);
    expect(first.counts).toEqual(second.counts);
  });

  it("不同种子产生不同的轨迹（证明种子真的在驱动随机性）", () => {
    expect(scenario(1).trace).not.toBe(scenario(2).trace);
  });
});

describe("参数校验", () => {
  it("拒绝 minLatency > maxLatency", () => {
    expect(() => createSimulator({ minLatency: 20, maxLatency: 5 })).toThrow(RangeError);
  });

  it("拒绝越界的 lossRate 与 reorderRate", () => {
    expect(() => createSimulator({ lossRate: 1.5 })).toThrow(RangeError);
    expect(() => createSimulator({ reorderRate: -0.1 })).toThrow(RangeError);
  });

  it("拒绝重复添加同一设备", () => {
    const sim = createSimulator();
    sim.addDevice("A");
    expect(() => sim.addDevice("A")).toThrow(/已存在/);
  });

  it("拒绝负数时间推进", () => {
    const sim = createSimulator();
    expect(() => sim.run(-1)).toThrow(RangeError);
  });
});
