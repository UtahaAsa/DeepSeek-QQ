/** Windows权限辅助脚本的主入口消费声明；保留现有MJS实现，不执行权限操作。 */
export interface StateDirectoryHardening {ok:boolean;detail:unknown;}
/**
 * 按已有平台分支收紧指定目录，返回成功标记及诊断信息。
 * @param directory 调用者拥有的状态目录。
 * @returns 失败以ok=false表示，诊断内容未作业务校验；调用具有文件权限副作用。
 */
export function hardenDir(directory:string):StateDirectoryHardening;
/** 返回指定目录的手动修复命令文本，不执行命令、不修改权限。 */
export function manualDirCommand(directory:string):string;
