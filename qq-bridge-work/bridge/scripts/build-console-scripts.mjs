import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {renderConsole} from './build-console.mjs';

const bridge=path.resolve(import.meta.dirname,'..');
const read=file=>fs.readFileSync(file,'utf8');
function regularPath(root,relative,{missingLeaf=false}={}) {
  if(typeof relative!=='string'||! /^[a-z][a-z0-9/.-]*\.(?:ts|js|json)$/.test(relative)||relative.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('CONSOLE_TYPES_PATH_INVALID');
  let current=path.resolve(root);
  if(fs.lstatSync(current).isSymbolicLink())throw Error('CONSOLE_TYPES_LINK_REFUSED');
  const parts=relative.split('/');
  for(const [index,part] of parts.entries()){
    current=path.join(current,part);
    if(missingLeaf&&index===parts.length-1&&!fs.existsSync(current))continue;
    if(fs.lstatSync(current).isSymbolicLink())throw Error('CONSOLE_TYPES_LINK_REFUSED');
  }
  return current;
}

/**
 * 从实际页面生成静态元素类型；未知或动态ID仍使用浏览器的可空查询声明。
 * @param {string} html 不含业务脚本的页面标记。
 * @returns {string} DOM声明源码；重复ID直接失败，不写磁盘。
 */
export function createDomContract(html) {
  const ids=new Map();
  for(const match of html.matchAll(/<([a-z][a-z0-9-]*)\b[^>]*\bid="([^"]+)"[^>]*>/g)){
    if(ids.has(match[2]))throw Error('CONSOLE_DOM_ID_DUPLICATE: '+match[2]);ids.set(match[2],match[1]);
  }
  return `/** 由当前完整页面的静态DOM生成；业务脚本在body末尾执行。动态查询仍返回可空元素。 */
declare namespace QQConsole {
/** 现有页面把数组长度直接交给textContent；保留DOM的数值写入和字符串读取语义，不接受任意未知对象。 */
interface OwnedText {get textContent():string|null;set textContent(value:string|number|null);}
interface OwnedStringValue {get value():string;set value(value:string|number);}
type OwnedElement<Element> = Element extends {value:string}
 ? Omit<Element,'textContent'|'value'> & OwnedText & OwnedStringValue
 : Omit<Element,'textContent'> & OwnedText;
interface Elements {
${[...ids].map(([id,tag])=>JSON.stringify(id)+':OwnedElement<'+(tag==='svg'?'SVGElementTagNameMap':'HTMLElementTagNameMap')+'['+JSON.stringify(tag)+']>;').join('\n')}
}
type ValueElementId = {[Key in keyof Elements]:Elements[Key] extends {value:string}?Key:never}[keyof Elements];
}
interface Document {getElementById<Key extends keyof QQConsole.Elements>(id:Key):QQConsole.Elements[Key];}
`;
}

/**
 * 严格检查22个classic脚本及编译反例，按清单生成JS；测试源码永不发射。
 * @param {{projectDir?:string,mode?:'check'|'write'}} options 项目根与检查/写入模式。
 * @returns {{scripts:number,changed:number,mode:string}} 验证结果；类型或产物不一致即抛错。
 * @note 仅写源码目录中的声明与生成JS，不启动服务或请求API；类型通过前不写产物。
 */
