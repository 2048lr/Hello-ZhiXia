/**
 * ULID —— 全局唯一、可按时间排序、无需中心分配的标识符。
 *
 * 见 data-model.md 第一节：所有实体、操作、事件的主键一律使用 ULID。
 *
 * 格式：26 字符 Crockford Base32
 *   - 前 10 字符：48 位毫秒时间戳（前缀即时间，因此字典序 ≈ 创建顺序）
 *   - 后 16 字符：80 位随机
 *
 * 为什么不用数据库自增整数：在无中心的多设备环境里必然撞车，
 * 而一旦撞车，修复需要重写全部外键关系。ULID 也可以在完全不联网的设备上生成。
 *
 * 注意：内嵌的时间戳来自各设备自己的墙钟，只用于排序与调试，
 * **不可用于冲突判定** —— 冲突判定用 HLC（见 clock.ts）。
 */

/** Crockford Base32：去掉了容易混淆的 I、L、O、U。 */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const TIME_LEN = 10;
const RANDOM_LEN = 16;
const ULID_LEN = TIME_LEN + RANDOM_LEN;

/** 48 位时间戳上限，约公元 10889 年。 */
const MAX_TIME = 0xffff_ffff_ffff;

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * 品牌类型：避免把任意字符串当作 ULID 传递。
 * 需要通过 {@link isValidUlid} 或 {@link ulid} 才能得到它。
 */
export type Ulid = string & { readonly __ulidBrand: unique symbol };

export function isValidUlid(value: unknown): value is Ulid {
  return typeof value === "string" && ULID_RE.test(value);
}

export function assertUlid(value: unknown): asserts value is Ulid {
  if (!isValidUlid(value)) {
    throw new TypeError(`不是合法的 ULID：${String(value)}`);
  }
}

function encodeTime(time: number): string {
  if (!Number.isInteger(time) || time < 0 || time > MAX_TIME) {
    throw new RangeError(`时间戳超出 ULID 的 48 位范围：${time}`);
  }
  let out = "";
  let rest = time;
  for (let i = 0; i < TIME_LEN; i += 1) {
    out = CROCKFORD[rest % 32]! + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

/** 取出 ULID 内嵌的毫秒时间戳。仅用于展示与调试。 */
export function ulidTime(value: Ulid): number {
  let time = 0;
  for (let i = 0; i < TIME_LEN; i += 1) {
    time = time * 32 + CROCKFORD.indexOf(value[i]!);
  }
  return time;
}

/** WebCrypto 的最小结构类型。Node ≥ 19 与所有现代浏览器都提供 `globalThis.crypto`。 */
interface CryptoLike {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

/**
 * 取运行时的密码学随机源。
 *
 * 这里不直接写 `globalThis.crypto`：该全局在 `@types/node` 与 DOM lib 中的声明方式不一致，
 * 直接引用会让类型检查结果依赖 tsconfig 的 `lib` 组合（同一个包在 Node 与 Web 工程里表现不同）。
 * 显式读取并给出清晰错误，比让类型系统随环境漂移更可靠。
 */
function getCrypto(): CryptoLike {
  const candidate = (globalThis as { crypto?: CryptoLike }).crypto;
  if (candidate === undefined || typeof candidate.getRandomValues !== "function") {
    throw new Error("运行时没有提供 globalThis.crypto，无法为 ULID 生成安全的随机部分");
  }
  return candidate;
}

/**
 * 取 10 字节（80 位）随机数，按 5 位一组切成 16 个 Base32 数字。
 */
function randomDigits(): number[] {
  const bytes = new Uint8Array(10);
  getCrypto().getRandomValues(bytes);

  const digits: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      digits.push((acc >>> bits) & 31);
    }
  }
  return digits;
}

function format(time: number, digits: readonly number[]): Ulid {
  let out = encodeTime(time);
  for (const digit of digits) {
    out += CROCKFORD[digit]!;
  }
  return out as Ulid;
}

/** 生成一个新的 ULID。 */
export function ulid(seedTime: number = Date.now()): Ulid {
  return format(seedTime, randomDigits());
}

export type UlidFactory = (seedTime?: number) => Ulid;

/**
 * 单调递增工厂：同一毫秒内产生的 ULID 保证字典序严格递增
 * （做法是把 80 位随机部分当作整数 +1，而不是重新随机）。
 *
 * 适用于「按 id 排序必须等于按插入顺序排序」的场景。
 * 注意同一个工厂实例是有状态的，跨设备共享同一个实例会破坏这一点。
 */
export function createMonotonicUlidFactory(seedTime: number = Date.now()): UlidFactory {
  let lastTime = -1;
  let lastDigits: number[] = [];

  return (time: number = Date.now()): Ulid => {
    // 时钟回拨时也不倒退，保证单调性
    const effective = Math.max(time, lastTime);

    if (effective === lastTime) {
      let carry = true;
      for (let i = RANDOM_LEN - 1; i >= 0 && carry; i -= 1) {
        const next = lastDigits[i]! + 1;
        if (next > 31) {
          lastDigits[i] = 0;
        } else {
          lastDigits[i] = next;
          carry = false;
        }
      }
      if (carry) {
        throw new Error("同一毫秒内产生的 ULID 已耗尽随机位");
      }
    } else {
      lastTime = effective;
      lastDigits = randomDigits();
    }

    return format(lastTime, lastDigits);
  };
}
