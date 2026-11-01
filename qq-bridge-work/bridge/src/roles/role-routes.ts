/// <reference types="node" />
import type {SettingsRouteHandler} from '../config/settings-routes.js';
/** 人格存储绑定所属目录，同步操作完成后才返回成功响应。 */
export interface RoleRouteStore {
 readonly readRoleState: () => {role: string | null; mode: 'active'|'silent'};
 readonly writeRoleState: (role: string | null, mode: 'active'|'silent') => undefined;
 readonly roleSummaries: () => {name: string; [key: string]: unknown}[];
 readonly roleFilePath: (name: string) => string; readonly readRoleContent: (name: string) => string;
 readonly roleWarnings: (content: string) => unknown; readonly writeRoleContent: (name: string, content: string) => undefined;
 readonly getInjectLimit: () => number; readonly setInjectLimit: (limit: number) => number | undefined;
}
/** 删除/恢复参数保持unknown，在原有回收站边界验证；不授权操作其它路径。 */
export interface RoleRouteDependencies {
 readonly root: string; readonly store: RoleRouteStore;
 readonly trash: {list: () => unknown; remove: (name: unknown, clearCurrent: unknown) => unknown; restore: (id: unknown) => unknown};
 readonly readConfigObject: (file: string) => Record<string,unknown>;
 readonly atomicWriteJson: (file: string, value: Record<string,unknown>) => undefined;
 readonly onLimitChanged: (limit: number) => undefined; readonly log: (message: string) => void;
}
interface LegacyRoleError {message: string;}
import fs from 'node:fs';
import path from 'node:path';
import {ROLE_NAME_MAX,ROLE_CONTENT_MAX_BYTES,applyRoleInjectLimit,validateRoleName,validateRoleContent,sanitizeRoleName} from './role-policy.js';
import {roleCharStats,roleSectionReport} from '../role-card.js';
/**
 * 构造角色管理路由；调用前必须通过控制台统一鉴权、智能体隔离和同源检查。
 * @param {object} options root、store、trash绑定所属实例；配置读写、上限更新和日志由宿主提供。
 * @returns {function(object):Promise<boolean>} 已响应返回true；不匹配返回false，不读取请求体。
 * @throws {Error} 未在原端点处理的IO或请求错误交回宿主统一错误响应。
 * @note 构造无IO；异步请求处理保留原操作顺序，构造器不创建HTTP服务。
 */
