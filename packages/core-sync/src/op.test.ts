import { describe, expect, it } from "vitest";

import { ulid } from "./id.js";
import { compareOps, createMemoryOpLog, foldOps, sortOps, type JsonValue, type Op } from "./op.js";

interface OpSpec {
  readonly deviceId: string;
  readonly wall: number;
  readonly counter: number;
  readonly type: string;
  readonly payload?: JsonValue;
}

function makeOp(spec: OpSpec): Op {
  const { deviceId, wall, counter, type } = spec;
  const payload: JsonValue = spec.payload ?? null;
  return {
    opId: ulid(wall),
    hlc: { wall, counter, deviceId },
    entityId: ulid(wall),
    type,
    payload,
    schemaVersion: 1,
  };
}

describe("compareOps", () => {
  it("按 HLC 三元组排序", () => {
    const early = makeOp({ deviceId: "A", wall: 1, counter: 0, type: "t" });
    const late = makeOp({ deviceId: "A", wall: 2, counter: 0, type: "t" });

    expect(compareOps(early, late)).toBeLessThan(0);
    expect(compareOps(late, early)).toBeGreaterThan(0);
  });

  it("wall 相同时按 deviceId 决胜，保证多端结论一致", () => {
    const fromA = makeOp({ deviceId: "A", wall: 1, counter: 0, type: "t" });
    const fromB = makeOp({ deviceId: "B", wall: 1, counter: 0, type: "t" });

    expect(compareOps(fromA, fromB)).toBeLessThan(0);
    expect(compareOps(fromB, fromA)).toBeGreaterThan(0);
  });
});

describe("sortOps", () => {
  it("结果与插入顺序无关", () => {
    const ops = [
      makeOp({ deviceId: "C", wall: 3, counter: 0, type: "t" }),
      makeOp({ deviceId: "A", wall: 1, counter: 0, type: "t" }),
      makeOp({ deviceId: "B", wall: 2, counter: 0, type: "t" }),
    ];

    const forward = sortOps(ops).map((op) => op.hlc.deviceId);
    const backward = sortOps([...ops].reverse()).map((op) => op.hlc.deviceId);

    expect(forward).toEqual(["A", "B", "C"]);
    expect(backward).toEqual(forward);
  });
});

describe("createMemoryOpLog", () => {
  it("同 opId 重复追加是静默无操作（同步会重复投递，幂等是硬要求）", () => {
    const log = createMemoryOpLog();
    const op = makeOp({ deviceId: "A", wall: 1, counter: 0, type: "t" });

    log.append(op);
    log.append(op);
    log.append(op);

    expect(log.size).toBe(1);
    expect(log.has(op.opId)).toBe(true);
  });

  it("since 只返回 HLC 严格更大的操作", () => {
    const log = createMemoryOpLog();
    const first = makeOp({ deviceId: "A", wall: 100, counter: 0, type: "t" });
    const second = makeOp({ deviceId: "A", wall: 200, counter: 0, type: "t" });
    const third = makeOp({ deviceId: "A", wall: 300, counter: 0, type: "t" });
    [third, first, second].forEach((op) => log.append(op));

    expect(log.all()).toHaveLength(3);
    expect(log.since(undefined)).toHaveLength(3);
    expect(log.since(second.hlc).map((op) => op.hlc.wall)).toEqual([300]);
  });

  it("all() 始终按全序返回", () => {
    const log = createMemoryOpLog();
    [300, 100, 200].forEach((wall) => {
      log.append(makeOp({ deviceId: "A", wall, counter: 0, type: "t" }));
    });

    expect(log.all().map((op) => op.hlc.wall)).toEqual([100, 200, 300]);
  });
});

describe("foldOps", () => {
  const trace: (state: string[], op: Op) => string[] = (state, op) => [
    ...state,
    `${op.hlc.deviceId}@${op.hlc.wall}.${op.hlc.counter}`,
  ];

  it("按全序折叠，与追加顺序无关", () => {
    const ops = [
      { deviceId: "C", wall: 3, counter: 0, type: "t" },
      { deviceId: "A", wall: 1, counter: 0, type: "t" },
      { deviceId: "B", wall: 2, counter: 0, type: "t" },
    ].map(makeOp);

    const forward = foldOps(ops, [] as string[], trace);
    const backward = foldOps([...ops].reverse(), [] as string[], trace);

    expect(forward).toEqual(["A@1.0", "B@2.0", "C@3.0"]);
    expect(backward).toEqual(forward);
  });

  it("空日志返回初始状态", () => {
    expect(foldOps([], "init", (state: string) => state)).toBe("init");
  });

  it("同一实体的多次修改按时间叠加", () => {
    const entityId = ulid(1);
    const ops: Op[] = [10, 20, 30].map((wall) => ({
      opId: ulid(wall),
      hlc: { wall, counter: 0, deviceId: "A" },
      entityId,
      type: "counter.add",
      payload: 1,
      schemaVersion: 1,
    }));

    const total = foldOps(ops, 0, (state, op) => state + (op.payload as number));
    expect(total).toBe(3);
  });
});
