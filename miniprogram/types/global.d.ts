/// <reference types="@tarojs/taro" />

declare module '*.css'

declare namespace NodeJS {
  interface ProcessEnv {
    TARO_APP_API_BASE?: string
  }
}
