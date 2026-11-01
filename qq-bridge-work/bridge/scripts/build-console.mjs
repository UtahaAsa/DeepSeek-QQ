import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const bridge=path.resolve(import.meta.dirname,'..');
/**
 * 按显式清单拼装控制台，保持原单页的标记、样式顺序和脚本作用域。
 * @param {string} sourceDir 模块源码目录，默认项目public/console-src。
 * @param {{includeScripts?:boolean}} options false时只拼页面标记，用于生成DOM类型，避免依赖旧JS产物。
 * @returns {string} 页面内容；不写文件。非法路径、链接或未知占位符会抛出异常。
 */
export function renderConsole(sourceDir=path.join(bridge,'public/console-src'),{includeScripts=true}={}) {
  const root=path.resolve(sourceDir);
  const read=relative=>{
    if(typeof relative!=='string'||! /^[a-z][a-z0-9/-]*\.(html|css|js|json)$/.test(relative)||relative.split('/').some(part=>part==='..'||!part))throw Error('CONSOLE_SOURCE_PATH_INVALID');
    let current=root;
    if(fs.lstatSync(current).isSymbolicLink())throw Error('CONSOLE_SOURCE_LINK_REFUSED');
    for(const part of relative.split('/')){current=path.join(current,part);if(fs.lstatSync(current).isSymbolicLink())throw Error('CONSOLE_SOURCE_LINK_REFUSED');}
    return fs.readFileSync(current,'utf8');
  };
  const manifest=JSON.parse(read('manifest.json'));
  if(manifest.version!==1||!Array.isArray(manifest.styles)||!Array.isArray(manifest.scripts)||!manifest.sections)throw Error('CONSOLE_MANIFEST_INVALID');
  const consumed=new Set();
  const html=read(manifest.template).replace(/\{\{CONSOLE:([^}]+)\}\}/g,(_marker,key)=>{
    if(consumed.has(key))throw Error('CONSOLE_PLACEHOLDER_DUPLICATE');consumed.add(key);
    const paths=key==='styles'?manifest.styles:key==='scripts'?manifest.scripts:key==='theme'?[manifest.theme]:
      key.startsWith('section:')&&Object.hasOwn(manifest.sections,key.slice(8))?[manifest.sections[key.slice(8)]]:null;
    if(!paths)throw Error('CONSOLE_PLACEHOLDER_UNKNOWN');
    if(!includeScripts&&(key==='scripts'||key==='theme'))return '';
    return paths.map(read).join('');
  });
  if(!['theme','styles','scripts',...Object.keys(manifest.sections).map(key=>'section:'+key)].every(key=>consumed.has(key)))throw Error('CONSOLE_PLACEHOLDER_MISSING');
  if(html.includes('{{CONSOLE:'))throw Error('CONSOLE_PLACEHOLDER_UNRESOLVED');
  return html;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const mode=process.argv[2];if(process.argv.length!==3||!['--check','--write'].includes(mode))throw Error('CONSOLE_BUILD_MODE_REQUIRED');
  const target=path.join(bridge,'public/console.html'),expected=renderConsole();
  if(fs.existsSync(target)&&fs.lstatSync(target).isSymbolicLink())throw Error('CONSOLE_OUTPUT_LINK_REFUSED');
  const changed=!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==expected;
  if(mode==='--check'&&changed){console.error('CONSOLE_GENERATED_STALE');process.exitCode=1;}
  else {
    if(mode==='--write'&&changed){const next=target+'.generated-next';fs.writeFileSync(next,expected,{flag:'wx'});fs.renameSync(next,target);}
    console.log(JSON.stringify({status:mode==='--check'?'verified':'built',artifact:'public/console.html',updated:mode==='--write'&&changed?1:0}));
  }
}