export function buildConsoleScripts({projectDir=bridge,mode='check'}={}) {
  if(!['check','write'].includes(mode))throw Error('CONSOLE_TYPES_MODE_INVALID');
  const source=path.join(projectDir,'public/console-src');
  const manifest=JSON.parse(read(regularPath(source,'manifest.json')));
  if(manifest.version!==1||!Array.isArray(manifest.scripts))throw Error('CONSOLE_TYPES_MANIFEST_INVALID');
  const generated=[manifest.theme,...manifest.scripts];
  if(new Set(generated).size!==generated.length||generated.some(f=>typeof f!=='string'||!/^scripts\/[a-z][a-z0-9-]*\.js$/.test(f)))throw Error('CONSOLE_TYPES_SCRIPT_INVALID');
  const sources=generated.map(f=>regularPath(source,f.replace(/\.js$/,'.ts')));
  const declaration=regularPath(source,'types/dom-contract.d.ts',{missingLeaf:true});
  const dom=createDomContract(renderConsole(source,{includeScripts:false}));
  const configFile=regularPath(projectDir,'tsconfig.console.json');
  const config=ts.readConfigFile(configFile,ts.sys.readFile);
  if(config.error)throw Error(ts.flattenDiagnosticMessageText(config.error.messageText,'\n'));
  const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,projectDir);
  const expected=[declaration,...sources].map(f=>path.resolve(f)).sort();
  if(JSON.stringify(parsed.fileNames.map(f=>path.resolve(f)).sort())!==JSON.stringify(expected))throw Error('CONSOLE_TYPES_CONFIG_FILES_MISMATCH');
  if(!parsed.options.strict||parsed.options.skipLibCheck||parsed.options.verbatimModuleSyntax||parsed.options.moduleDetection!==ts.ModuleDetectionKind.Legacy||parsed.options.module!==ts.ModuleKind.ESNext||parsed.options.target!==ts.ScriptTarget.ES2022||parsed.options.types?.length!==0||!parsed.options.noEmit)throw Error('CONSOLE_TYPES_CONFIG_UNSAFE');
  for(const key of ['noImplicitAny','noImplicitThis','strictNullChecks','strictFunctionTypes','strictBindCallApply','strictPropertyInitialization','useUnknownInCatchVariables','strictBuiltinIteratorReturn'])if(parsed.options[key]===false)throw Error('CONSOLE_TYPES_STRICT_OVERRIDE: '+key);
  const host=ts.createCompilerHost(parsed.options),originalRead=host.readFile;
  host.readFile=file=>path.resolve(file)===declaration?dom:originalRead(file);
  const program=ts.createProgram(parsed.fileNames,parsed.options,host);
  const diagnostics=[...parsed.errors,...ts.getPreEmitDiagnostics(program)];
  if(diagnostics.length)throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>projectDir,getNewLine:()=> '\n'}));
  const checker=program.getTypeChecker(),namespaces=new Set();
  for(const [index,file] of sources.entries()){
    const ast=program.getSourceFile(file);
    if(ts.isExternalModule(ast)||/@ts-(?:ignore|nocheck|expect-error)/.test(ast.text))throw Error('CONSOLE_TYPES_SUPPRESSION_OR_MODULE');
    if(index>0){
      const root=ast.statements[0],feature=root?.body;
      if(ast.statements.length!==1||!ts.isModuleDeclaration(root)||root.name.text!=='QQConsole'||!feature||!ts.isModuleDeclaration(feature)||!ts.isModuleBlock(feature.body)||namespaces.has(feature.name.text))throw Error('CONSOLE_NAMESPACE_INVALID: '+path.basename(file));
      namespaces.add(feature.name.text);
      // 与迁移对照一致：顶层求值的跨功能引用必须指向已初始化的命名空间。
      function eager(node){
        if(ts.isFunctionLike(node)||ts.isTypeNode(node))return;
        if(ts.isPropertyAccessExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&ts.isIdentifier(node.expression.expression)&&node.expression.expression.text==='QQConsole'&&!namespaces.has(node.expression.name.text))throw Error('CONSOLE_NAMESPACE_ORDER: '+feature.name.text+' -> '+node.expression.name.text);
        ts.forEachChild(node,eager);
      }eager(feature.body);
    }
    function inspect(node){
      if(node.kind===ts.SyntaxKind.AnyKeyword)throw Error('CONSOLE_EXPLICIT_ANY: '+path.basename(file));
      if((ts.isVariableDeclaration(node)||ts.isParameter(node))&&ts.isIdentifier(node.name)&&/\bany\b/.test(checker.typeToString(checker.getTypeAtLocation(node.name),undefined,ts.TypeFormatFlags.NoTruncation)))throw Error('CONSOLE_INFERRED_ANY: '+path.basename(file)+':'+node.name.text);
      ts.forEachChild(node,inspect);
    }inspect(ast);
  }
  const outputs=new Map([[declaration,dom]]);
  for(const [index,file] of sources.entries()){
    // 类型检查使用完整strict；发射沿用已验证的classic-script选项，不新增use strict指令。
    const code=ts.transpileModule(read(file),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,verbatimModuleSyntax:true,alwaysStrict:false},fileName:file}).outputText;
    if(/^['"]use strict['"];?/m.test(code))throw Error('CONSOLE_CLASSIC_SCRIPT_CHANGED');
    outputs.set(regularPath(source,generated[index],{missingLeaf:true}),code);
  }
  const changed=[...outputs].filter(([file,content])=>!fs.existsSync(file)||read(file)!==content);
  if(mode==='check'&&changed.length)throw Error('CONSOLE_TYPES_GENERATED_STALE: '+changed.map(([file])=>path.relative(source,file)).join(', '));
  for(const [file,content] of mode==='write'?changed:[]){
    const next=file+'.generated-next';fs.writeFileSync(next,content,{flag:'wx'});fs.renameSync(next,file);
  }
  return {scripts:sources.length,changed:changed.length,mode};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==3||!['--check','--write'].includes(process.argv[2]))throw Error('CONSOLE_TYPES_BUILD_MODE_REQUIRED');
  console.log(JSON.stringify(buildConsoleScripts({mode:process.argv[2].slice(2)})));
}
