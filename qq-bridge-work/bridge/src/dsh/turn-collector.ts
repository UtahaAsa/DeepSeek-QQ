/** 事件字段沿DSH契约投影，正文块只有在原有type/typeof检查通过后才累加。 */
export interface DshTextBlock {type?:unknown;text?:unknown;}
export interface DshCollectorEvent {type?:unknown;data?:unknown;}
/** 旧分支实际读取的数据结构；只在消费点投影，不宣称外层事件已校验载荷。 */
export interface DshCollectorData {turn?:unknown;reason?:unknown;message?:{content?:readonly (DshTextBlock|null|undefined)[]|null}|null;}
export interface DshCollectedTurn {turn:unknown;reason:unknown;text:string;}
/** 在会话事件流里收集一次 turn 的 assistant 文本（按 turn 分组）。 */
export function createTurnCollector() {
  const turns = new Map<unknown,{text:string}>(); // turn -> { text }
  return {
    /** 处理一条 session/event，返回该事件是否终结了一个 turn（此时可取最终文本）。 */
    push(event:DshCollectorEvent):DshCollectedTurn|null {
      if (event.type === 'turn/start') {
        turns.set((event.data as DshCollectorData).turn, { text: '' });
        return null;
      }
      if (event.type === 'assistant/chunk') {
        // 忽略流式分块：assistant/message 携带同一内容的完整组装文本，
        // 两者都累加会导致回复文本翻倍（曾因此把「收到」发成「收到收到」）。
        return null;
      }
      if (event.type === 'assistant/message') {
        const t = turns.get((event.data as DshCollectorData).turn);
        if (!t) return null;
        for (const block of (event.data as DshCollectorData).message?.content ?? []) {
          if (block?.type === 'text' && typeof block.text === 'string') t.text += block.text;
        }
        return null;
      }
      if (event.type === 'turn/end') {
        const t = turns.get((event.data as DshCollectorData).turn);
        turns.delete((event.data as DshCollectorData).turn);
        if (!t) return null;
        return { turn: (event.data as DshCollectorData).turn, reason: (event.data as DshCollectorData).reason, text: t.text };
      }
      return null;
    },
    has(turn:unknown) {
      return turns.has(turn);
    },
    /** 当前仍在跟踪（有 start 无 end）的回合数。供调用方判断 collector 是否已成空壳。 */
    size() {
      return turns.size;
    }
  };
}

/** 从 assistant 消息的 ContentBlock[] 中提取纯文本。 */
export function blocksToText(content:readonly (DshTextBlock|null|undefined)[]|null|undefined) {
  return (content ?? [])
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b!.text as string)
    .join('');
}
