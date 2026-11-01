import { isAbsolute, relative, resolve, sep } from 'node:path';

const callbackNames = ['onLog', 'onGetSrvCalTime', 'onShowErrUITips', 'fixPicImgType', 'getAppSetting', 'onInstallFinished', 'onUpdateGeneralFlag', 'onGetOfflineMsg'];

/**
 * 构造无账号字段的固定 QQ 桌面引擎配置；不创建目录或加载原生代码。
 * @param {{dataRoot: string, globalPath: string, osVersion: string}} options 本研究目录内的绝对路径及系统版本。
 * @returns {object} 仅含应用版本、平台、全局目录和缩略图配置；不包含登录票据。
 * @throws {Error} 路径越界或版本格式异常时拒绝生成。
 * @note 同步、无共享状态；路径联接的实际检查由执行前的本机预检负责。
 */
export function buildEngineConfig({ dataRoot, globalPath, osVersion }) {
  if (!isAbsolute(dataRoot) || !isAbsolute(globalPath)) throw new Error('ENGINE_PATH_NOT_ABSOLUTE');
  const delta = relative(resolve(dataRoot), resolve(globalPath));
  if (!delta || delta === '..' || delta.startsWith('..' + sep) || isAbsolute(delta)) throw new Error('ENGINE_PATH_OUTSIDE_ROOT');
  if (typeof osVersion !== 'string' || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(osVersion)) throw new Error('OS_VERSION_INVALID');
  return {
    base_path_prefix: '',
    platform_type: 3,
    app_type: 4,
    app_version: '9.9.35-52892',
    os_version: osVersion,
    use_xlog: false,
    qua: '',
    global_path_config: { desktopGlobalPath: resolve(globalPath) },
    thumb_config: { maxSide: 324, minSide: 48, longLimit: 6, density: 2 },
  };
}

/**
 * 提供引擎初始化要求的全局回调，只记录调用次数，忽略所有参数。
 * @returns {{adapter: object, readCounts: function(): object}} 回调对象及脱敏计数快照。
 * @note 不读取/保留回调参数，不发送消息、不返回账号字段；各调用实例独立。
 */
export function createCountingGlobalAdapter() {
  const counts = Object.fromEntries(callbackNames.map((name) => [name, 0]));
  const adapter = Object.fromEntries(callbackNames.map((name) => [name, function () {
    if (counts[name] < 1000000) counts[name]++;
  }]));
  return { adapter, readCounts: () => ({ ...counts }) };
}

function dataMethod(object, name) {
  for (let cursor = object, depth = 0; cursor && depth < 8; cursor = Object.getPrototypeOf(cursor), depth++) {
    const descriptor = Object.getOwnPropertyDescriptor(cursor, name);
    if (descriptor) {
      if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') throw new Error('METHOD_NOT_DATA_FUNCTION');
      return descriptor.value;
    }
  }
  throw new Error('METHOD_MISSING');
}

/**
 * 执行明确的引擎工厂/可选初始化/销毁顺序；本函数本身不授予执行权限。
 * @param {{wrapper: object, mode: string, config?: object, onStage?: function(string): Promise<void>}} options
 *   mode 只能是 create-destroy 或 initialize-destroy；onStage 只接收固定阶段名。
 * @returns {Promise<object>} 调用是否返回、失败阶段和必要清理标志；不输出原生返回值或异常正文。
 * @note 创建成功后即使初始化失败也尝试一次 destroy；0 参数 destroy 为待实测契约，
 *       外层必须使用有时限的独立进程。返回成功不代表登录、会话就绪或所有原生资源释放。
 */
export async function runEngineLifecycle({ wrapper, mode, config, onStage = async () => {} }) {
  if (!['create-destroy', 'initialize-destroy'].includes(mode)) throw new Error('ENGINE_MODE_REFUSED');
  if (mode === 'initialize-destroy' && (!config || config.app_version !== '9.9.35-52892')) throw new Error('ENGINE_CONFIG_REQUIRED');
  const { adapter, readCounts } = createCountingGlobalAdapter();
  const result = { engineCreated: false, initAttempted: false, initCallReturned: false,
    destroyAttempted: false, destroyCallReturned: false, errorStage: null, cleanupError: false,
    cleanupRequired: false, accountSessionAcquired: false };
  let engine;
  let stage = 'factory';
  try {
    const factory = Object.getOwnPropertyDescriptor(wrapper, 'NodeIQQNTWrapperEngine')?.value;
    const get = dataMethod(factory, 'get');
    await onStage('before_get');
    engine = Reflect.apply(get, factory, []);
    if (!engine || !['object', 'function'].includes(typeof engine)) throw new Error('ENGINE_OBJECT_MISSING');
    result.engineCreated = true;
    await onStage('after_get');
    // 在任何初始化前确认销毁入口是数据方法，不触发同名 getter。
    dataMethod(engine, 'destroy');
    if (mode === 'initialize-destroy') {
      stage = 'initialize';
      const initialize = dataMethod(engine, 'initWithDeskTopConfig');
      await onStage('before_initialize');
      result.initAttempted = true;
      const returned = Reflect.apply(initialize, engine, [config, adapter]);
      if (returned instanceof Promise) await returned;
      result.initCallReturned = true;
      await onStage('after_initialize');
    }
  } catch {
    result.errorStage = stage;
  } finally {
    if (result.engineCreated) {
      try {
        const destroy = dataMethod(engine, 'destroy');
        await onStage('before_destroy');
        result.destroyAttempted = true;
        const returned = Reflect.apply(destroy, engine, []);
        if (returned instanceof Promise) await returned;
        result.destroyCallReturned = true;
        await onStage('after_destroy');
      } catch {
        result.cleanupError = true;
        result.errorStage ??= 'destroy';
      }
    }
  }
  result.cleanupRequired = result.engineCreated && (!result.destroyCallReturned || result.cleanupError);
  result.callbackCounts = readCounts();
  return result;
}
