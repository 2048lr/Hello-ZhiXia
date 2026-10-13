/**
 * @hzx/platform-adapters —— 平台适配层。
 *
 * 三端各自实现同一组接口，隔离平台差异。**目前是空骨架，尚未实现。**
 *
 * 需要适配的能力，以及各自的平台差异：
 *
 * | 能力 | Windows | Linux | Android |
 * | --- | --- | --- | --- |
 * | 系统闹钟 | 任务计划程序 | systemd-timer / 桌面提醒 | AlarmManager |
 * | 通知 | 系统通知 | 桌面通知 | 通知渠道 |
 * | 钥匙串 | Credential Manager | libsecret | Keystore |
 * | 文件系统 | 原生 | 原生 | 受分区存储限制 |
 * | 网络发现 | mDNS | mDNS | 受后台限制，不可依赖常驻 |
 *
 * 闹钟适配尤其关键：ADR-0011 把提醒的**投递**下放给了本地系统闹钟，
 * 因此三端的闹钟实现直接决定提醒可不可靠。
 */
export {};
