/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** 后端 API 地址，部署时用环境变量 PUBLIC_API_BASE 注入 */
  readonly PUBLIC_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
