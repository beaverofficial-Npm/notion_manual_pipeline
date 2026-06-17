// 실제 task 발행을 로컬에서 재현해 진짜 에러를 잡는다.
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const TASK_ID = process.argv[2] || 'a5e84e23-2adf-4617-be43-cea9466a5664';
const V = '2022-06-28';
const TOK = process.env.NOTION_TOKEN;
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const richText = (c) => [{ type: 'text', text: { content: (c ?? '').slice(0, 2000) } }];
const headingBlock = (lvl, text) => ({ object: 'block', type: `heading_${lvl}`, [`heading_${lvl}`]: { rich_text: richText(text) } });
const childBlock = (ch) => ch.kind === 'callout'
  ? { object: 'block', type: 'callout', callout: { rich_text: richText(ch.text), icon: { type: 'emoji', emoji: '⚠️' }, color: 'yellow_background' } }
  : ch.kind === 'bulleted'
    ? { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: richText(ch.text) } }
    : { object: 'block', type: 'paragraph', paragraph: { rich_text: richText(ch.text) } };
function tableBlock(rows) {
  const cleaned = rows.filter((r) => r.length > 0);
  if (!cleaned.length) return null;
  const width = Math.max(...cleaned.map((r) => r.length));
  return { object: 'block', type: 'table', table: { table_width: width, has_column_header: true, has_row_header: false,
    children: cleaned.map((r) => ({ object: 'block', type: 'table_row', table_row: { cells: Array.from({ length: width }, (_, i) => richText(r[i] ?? '')) } })) } };
}
function renderContentBlock(b) {
  switch (b.kind) {
    case 'numbered_list': { const children = (b.children ?? []).map(childBlock); return [{ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: richText(b.text ?? ''), ...(children.length ? { children } : {}) } }]; }
    case 'bulleted_list': return [{ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: richText(b.text ?? '') } }];
    case 'callout': return [{ object: 'block', type: 'callout', callout: { rich_text: richText(b.text ?? ''), icon: { type: 'emoji', emoji: '⚠️' }, color: 'yellow_background' } }];
    case 'table': { const t = tableBlock(b.rows ?? []); return t ? [t] : []; }
    default: return b.text ? [{ object: 'block', type: 'paragraph', paragraph: { rich_text: richText(b.text) } }] : [];
  }
}

function extractPageId(v) { const c = (v ?? '').trim().replace(/-/g, ''); const m = c.match(/[0-9a-fA-F]{32}/); if (!m) return ''; const id = m[0].toLowerCase(); return `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`; }

const { data: task } = await sb.from('manual_tasks').select('*').eq('id', TASK_ID).single();
const parentPageId = extractPageId(task.target_notion_page_id || task.target_notion_data_source_id);
const [{ data: categories }, { data: functions }, { data: slides }, { data: blocks }] = await Promise.all([
  sb.from('manual_categories').select('id,title,sort_order').eq('task_id', TASK_ID).order('sort_order'),
  sb.from('manual_functions').select('id,category_id,title,sort_order').eq('task_id', TASK_ID).order('sort_order'),
  sb.from('manual_slides').select('id,function_id,slide_number,render_path,review_status').eq('task_id', TASK_ID).not('function_id', 'is', null).neq('review_status', 'excluded').order('slide_number'),
  sb.from('manual_notion_blocks').select('id,slide_id,sort_order,kind,content,review_status').eq('task_id', TASK_ID).neq('review_status', 'excluded').order('sort_order'),
]);
const slideIds = slides.map((s) => s.id);
const { data: assets } = await sb.from('manual_assets').select('id,slide_id,label,crop_box,review_status').in('slide_id', slideIds).neq('review_status', 'excluded').order('created_at');

const fnByCat = new Map(); for (const f of functions) { const a = fnByCat.get(f.category_id) ?? []; a.push(f); fnByCat.set(f.category_id, a); }
const slByFn = new Map(); for (const s of slides) { const a = slByFn.get(s.function_id) ?? []; a.push(s); slByFn.set(s.function_id, a); }
const blBySl = new Map(); for (const b of blocks) { if (!b.slide_id) continue; const a = blBySl.get(b.slide_id) ?? []; a.push(b); blBySl.set(b.slide_id, a); }
const asBySl = new Map(); for (const a of (assets ?? [])) { const x = asBySl.get(a.slide_id) ?? []; x.push(a); asBySl.set(a.slide_id, x); }

console.log(`cats=${categories.length} fns=${functions.length} slides=${slides.length} blocks=${blocks.length} assets=${(assets ?? []).length}`);

