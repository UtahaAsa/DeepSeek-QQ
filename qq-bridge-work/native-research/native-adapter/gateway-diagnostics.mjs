const own = (value, key) => {
  try { return value == null ? undefined : Object.getOwnPropertyDescriptor(value, key)?.value; }
  catch { return undefined; }
};
const words = value => value.split(' ');
const accountOperations = words('idle startup_create session_get prepared session_config session_init startup_start await_initialization initialized initialization_unconfirmed');
const accountFailures = [...accountOperations, ...words('aborted initialization_timeout telemetry_initialize startup_stop')];
const backendStages = words('not_started message_service listener_remove_lookup image_store voice_store avatar_stage listener_registration group_admin friend_requests self_profile idle_observe active');
const setupStages = words('not_started backend_create backend_start send_policy onebot_server ready');
const states = words('idle preparing registering active ready failed stopped offline closed');
const errorCodes = words('NATIVE_METHOD_UNAVAILABLE SESSION_IDENTITY_INVALID SESSION_GUID_INVALID SESSION_OS_INVALID SESSION_PATH_INVALID SESSION_PATH_OUTSIDE_ROOT SESSION_STOPPED SESSION_NOT_READY PERMISSION_INVALID SCOPE_INVALID LIMIT_INVALID LISTENER_START_FAILED ASYNC_REGISTRATION_UNSUPPORTED GATEWAY_START_REFUSED GATEWAY_LISTENER_FAILED GATEWAY_CLEANUP_FAILED GROUP_ADMIN_UNAVAILABLE FRIEND_REQUEST_UNAVAILABLE SELF_PROFILE_UNAVAILABLE IMAGE_CONFIG_INVALID VOICE_CONFIG_INVALID FILESYSTEM_UNAVAILABLE UNCLASSIFIED_FAILURE');
const choice = (value, allowed) => allowed.includes(value) ? value : null;
const boolean = (value, key) => own(value, key) === true;
const accountFlags = words('prepared initializeAttempted initReturned startAttempted startReturned initCompleteObserved telemetryInitialized initialized stopAttempted stopReturned stopped');
const callbacks = words('onNTSessionCreate onGProSessionCreate onSessionInitComplete onOpentelemetryInit onUserOnlineResult onGetSelfTinyId onMSFStatusChange onMSFSsoError getGroupCode dispatchRequest dispatchCall dispatchCallWithJson');
const timedCallbacks = words('onNTSessionCreate onSessionInitComplete onOpentelemetryInit onMSFStatusChange');
const initializationSignals = words('init_return startup_return session_init_complete telemetry_initialized');
const boundedTime = (value, maximum = 86400000, minimum = 0) => Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : null;

/**
 * 将启动异常归为固定类别，不返回原生错误、堆栈、路径或任何回调内容。
 * @param {unknown} error 异常对象；只读取自身数据属性，不调用getter。
 * @returns {string} 固定安全错误码，未知错误统一归类。
 */
export function gatewayFailureCode(error) {
  const code = own(error, 'code'), message = own(error, 'message');
  if (['ENOENT', 'EACCES', 'EPERM', 'EBUSY'].includes(code)) return 'FILESYSTEM_UNAVAILABLE';
  return choice(code, errorCodes) ?? choice(message, errorCodes) ?? 'UNCLASSIFIED_FAILURE';
}

/**
 * 投影账号接入和网关准备诊断；可在worker和父监督器重复投影。
 * @param {object} value 内部快照，仅允许阶段枚举、布尔值、有界计数/耗时和固定MSF状态标签。
 * @returns {object} 无账号、二维码、正文、凭据、路径或任意错误原文的可序列化诊断。
 * @note 同步无I/O；不执行getter，不推断成功；未知阶段为null。
 */
