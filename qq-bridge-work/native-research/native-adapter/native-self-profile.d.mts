/** 自身资料许可的纯函数消费边界；不表示原生资料写入实现已完成TS迁移。 */
export type SelfProfileField='nickname'|'signature'|'birthday'|'avatar';
/** 拒绝访问器、符号、未知字段与非布尔值；省略项为false。无I/O，返回冻结副本。 */
export declare function normalizeSelfProfilePermissions(value?:unknown):Readonly<Record<SelfProfileField,boolean>>;
