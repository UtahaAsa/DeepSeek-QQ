/// <reference types="node" />
interface MemberError {message?:unknown;}
interface GroupMember {user_id?:unknown;card?:unknown;nickname?:unknown;}
type GroupMemberResponse=GroupMember[]|{data?:GroupMember[]}|null|undefined;
export interface GroupMemberDependencies {readonly Date:DateConstructor;readonly bot:{getGroupMemberList:(groupId:number)=>Promise<unknown>;getGroupMemberInfo:(groupId:number,userId:number)=>Promise<unknown>};}
/**
 * 持有群成员名片和成员资格缓存，构造无IO。
 * @param deps 所属网关查询及时间能力；原始昵称值保持unknown，到展示边界再转换。
 * @returns 昵称查询失败返回null，成员资格查询失败/空列表返回拒绝原因；TTL与容量策略保持。
 * @note 缓存仅属于当前桥接实例，不持久化成员资料；输入输出沿原协议投影而非新增载荷验证。
 */
export function createGroupMembers(deps:GroupMemberDependencies) {
const groupMemberNameCache = new Map<string,{name:unknown;ts:number}>();
const GROUP_MEMBER_NAME_TTL_MS = 5 * 60 * 1000;
const groupMemberIdsCache = new Map<string,{ids:Set<string>;ts:number}>();
const GROUP_MEMBER_IDS_TTL_MS = 60 * 1000;
function pruneGroupMemberNameCache() {
    const now = deps.Date.now();
    for (const [k, v] of groupMemberNameCache) {
      if (now - v.ts > GROUP_MEMBER_NAME_TTL_MS) groupMemberNameCache.delete(k);
    }
    if (groupMemberNameCache.size > 2000) {
      const keys = [...groupMemberNameCache.keys()].slice(0, groupMemberNameCache.size - 2000);
      for (const k of keys) groupMemberNameCache.delete(k);
    }
  }

async function assertGroupMember(groupId:unknown, userId:unknown):Promise<string|null> {
    const gid = String(groupId);
    const uid = String(userId);
    let cached = groupMemberIdsCache.get(gid);
    if (!cached || deps.Date.now() - cached.ts > GROUP_MEMBER_IDS_TTL_MS) {
      let list:GroupMemberResponse;
      try {
        list = await deps.bot.getGroupMemberList(Number(gid)) as GroupMemberResponse;
      } catch (error) {
        // 失败即拒绝（fail-closed）：宁可拍不出去，也不要绕过校验。
        return `无法获取群 ${gid} 的成员列表：${(error as MemberError|null)?.message ?? error}`;
      }
      const members = Array.isArray(list) ? list : (list?.data ?? []);
      const ids = new Set(members.map((m) => String(m?.user_id ?? '')).filter(Boolean));
      if (!ids.size) return `群 ${gid} 的成员列表为空，无法校验拍一拍目标`;
      cached = { ids, ts: deps.Date.now() };
      groupMemberIdsCache.set(gid, cached);
      if (groupMemberIdsCache.size > 50) {
        for (const [k, v] of groupMemberIdsCache) {
          if (deps.Date.now() - v.ts > 10 * 60 * 1000) groupMemberIdsCache.delete(k);
        }
      }
    }
    return cached.ids.has(uid) ? null : `QQ ${uid} 不是群 ${gid} 的成员，已拒绝拍一拍`;
  }

async function resolveGroupMemberName(groupId:unknown, userId:unknown):Promise<unknown> {
    const key = `${String(groupId)}:${String(userId)}`;
    const hit = groupMemberNameCache.get(key);
    if (hit && deps.Date.now() - hit.ts < GROUP_MEMBER_NAME_TTL_MS) return hit.name;
    try {
      // 优先精确查询单个成员（快，适合单条 @）
      let name:unknown = null;
      try {
        const info = await deps.bot.getGroupMemberInfo(Number(groupId), Number(userId)) as GroupMember|null;
        name = info?.card || info?.nickname || null;
      } catch {}
      if (name) {
        groupMemberNameCache.set(key, { name, ts: deps.Date.now() });
        pruneGroupMemberNameCache();
        return name;
      }
      // 回退：拉一次整群成员列表并建立整组缓存（兼容未实现 get_group_member_info 的网关）
      const list = await deps.bot.getGroupMemberList(Number(groupId)) as GroupMemberResponse;
      const members = Array.isArray(list) ? list : (list?.data ?? []);
      const now = deps.Date.now();
      for (const m of members) {
        const n = m?.card || m?.nickname || null;
        if (n) groupMemberNameCache.set(`${String(groupId)}:${String(m.user_id)}`, { name: n, ts: now });
      }
      pruneGroupMemberNameCache();
      name = groupMemberNameCache.get(key)?.name ?? null;
      return name;
    } catch {
      return null;
    }
  }
return {pruneGroupMemberNameCache,assertGroupMember,resolveGroupMemberName};
}