export function projectGatewayDiagnostics(value) {
  const account = own(value, 'account'), gateway = own(value, 'gateway'), native = own(gateway, 'native');
  const counts = own(account, 'callbackCounts');
  const firstElapsed = own(account, 'callbackFirstElapsedMs'), missing = own(account, 'missingInitializationSignals');
  const missingSignals = new Set(), missingLength = own(missing, 'length');
  if (Number.isSafeInteger(missingLength) && missingLength >= 0 && missingLength <= initializationSignals.length) {
    for (let index = 0; index < missingLength; index++) {
      const signal = own(missing, String(index));
      if (initializationSignals.includes(signal)) missingSignals.add(signal);
    }
  }
  return {
    handoffStage: choice(own(value, 'handoffStage'), words('not_started machine_guid account_initialize account_unconfirmed gateway_run gateway_ended')),
    handoffFailureCode: choice(own(value, 'handoffFailureCode'), errorCodes),
    account: { ...Object.fromEntries(accountFlags.map(key => [key, boolean(account, key)])),
      operation: choice(own(account, 'operation'), accountOperations), failurePoint: choice(own(account, 'failurePoint'), accountFailures),
      initializationBudgetMs: boundedTime(own(account, 'initializationBudgetMs'), 120000, 10),
      initializationElapsedMs: boundedTime(own(account, 'initializationElapsedMs')),
      missingInitializationSignals: initializationSignals.filter(signal => missingSignals.has(signal)),
      callbackFirstElapsedMs: Object.fromEntries(timedCallbacks.map(key => [key, boundedTime(own(firstElapsed, key))])),
      msfStatus: choice(own(account, 'msfStatus'), words('unknown disconnected connected')),
      msfChangeReason: choice(own(account, 'msfChangeReason'), words('unknown user_login user_logout auto')),
      callbackCounts: Object.fromEntries(callbacks.map(key => { const count = own(counts, key);
        return [key, Number.isSafeInteger(count) && count >= 0 && count <= 1000000 ? count : 0]; })) },
    gateway: { state: choice(own(gateway, 'state'), states), setupStage: choice(own(gateway, 'setupStage'), setupStages),
      setupFailureCode: choice(own(gateway, 'setupFailureCode'), errorCodes),
      ...Object.fromEntries(words('receiveImages sendImages receiveVoice sendVoice readSelfAvatar generateImages useStickers collectStickers').map(key => [key, boolean(gateway, key)])),
      native: { state: choice(own(native, 'state'), states), startStage: choice(own(native, 'startStage'), backendStages),
        startFailureCode: choice(own(native, 'startFailureCode'), errorCodes),
        listenerHandleKind: choice(own(native, 'listenerHandleKind'), words('unobserved null number string undefined object bigint boolean function symbol')),
        ...(own(native,'images') ? {images:{
          ...Object.fromEntries(words('observed downloaded downloadFailures cacheHits renderedEmojiHits cacheContentMisses').map(key=>{const value=own(own(native,'images'),key);return[key,Number.isSafeInteger(value)&&value>=0?value:0];})),
          lastFailureStage:choice(own(own(native,'images'),'lastFailureStage'),words('cache download verify')),
          lastFailureCode:choice(own(own(native,'images'),'lastFailureCode'),words('IMAGE_DOWNLOAD_FAILED IMAGE_DOWNLOAD_TIMEOUT IMAGE_DISABLED IMAGE_FILE_REFUSED IMAGE_LIMIT IMAGE_SIZE_MISMATCH IMAGE_CONTENT_MISMATCH IMAGE_FORMAT_INVALID'))
        }} : {}),
        ...Object.fromEntries(words('listenerRemovalVerified cleanupRequired mediaCleanupFailed socialCleanupFailed profileCleanupFailed stickerCleanupFailed').map(key => [key, boolean(native, key)])),
        ...(own(native, 'stickers') ? { stickers: Object.fromEntries(words('listReads collectAttempts confirmed alreadyCollected unknown stagedFiles').map(key => {
          const value = own(own(native, 'stickers'), key); return [key, Number.isSafeInteger(value) && value >= 0 && value <= 1000000 ? value : 0];
        })) } : {}),
        ...Object.fromEntries(['groupAdmin', 'friendRequests', 'selfProfile'].filter(key => own(native, key) && typeof own(native, key) === 'object').map(key => {
          const value = own(native, key);
          return [key, { state: choice(own(value, 'state'), states),
            listenerHandleKind: choice(own(value, 'listenerHandleKind'), words('unobserved null number string undefined object bigint boolean function symbol')),
            removalVerified: boolean(value, 'removalVerified'), cleanupRequired: boolean(value, 'cleanupRequired') }];
        })) } },
  };
}
