/** 串行链可承接任意结果；wait只承诺当前尾部的未知结果，原生提交保留本次泛型回执。 */
export interface SendQueue {
 readonly append: (operation: (previous: unknown) => unknown) => SendQueue;
 readonly recover: (onFailure: (error: unknown) => unknown) => SendQueue;
 readonly wait: () => Promise<unknown>;
 readonly enqueueNative: <Result>(operation: (previous: unknown) => Result | PromiseLike<Result>) => Promise<Result>;
}
/** 延迟必须可等待；间隔在发送后同步读取，不固定为构造时快照。 */
export interface SendQueueDependencies {readonly sleep: (ms: number) => Promise<unknown>; readonly getNativeDelay: () => number;}
/**
 * 创建所属桥接共享的串行发送链，供文本、语音、表情及分条发送共同使用。
 * @param {object} options sleep为延迟能力，getNativeDelay在原生发送结束后读取当前间隔。
 * @returns {object} append/recover依次扩展发送链；wait取得当前尾部；enqueueNative返回本次发送结果。
 * @note 不自动重发；原生发送失败仍保留后续间隔。策略检查由排队操作在实际提交前执行。
 */
export function createSendQueue({sleep,getNativeDelay}: SendQueueDependencies): SendQueue {
  let tail: Promise<unknown>=Promise.resolve();
  const queue: SendQueue={
    append(operation){tail=tail.then(operation);return queue;},
    recover(onFailure){tail=tail.catch(onFailure);return queue;},
    wait(){return tail;},
    enqueueNative(operation){
      const sent=tail.then(operation);
      tail=sent.catch(()=>{}).then(()=>sleep(getNativeDelay()));
      return sent;
    }
  };
  return Object.freeze(queue);
}
