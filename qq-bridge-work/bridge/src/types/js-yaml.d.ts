/** 项目现有js-yaml读取接口的最小类型边界；载荷未知，调用方仍须检查结构。 */
declare module 'js-yaml' {
 const yaml: {load:(source:string)=>unknown};
 export default yaml;
}