const renderCache = new Map();
async function loadRender(p) { if (renderCache.has(p)) return renderCache.get(p); const { data, error } = await sb.storage.from('manual-renders').download(p); if (error || !data) throw new Error('render load: ' + (error?.message || p)); const buf = Buffer.from(await data.arrayBuffer()); renderCache.set(p, buf); return buf; }
function clampBox(b){const left=Math.max(0,Math.min(100,b.left)),top=Math.max(0,Math.min(100,b.top));return{left,top,width:Math.max(1,Math.min(100-left,b.width)),height:Math.max(1,Math.min(100-top,b.height))};}
async function cropRender(buf, box){const b=clampBox(box);const img=sharp(buf);const m=await img.metadata();const W=m.width,H=m.height;const left=Math.round(b.left/100*W),top=Math.round(b.top/100*H);const cw=Math.max(1,Math.min(W-left,Math.round(b.width/100*W))),chh=Math.max(1,Math.min(H-top,Math.round(b.height/100*H)));return img.extract({left,top,width:cw,height:chh}).png().toBuffer();}
async function uploadImageToNotion(buffer, filename){const cr=await fetch('https://api.notion.com/v1/file_uploads',{method:'POST',headers:{Authorization:`Bearer ${TOK}`,'Content-Type':'application/json','Notion-Version':V},body:JSON.stringify({filename,content_type:'image/png'})});const created=await cr.json().catch(()=>({}));if(!cr.ok||!created.id)throw new Error('file_uploads create '+cr.status+' '+(created.message||''));const form=new FormData();form.append('file',new Blob([new Uint8Array(buffer)],{type:'image/png'}),filename);const sr=await fetch(`https://api.notion.com/v1/file_uploads/${created.id}/send`,{method:'POST',headers:{Authorization:`Bearer ${TOK}`,'Notion-Version':V},body:form});const sent=await sr.json().catch(()=>({}));if(!sr.ok)throw new Error('file_uploads send '+sr.status+' '+(sent.message||''));return created.id;}

const children = [];
let imgCount = 0;
for (const cat of categories) {
  const fns = (fnByCat.get(cat.id) ?? []).filter((f) => (slByFn.get(f.id) ?? []).length > 0);
  if (!fns.length) continue;
  children.push(headingBlock(1, `📕 ${cat.title}`));
  for (const fn of fns) {
    children.push(headingBlock(2, fn.title));
    for (const slide of (slByFn.get(fn.id) ?? [])) {
      for (const b of (blBySl.get(slide.id) ?? [])) children.push(...renderContentBlock(b.content));
      const sa = asBySl.get(slide.id) ?? [];
      if (sa.length && slide.render_path) {
        const buf = await loadRender(slide.render_path);
        for (const a of sa) { if (!a.crop_box) continue; const cropped = await cropRender(buf, a.crop_box);
          const sizeKB = Math.round(cropped.length / 1024);
          if (cropped.length > 5 * 1024 * 1024) console.log(`  [BIG IMG] ${a.id} ${sizeKB}KB`);
          const id = await uploadImageToNotion(cropped, `${a.id}.png`); children.push({ object: 'block', type: 'image', image: { type: 'file_upload', file_upload: { id } } }); imgCount++; }
      }
    }
    children.push({ object: 'block', type: 'divider', divider: {} });
  }
}
console.log(`built children=${children.length} images=${imgCount}`);

// 페이지 작성 (head 100 + chunk PATCH)
const head = children.slice(0, 100);
const cr = await fetch('https://api.notion.com/v1/pages', { method: 'POST', headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json', 'Notion-Version': V }, body: JSON.stringify({ parent: { type: 'page_id', page_id: parentPageId }, properties: { title: { title: richText(task.title) } }, children: head }) });
const page = await cr.json().catch(() => ({}));
if (!cr.ok) { console.log('CREATE PAGE FAILED', cr.status, page.message); console.log('first 100 block types:', head.map(b=>b.type).join(',')); process.exit(1); }
console.log('page created', page.id);
for (let i = 100; i < children.length; i += 100) {
  const chunk = children.slice(i, i + 100);
  const pr = await fetch(`https://api.notion.com/v1/blocks/${page.id}/children`, { method: 'PATCH', headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json', 'Notion-Version': V }, body: JSON.stringify({ children: chunk }) });
  const pj = await pr.json().catch(() => ({}));
  if (!pr.ok) { console.log(`PATCH chunk @${i} FAILED`, pr.status, pj.message); console.log('chunk types:', chunk.map(b=>b.type).join(',')); process.exit(1); }
  console.log(`patched chunk @${i} (+${chunk.length})`);
}
console.log('DONE OK', page.url);
