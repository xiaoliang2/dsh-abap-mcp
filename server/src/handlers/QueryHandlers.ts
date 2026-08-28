import { ADTClient } from 'abap-adt-api';
import { BaseHandler } from './BaseHandler.js';
import type { ToolDefinition } from '../types/tools.js';

// runQuery 走 ADT Data Preview 的 freestyle SQL 端点，本应只读，但部分后端允许 DML。
// 为堵死「无权限、无写确认的隐藏写通道」，这里做确定性白名单：只放行 SELECT 类只读
// 语句，且不允许分号拼接多语句。命中非白名单前缀 → 抛错，绝不把语句发给后端。
const READ_ONLY_SQL_RE = /^\s*(SELECT|WITH|EXPLAIN|DESCRIBE)\b/i;

function assertReadOnlyQuery(sql: string): void {
    const trimmed = (sql ?? '').trim();
    if (trimmed.length === 0) {
        throw new Error('runQuery: 空 SQL 不允许执行');
    }
    if (trimmed.includes(';')) {
        throw new Error('runQuery: 不允许分号拼接多语句（仅支持单条只读查询）');
    }
    if (!READ_ONLY_SQL_RE.test(trimmed)) {
        throw new Error(
            `runQuery: 只允许只读 SQL（SELECT / WITH / EXPLAIN / DESCRIBE），拒绝执行：${trimmed.slice(0, 120)}`
        );
    }
}

export class QueryHandlers extends BaseHandler {
    getTools(): ToolDefinition[] {
        return [
            {
                name: 'tableContents',
                description: 'Retrieves the contents of an ABAP table.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        ddicEntityName: {
                            type: 'string',
                            description: 'The name of the DDIC entity (table or view).'
                        },
                        rowNumber: {
                            type: 'number',
                            description: 'The maximum number of rows to retrieve.',
                            optional: true
                        },
                        decode: {
                            type: 'boolean',
                            description: 'Whether to decode the data.',
                            optional: true
                        },
                        sqlQuery: {
                            type: 'string',
                            description: 'An optional SQL query to filter the data.',
                            optional: true
                        }
                    },
                    required: ['ddicEntityName']
                }
            },
            {
                name: 'runQuery',
                description: 'Runs a SQL query on the target system.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        sqlQuery: {
                            type: 'string',
                            description: 'The SQL query to execute.'
                        },
                        rowNumber: {
                            type: 'number',
                            description: 'The maximum number of rows to retrieve.',
                            optional: true
                        },
                        decode: {
                            type: 'boolean',
                            description: 'Whether to decode the data.',
                            optional: true
                        }
                    },
                    required: ['sqlQuery']
                }
            }
        ];
    }

    async handle(toolName: string, arguments_: any): Promise<any> {
        switch (toolName) {
            case 'tableContents':
                return this.handleTableContents(arguments_);
            case 'runQuery':
                return this.handleRunQuery(arguments_);
            default:
                throw new Error(`Tool ${toolName} not implemented in QueryHandlers`);
        }
    }

    async handleTableContents(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.tableContents(
                args.ddicEntityName,
                args.rowNumber,
                args.decode,
                args.sqlQuery
            );
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new Error(`Failed to retrieve table contents: ${error.message || 'Unknown error'}`);
        }
    }

    async handleRunQuery(args: any): Promise<any> {
        const startTime = performance.now();
        try {
            const sql = typeof args?.sqlQuery === 'string' ? args.sqlQuery : '';
            assertReadOnlyQuery(sql);
            const result = await this.adtclient.runQuery(
                sql,
                args.rowNumber,
                args.decode
            );
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            status: 'success',
                            result
                        })
                    }
                ]
            };
        } catch (error: any) {
            this.trackRequest(startTime, false);
            throw new Error(`Failed to run query: ${error.message || 'Unknown error'}`);
        }
    }
}
