/**
 * 确定性伪随机数发生器。
 *
 * 模拟器里**禁止**使用 `Math.random()` 与 `Date.now()`。一旦引入真实随机或真实时间，
 * 测试就不再可复现 —— 而「偶发、无法复现」正是同步 bug 最难排查的形态
 * （open-questions #9 把建立这个模拟器列为 P0，理由就在这里）。
 */

import type { RandomBytes } from "../id.js";

/**
 * mulberry32：32 位种子，周期 2^32。
 * 选它是因为实现短、无依赖、且在任何平台上产出完全相同的序列。
 */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** 把 `[0, 1)` 随机源包成 core-sync 的 {@link RandomBytes}，供 ULID 生成使用。 */
export function createRandomBytes(source: () => number): RandomBytes {
  return (length) => {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
      bytes[i] = Math.floor(source() * 256);
    }
    return bytes;
  };
}

/**
 * 由「基础种子 + 设备 id」派生出设备专属种子。
 *
 * **必须按设备隔离随机流。** 如果所有设备共用一个随机源，
 * 那么「谁先生成 id」这种与测试意图无关的调度差异，会改变之后所有设备的 id，
 * 让模拟结果对不相关的变化过度敏感 —— 测试会因为无关改动而大面积变红。
 */
export function deriveSeed(baseSeed: number, deviceId: string): number {
  let hash = 2_166_136_261 ^ (baseSeed >>> 0);
  for (let i = 0; i < deviceId.length; i += 1) {
    hash ^= deviceId.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}
