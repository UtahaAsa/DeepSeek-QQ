/**
 * 在页内等待本人确认，不阻塞浏览器事件循环。
 * @param {string} message 固定操作说明，仅作为文字显示。
 * @returns {Promise<boolean>} 确认返回true，取消/Escape返回false；已有确认框时拒绝重复发起。
 * @note 调用方须在确认后重新校验操作版本；不替代服务端权限检查。
 */
export function confirmAction(message) {
  const dialog = document.getElementById('confirm-dialog');
  if (!dialog || dialog.open) return Promise.resolve(false);
  document.getElementById('confirm-message').textContent = message;
  dialog.returnValue = 'cancel';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    dialog.showModal();
  });
}
