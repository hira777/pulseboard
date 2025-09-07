'use client'

/**
 * 汎用 WebSocket 抽象。
 * - どのドメインからでも publish/subscribe できる
 * - ここではドメイン知識（metrics など）を一切持たない
 * - 後で生WebSocketに差し替えやすいIF
 */

export type WSStatus = 'connecting' | 'open' | 'closed' | 'reconnecting'
type Handler<T = unknown> = (data: T) => void

class WSClient {
  private status: WSStatus = 'closed'
  private handlers = new Map<string, Set<Handler>>()

  getStatus(): WSStatus {
    return this.status
  }

  /**
   * 共有コネクション開始（今はモック：実WSに差し替え可）
   * @param _url 実装時に利用するWSサーバURLなど
   */
  async connect(_url?: string) {
    if (this.status === 'open' || this.status === 'connecting') return
    this.status = 'connecting'
    await new Promise((r) => setTimeout(r, 200)) // 擬似接続待ち
    this.status = 'open'
  }

  disconnect() {
    this.status = 'closed'
    // ここで実WSなら socket.close() など
  }

  /**
   * 任意トピックを購読
   */
  subscribe<T = unknown>(topic: string, handler: Handler<T>) {
    if (!this.handlers.has(topic)) this.handlers.set(topic, new Set())
    this.handlers.get(topic)!.add(handler as Handler)
    return () => {
      this.handlers.get(topic)?.delete(handler as Handler)
    }
  }

  /**
   * 任意トピックにイベントを流す（ドメイン側から利用）
   */
  publish<T = unknown>(topic: string, data: T) {
    this.handlers.get(topic)?.forEach((h) => h(data))
  }

  /**
   * 実WS向けの raw 送信口（必要に応じて利用）
   */
  send(_raw: unknown) {
    // 実装時に socket.send(...) 等へ
  }
}

export const wsClient = new WSClient()
