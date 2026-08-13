// 匿名设备标识：首次访问生成 uuid 存 localStorage，之后复用。
// 抽象成 KVStore 接口，测试时可注入内存实现，不依赖真实浏览器。
export interface KVStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export const DEVICE_KEY = "kaogong.device.v1";

export function getOrCreateDeviceId(
  storage: KVStore,
  gen: () => string = () => crypto.randomUUID(),
): string {
  const existing = storage.get(DEVICE_KEY);
  if (existing) return existing;
  const id = gen();
  storage.set(DEVICE_KEY, id);
  return id;
}

export function browserStorage(): KVStore {
  return {
    get: (k) => (typeof localStorage === "undefined" ? null : localStorage.getItem(k)),
    set: (k, v) => {
      if (typeof localStorage !== "undefined") localStorage.setItem(k, v);
    },
  };
}

export function getDeviceId(): string {
  return getOrCreateDeviceId(browserStorage());
}
