// @vitest-environment jsdom
import {useState} from 'react';
import {afterEach,expect,test,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {DailyPlanEditor} from '../../src/components/DailyPlanEditor';
import type {DailyPlanRow} from '../../src/domain/planning';
import type {BusinessRecord} from '../../src/domain/types';
afterEach(()=>{cleanup();vi.useRealTimers();});
const rows:DailyPlanRow[]=[{date:'2026-10-06',size:'L',units:10},{date:'2026-10-06',size:'XL',units:20},{date:'2026-10-06',size:'2XL',units:0},{date:'2026-10-06',size:'3XL',units:5},{date:'2026-10-07',size:'L',units:2965}];
const business:BusinessRecord[]=[{key:'a',date:'2026-10-06',size:'L',asin:'a',sku:'a',units:4,sales:40},{key:'b',date:'2026-10-06',size:'L',asin:'b',sku:'b',units:8,sales:80},{key:'c',date:'2026-10-06',size:'XL',asin:'c',sku:'c',units:0,sales:0}];
function Harness({onSave=vi.fn()}:{onSave?: (rows: DailyPlanRow[], reason: string) => void}={}){const[draft,setDraft]=useState(rows);return <DailyPlanEditor rows={draft} savedRows={rows} business={business} onRowsChange={setDraft} onSave={onSave} locale="zh"><label>录入草稿<input aria-label="录入草稿" defaultValue=""/></label></DailyPlanEditor>;}
test('compares actual-minus-plan per day and size, adds SKU sales and keeps missing different from zero',()=>{
 render(<Harness/>);
 const table=screen.getByRole('table',{name:'每日尺码计划与实际对比'});
 expect(within(table).getByLabelText('2026-10-06 L 实际销量').textContent).toBe('12');
 expect(within(table).getByLabelText('2026-10-06 L 销量差异').textContent).toBe('+2');
 expect(within(table).getByLabelText('2026-10-06 XL 销量差异').textContent).toBe('-20');
 expect(within(table).getByLabelText('2026-10-06 2XL 实际销量').textContent).toBe('未录入');
 expect(within(table).getByLabelText('2026-10-07 XL 销量差异').textContent).toBe('—');
});
test('an unfinished plan input remains unknown and never renders NaN',()=>{
 render(<Harness/>);
 fireEvent.change(screen.getByLabelText('2026-10-06 L 计划销量'),{target:{value:''}});
 expect(screen.getByLabelText('Daily plan editor').textContent).not.toContain('NaN');
 expect(screen.getByLabelText('2026-10-06 L 销量差异').textContent).toBe('—');
 expect((screen.getByRole('button',{name:'保存计划'}) as HTMLButtonElement).disabled).toBe(true);
});
test('date filtering changes comparison scope but saves the whole plan and hidden edits',()=>{
 const onSave=vi.fn();render(<Harness onSave={onSave}/>);
 fireEvent.change(screen.getByLabelText('2026-10-07 L 计划销量'),{target:{value:'2966'}});
 fireEvent.change(screen.getByLabelText('对比开始日期'),{target:{value:'2026-10-06'}});
 fireEvent.change(screen.getByLabelText('对比结束日期'),{target:{value:'2026-10-06'}});
 expect(screen.queryByLabelText('2026-10-07 L 计划销量')).toBeNull();
 expect(screen.getByLabelText('L 筛选汇总').textContent).toContain('计划 10');
 expect(screen.getByLabelText('L 筛选汇总').textContent).toContain('实际 12');
 fireEvent.change(screen.getByLabelText('调整原因'),{target:{value:'保留范围外修改'}});
 fireEvent.click(screen.getByRole('button',{name:'保存计划'}));
 expect(onSave.mock.calls[0][0]).toHaveLength(5);
 expect(onSave.mock.calls[0][0][4].units).toBe(2966);
 fireEvent.click(screen.getByRole('button',{name:'全部日期'}));
 expect((screen.getByLabelText('2026-10-07 L 计划销量') as HTMLInputElement).value).toBe('2966');
});
test('collapse keeps summary, range and both manual drafts without unmounting',()=>{
 render(<Harness/>);
 fireEvent.change(screen.getByLabelText('2026-10-06 L 计划销量'),{target:{value:'11'}});
 fireEvent.change(screen.getByLabelText('录入草稿'),{target:{value:'尚未保存'}});
 fireEvent.click(screen.getByRole('button',{name:'收起日度明细'}));
 expect(screen.queryByRole('table',{name:'每日尺码计划与实际对比'})).toBeNull();
 expect(screen.getByLabelText('L 筛选汇总')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'展开日度明细'}));
 expect((screen.getByLabelText('2026-10-06 L 计划销量') as HTMLInputElement).value).toBe('11');
 expect((screen.getByLabelText('录入草稿') as HTMLInputElement).value).toBe('尚未保存');
 expect(screen.getByText(/未保存草稿/)).toBeTruthy();
});
test('today and inclusive seven-day buttons use Shanghai calendar and reject reversed ranges',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-07T00:30:00Z'));render(<Harness/>);
 fireEvent.click(screen.getByRole('button',{name:'今天'}));
 expect((screen.getByLabelText('对比开始日期') as HTMLInputElement).value).toBe('2026-10-07');
 expect(screen.queryByLabelText('2026-10-06 L 计划销量')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'近7天'}));
 expect((screen.getByLabelText('对比开始日期') as HTMLInputElement).value).toBe('2026-10-01');
 expect((screen.getByLabelText('对比结束日期') as HTMLInputElement).value).toBe('2026-10-07');
 fireEvent.change(screen.getByLabelText('对比开始日期'),{target:{value:'2026-10-08'}});
 expect(screen.getByRole('alert').textContent).toContain('开始日期不能晚于结束日期');
 expect(screen.queryByLabelText('2026-10-06 L 计划销量')).toBeNull();
});