export function createRoleRoutes({root:ROOT,store:roleStore,trash:roleTrash,readConfigObject,atomicWriteJson,onLimitChanged,log}: RoleRouteDependencies): SettingsRouteHandler {
  const {readRoleState,writeRoleState,roleSummaries,roleFilePath,readRoleContent,roleWarnings,writeRoleContent}=roleStore;
  return async function handleRoleRoute({method,url,readBody,sendJson}) {
    if (method === 'POST' && url.pathname === '/api/role') {
      const body = await readBody();
      const rs = readRoleState();
      if (body.role && typeof body.role === 'string') {
        const name = sanitizeRoleName(body.role);
        if (!fs.existsSync(path.join(ROOT, 'roles', name + '.md'))) {
          sendJson({ ok: false, error: `角色「${name}」不存在（roles/${name}.md）` }, 400);
          return true;
        }
        writeRoleState(name, rs.mode);
        log(`控制台：角色已设置为 ${name}`);
        sendJson({ ok: true, role: name });
      } else {
        writeRoleState(null, rs.mode);
        log('控制台：角色已清除');
        sendJson({ ok: true, role: null });
      }
      return true;
    }
    if (method === 'POST' && url.pathname === '/api/role-mode') {
      const body = await readBody();
      const rs = readRoleState();
      const mode = body.mode === 'silent' ? 'silent' : 'active';
      writeRoleState(rs.role, mode);
      log(`控制台：静默模式 ${mode === 'silent' ? '开启' : '关闭'}`);
      sendJson({ ok: true, roleMode: mode });
      return true;
    }
    // ── 人格管理 ──────────────────────────────────────────────────────────
    if (method === 'GET' && url.pathname === '/api/roles') {
      const rs = readRoleState();
      const summaries = roleSummaries();
      sendJson({
        // roles 保持「人格名字符串数组」的既有契约（scripts/test-console.mjs 等调用方依赖它）；
        // 富信息放在 summaries 里，新老调用方互不影响。
        roles: summaries.map((role) => role.name),
        summaries,
        current: rs.role ?? null,
        deletedRoles: roleTrash.list(),
        limits: { nameMax: ROLE_NAME_MAX, contentMaxBytes: ROLE_CONTENT_MAX_BYTES, injectMaxChars: roleStore.getInjectLimit() },
      });
      return true;
    }
    if (method === 'GET' && url.pathname === '/api/roles/content') {
      let name;
      try { name = validateRoleName(url.searchParams.get('name')); } catch (error) { sendJson({ ok: false, error: (error as LegacyRoleError).message }, 400); return true; }
      if (!fs.existsSync(roleFilePath(name))) { sendJson({ ok: false, error: `人格「${name}」不存在` }, 404); return true; }
      const content = readRoleContent(name);
      sendJson({
        ok: true,
        name,
        content,
        chars: content.length,
        bytes: Buffer.byteLength(content, 'utf8'),
        warnings: roleWarnings(content),
        limits: { injectMaxChars: roleStore.getInjectLimit() },
        stats: roleCharStats(content),
        // 每个小节在各模式下是否会被注入，供控制台预览「这条规则到底生不生效」
        sections: { v1: roleSectionReport(content, 'v1'), v2: roleSectionReport(content, 'v2') },
      });
      return true;
    }
    if (method === 'POST' && url.pathname === '/api/roles/limit') {
      const body = await readBody();
      const next = applyRoleInjectLimit(body.maxInjectChars);
      const configFile = path.join(ROOT, 'config.json');
      const file = readConfigObject(configFile);
      file.role = { ...(file.role as Record<string,unknown> ?? {}), maxInjectChars: next };
      atomicWriteJson(configFile, file);
      onLimitChanged(next);
      roleStore.setInjectLimit(next);
      log(`控制台：人格注入上限已设为 ${next} 字符（下一条消息生效）`);
      sendJson({ ok: true, maxInjectChars: next, limits: { injectMaxChars: next } });
      return true;
    }
    if (method === 'POST' && url.pathname === '/api/roles/create') {
      const body = await readBody();
      let name; let content;
      try { name = validateRoleName(body.name); content = validateRoleContent(body.content); }
      catch (error) { sendJson({ ok: false, error: (error as LegacyRoleError).message }, 400); return true; }
      if (fs.existsSync(roleFilePath(name))) { sendJson({ ok: false, error: `人格「${name}」已存在` }, 400); return true; }
      writeRoleContent(name, content);
      log(`控制台：创建人格「${name}」（${content.length} 字符）`);
      sendJson({ ok: true, role: name, warnings: roleWarnings(content) });
      return true;
    }
    if (method === 'POST' && url.pathname === '/api/roles/update') {
      const body = await readBody();
      let name; let content;
      try { name = validateRoleName(body.name); content = validateRoleContent(body.content); }
      catch (error) { sendJson({ ok: false, error: (error as LegacyRoleError).message }, 400); return true; }
      if (!fs.existsSync(roleFilePath(name))) { sendJson({ ok: false, error: `人格「${name}」不存在` }, 404); return true; }
      writeRoleContent(name, content);
      log(`控制台：更新人格「${name}」（${content.length} 字符）`);
      sendJson({ ok: true, role: name, chars: content.length, warnings: roleWarnings(content) });
      return true;
    }
    if (method === 'POST' && url.pathname === '/api/roles/rename') {
      const body = await readBody();
      let from; let to;
      try { from = validateRoleName(body.from); to = validateRoleName(body.to); }
      catch (error) { sendJson({ ok: false, error: (error as LegacyRoleError).message }, 400); return true; }
      if (from === to) { sendJson({ ok: true, role: to, renamed: false }); return true; }
      if (!fs.existsSync(roleFilePath(from))) { sendJson({ ok: false, error: `人格「${from}」不存在` }, 404); return true; }
      if (fs.existsSync(roleFilePath(to))) { sendJson({ ok: false, error: `人格「${to}」已存在` }, 400); return true; }
      fs.renameSync(roleFilePath(from), roleFilePath(to));
      const rs = readRoleState();
      const switched = rs.role === from;
      if (switched) writeRoleState(to, rs.mode);
      log(`控制台：人格重命名「${from}」→「${to}」${switched ? '（当前启用中，已跟随切换）' : ''}`);
      sendJson({ ok: true, role: to, renamed: true, currentFollowed: switched });
      return true;
    }
    if (method === 'POST' && url.pathname === '/api/roles/delete') {
      const body = await readBody();
      try { sendJson(roleTrash.remove(body.name, body.clearCurrent)); }
      catch (error) { sendJson({ ok: false, error: ['ROLE_IN_USE', 'ROLE_TRASH_FULL', 'ROLE_INPUT_INVALID'].includes((error as LegacyRoleError).message)
        ? (error as LegacyRoleError).message : 'ROLE_DELETE_FAILED' }, 400); }
      return true;
    }
    if (method === 'POST' && url.pathname === '/api/roles/restore') {
      const body = await readBody();
      try { sendJson(roleTrash.restore(body.restoreId)); }
      catch (error) { sendJson({ ok: false, error: ['ROLE_ALREADY_EXISTS', 'ROLE_INPUT_INVALID'].includes((error as LegacyRoleError).message)
        ? (error as LegacyRoleError).message : 'ROLE_RESTORE_FAILED' }, 400); }
      return true;
    }


    return false;
  };
}
