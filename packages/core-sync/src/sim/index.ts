/**
 * 确定性多节点同步模拟器。
 *
 * 用法：
 *
 * ```ts
 * const sim = createSimulator({ seed: 42, lossRate: 0.3 });
 * const a = sim.addDevice("A");
 * const b = sim.addDevice("B");
 *
 * a.write(a.newEntityId(), "note.create", { title: "hi" });
 * sim.run(100);
 *
 * expect(sim.converged()).toBe(true);
 * ```
 *
 * 关键性质：**同一个种子必然得到同一份 trace**（`sim.traceDigest()`）。
 * 因此任何一次失败的测试都可以被精确重放。
 */

export * from "./device.js";
export * from "./random.js";
export * from "./simulator.js";
