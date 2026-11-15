/* ExpensaReview app. All data comes from your own Google Sheet through your own Apps Script. */
{
const $=id=>document.getElementById(id);
const MN=ER.MN,CATS=ER.CATS;
const ACC={SG:{n:'SG current account'},LIV:{n:'Livret A'},REV:{n:'Revolut'},LEB:{n:'Lebanon wallet'},OTH:{n:'Other savings'}};
const ORDER=['LIV','LEB','SG','REV','OTH'];
const CAP=22950;
const DEF_RSU={grant:0,plan:'nq',tmi:30,social:22,pfu:31.4,vests:[]};
const AMZ_SCHEDULE=[5,15,20,20,20,20];
const DB={ops:[],balances:[],settings:{},bank:null,claude:false,quote:null};
const S={view:'overview',mode:'M',cur:null,acf:'all',cat:null,merch:null,sort:'ctc',dir:-1,q:'',flow:'E',lim:40,tlim:20,yr:null};
let TX=[],MONTHS=[],START='',END='',OPEN={},CHECKS=[],BYAC={};
let conn=null;try{conn=JSON.parse(localStorage.getItem('er_conn')||'null')}catch(e){}

/* ---------- formatting ---------- */
const eur=v=>(v<0?'−':'')+'€'+Math.abs(Math.round(v)).toLocaleString('en-GB');
const eur2=v=>(v<0?'−':'')+'€'+Math.abs(v).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2});
const sgn=v=>(v>0?'+':v<0?'−':'')+'€'+Math.abs(Math.round(v)).toLocaleString('en-GB');
const pct=(v,d=0)=>v==null||!isFinite(v)?'new':(v>0?'+':v<0?'−':'')+Math.abs(v*100).toFixed(d)+'%';
const pts=v=>(v>0?'+':v<0?'−':'')+Math.abs(v*100).toFixed(1)+' pts';
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const dshort=d=>d?+d.slice(8)+' '+MN[+d.slice(5,7)-1]+(d.slice(0,4)!==String(new Date().getFullYear())?' '+d.slice(0,4):''):'';
const kfmt=v=>Math.abs(v)>=1000?(v/1000).toFixed(1)+'k':String(Math.round(v));
let tt;const toast=m=>{const t=$('toast');t.textContent=m;t.classList.add('on');clearTimeout(tt);tt=setTimeout(()=>t.classList.remove('on'),3800)};

/* ---------- backend ---------- */
async function call(action,p={}){
  if(window.ER_MOCK)return window.ER_MOCK(action,p);
  if(!conn)throw new Error('Connect your Google Sheet in Setup first.');
  const r=await fetch(conn.url,{method:'POST',body:JSON.stringify(Object.assign({},p,{action,token:conn.token}))});
  const j=await r.json();if(!j.ok)throw new Error(j.error||'The script refused the request');return j;
}
function cache(){try{localStorage.setItem('er_cache',JSON.stringify({ops:DB.ops,balances:DB.balances,settings:DB.settings,bank:DB.bank,claude:DB.claude,quote:DB.quote}))}catch(e){}}
function setConn(state,text){$('conn').className='conn '+state;$('connt').textContent=text}
let saveQ={},saveT;
function saveSettings(patch){Object.assign(DB.settings,patch);Object.assign(saveQ,patch);cache();recompute();render();
  clearTimeout(saveT);saveT=setTimeout(async()=>{const p=saveQ;saveQ={};try{await call('saveSettings',{patch:p});setConn('ok','Saved to your Sheet')}catch(e){setConn('bad','Not saved: '+e.message);toast('Not saved to your Sheet: '+e.message)}},500)}
async function loadAll(){
  try{setConn('','Loading…');const r=await call('load');DB.ops=r.ops.map(o=>({...o,a:+o.a,d:String(o.d).slice(0,10),td:String(o.td||o.d).slice(0,10)}));DB.balances=r.balances.map(b=>({...b,bal:+b.bal,date:String(b.date).slice(0,10)}));DB.settings=r.settings||{};DB.bank=r.bank;DB.claude=r.claude;
    cache();recompute();render();setConn('ok','Connected to your Sheet');
    call('quote').then(q=>{DB.quote=q;cache();if(S.view==='networth')render()}).catch(()=>{});
  }catch(e){setConn('bad',e.message)}
}

/* ---------- derived data ---------- */
const st=()=>DB.settings;
function engineSettings(){const s=st(),a=s.accounts||{};
  return{me:s.me||'',employer:s.employer||'',decisions:s.decisions||{},rules:s.rules||[],manual:s.manual||[],
    accounts:[{code:'SG',match:[a.sg||'']},{code:'LIV',match:[a.liv||'']}],livretNo:''}}
function fx(){const o=(st().px||{});return +o.fx||(DB.quote&&DB.quote.fx)||null}
function recompute(){
  const es=engineSettings();const L=ER.build(DB.ops,es);TX=L.tx.map(t=>({...t,mo:t.d.slice(0,7)}));
  MONTHS=[...new Set(TX.map(t=>t.mo))].sort();START=TX.length?TX[TX.length-1].d:'';END=TX.length?TX[0].d:'';
  const lb=st().lebanon||{},f=fx();
  const leb=lb.cash!=null&&lb.cash!==''?{asOf:lb.asOf||END,cash:(+lb.cash)*(lb.cur==='EUR'?1:(f||0.92))}:null;
  OPEN=ER.openings(TX,DB.balances,{today:st().today||{},open:st().open||{},lebanon:leb});
  BYAC={};for(const ac of Object.keys(ACC))BYAC[ac]=TX.filter(t=>t.ac===ac).sort((a,b)=>a.d.localeCompare(b.d));
  CHECKS=ER.balanceChecks(TX,DB.balances,OPEN);
  if(!S.cur||!MONTHS.includes(S.cur.slice(0,7))&&!S.cur.includes('Q')){const full=MONTHS.filter(m=>cover(m,false).got===cover(m,false).full);S.cur=full.length>1?full[full.length-1]:MONTHS[MONTHS.length-1]||null}
  if(!S.yr)S.yr=S.cur?S.cur.slice(0,4):String(new Date().getFullYear());
}
function balAt(ac,d){let b=(OPEN[ac]||{v:0}).v;for(const t of BYAC[ac]||[]){if(t.d>d)break;b+=t.a}return b}
const ACTIVE=()=>ORDER.filter(a=>a==='SG'||a==='LIV'||(BYAC[a]&&BYAC[a].length)||Math.abs((OPEN[a]||{}).v||0)>0.5);
const isS=t=>t.t==='E'&&(S.acf==='all'||t.ac===S.acf);
let SPEND=[],SCATS=[];
function prepS(){SPEND=TX.filter(isS);const m=new Map();for(const t of SPEND)m.set(t.c,(m.get(t.c)||0)-t.a);SCATS=[...m].sort((a,b)=>b[1]-a[1]).map(x=>x[0])}
const vsum=a=>a.reduce((s,t)=>s+(t.t==='E'?-t.a:t.a),0);

/* ---------- periods ---------- */
const qOf=mo=>mo.slice(0,4)+'-Q'+Math.ceil(+mo.slice(5)/3);
const keyOf=(t,mode)=>mode==='Q'?qOf(t.mo):t.mo;
const periods=mode=>mode==='Q'?[...new Set(MONTHS.map(qOf))]:MONTHS;
const lbl=k=>k.includes('Q')?k.slice(5)+' '+k.slice(0,4):MN[+k.slice(5)-1]+' '+k.slice(0,4);
const short=k=>k.includes('Q')?k.slice(5):S.mode==='Y'?MN[+k.slice(5)-1]+' '+k.slice(2,4):MN[+k.slice(5)-1];
const dt=s=>new Date(s+'T00:00:00Z');const iso=d=>d.toISOString().slice(0,10);
const span=(k,ytd)=>{let y=+k.slice(0,4),a,b;if(k.includes('Q')){const q=+k.slice(6);a=new Date(Date.UTC(y,(q-1)*3,1));b=new Date(Date.UTC(y,q*3,0))}else{const m=+k.slice(5)-1;a=new Date(Date.UTC(y,ytd?0:m,1));b=new Date(Date.UTC(y,m+1,0))}return[a,b]};
const days=(a,b)=>Math.round((b-a)/864e5)+1;
const cover=(k,ytd=S.mode==='T')=>{const[a,b]=span(k,ytd),s=dt(START||'2000-01-01'),e=dt(END||'2000-01-01');return{full:days(a,b),got:Math.max(0,days(a>s?a:s,b<e?b:e)),end:iso(b<e?b:e)}};
const perMo=k=>Math.max(1,cover(k).got)/30.437;
const pl=k=>S.mode==='T'?'Jan to '+MN[+k.slice(5)-1]+' '+k.slice(0,4):lbl(k);
const ps=k=>S.mode==='T'?'YTD '+k.slice(0,4):short(k);
const prevOf=k=>{if(!k)return null;if(S.mode==='T'||S.mode==='Y'){const c=(+k.slice(0,4)-1)+k.slice(4);return MONTHS.includes(c)?c:null}const p=periods(S.mode),i=p.indexOf(k);return i>0?p[i-1]:null};
const inP=(k,mode=S.mode)=>mode==='T'?(t=>t.d.slice(0,4)===k.slice(0,4)&&t.mo<=k):(t=>keyOf(t,mode)===k);
const hasYoY=()=>MONTHS.some(m=>MONTHS.includes((+m.slice(0,4)-1)+m.slice(4)));

/* ---------- review questions ---------- */
const Q={cash:{q:'Cash withdrawal: spent here, or carried to Lebanon?',o:[['keep','Spent, keep as expense'],['leb','Carried to Lebanon']]},
p2p:{q:'Large transfer to a person: a gift or payment, or money for Lebanon?',o:[['keep','Gift or payment, expense'],['leb','Lebanon wallet']]},
sogecap:{q:'Sogecap direct debit: an insurance cost or a savings product?',o:[['keep','Insurance, keep as expense'],['sav','Savings product']]},
cashdep:{q:'Cash paid in at an ATM: new money, or your own cash coming back?',o:[['keep','New money, income'],['own','My own cash back']]},
payback:{q:'Money received on Revolut from a person: what was it for?',o:[['cat:Eating out','Pay-back, eating out'],['cat:Going out','Pay-back, going out'],['keep','Pay-back, gifts'],['income','Other income']]},
unpaired:{q:'Transfer with no matching line on the other account yet',o:[['keep','Fine, it is a transfer'],['cat:Other','It was spending']]}};

/* ---------- period strip ---------- */
function renderMetro(){
  const p=periods(S.mode),prev=prevOf(S.cur);
  $('metro').classList.toggle('ytd',S.mode==='T');
  $('metro').innerHTML=p.map(k=>{const c=cover(k,false),part=c.got<c.full,inY=S.mode==='T'&&k<=S.cur&&k.slice(0,4)===S.cur.slice(0,4),noCmp=(S.mode==='M'||S.mode==='Q'||S.mode==='Y')&&!prevOf(k);
    return`<button class="st${part?' part':''}${k===S.cur?' cur':''}${k===prev?' prev':''}${inY?' in':''}" data-k="${k}" ${noCmp&&S.mode!=='T'?'disabled':''} aria-pressed="${k===S.cur}"><i></i><b>${k.includes('Q')?k.slice(5):MN[+k.slice(5)-1]}</b><small>${S.mode==='T'?(k===S.cur?'year to date':'to here'):k===prev?'compared':noCmp?(S.mode==='Y'?'no last year':'start'):part?c.got+' of '+c.full+' days':k.slice(0,4)}</small></button>`}).join('');
  for(const m of'MQYT')$('m'+m).setAttribute('aria-pressed',S.mode===m);
  $('mY').disabled=!hasYoY();$('mY').title=hasYoY()?'':'Needs last year: import your 2025 statements';
  $('acf').innerHTML=[['all','All accounts'],['SG','SG'],['REV','Revolut'],['LEB','Lebanon']].filter(([k])=>k==='all'||(BYAC[k]||[]).some(t=>t.t==='E')).map(([k,n])=>`<button data-a="${k}" aria-pressed="${S.acf===k}">${k==='all'?'':`<i style="background:var(--${k})"></i>`}${n}</button>`).join('');
  $('acf').hidden=S.view!=='spending';
  const mt=$('metro'),c=mt.querySelector('.cur');if(c)mt.scrollLeft=c.offsetLeft-mt.clientWidth/2+c.offsetWidth/2;
}

/* ---------- overview ---------- */
const FIXED=new Set(['Housing','Subscriptions & phone','Bank fees & taxes','Insurance']);
function flows(k){const iK=inP(k),g=f=>TX.filter(t=>iK(t)&&f(t)),sp=vsum(g(t=>t.t==='E')),inc=vsum(g(t=>t.t==='I'));return{sp,inc,saved:inc-sp,rate:inc?(inc-sp)/inc:null,fixed:vsum(g(t=>t.t==='E'&&FIXED.has(t.c)))}}
function avgSpend3(k){const end=k.includes('Q')?MONTHS.filter(m=>qOf(m)===k).pop():k;const full=MONTHS.filter(m=>m<=end&&cover(m,false).got===cover(m,false).full).slice(-3);
  return full.length?full.reduce((s,m)=>s+vsum(TX.filter(t=>t.mo===m&&t.t==='E')),0)/full.length:0}
const holdAll=end=>ACTIVE().reduce((s,a)=>s+balAt(a,end),0);
function overview(){
  const k=S.cur,p=prevOf(k),F=flows(k),P=p?flows(p):null,end=cover(k).end,net=holdAll(end),netP=p?holdAll(cover(p).end):null;
  const ytdK=k.includes('Q')?MONTHS.filter(m=>qOf(m)===k).pop():k;
  const iY=t=>t.d.slice(0,4)===ytdK.slice(0,4)&&t.mo<=ytdK,ysp=vsum(TX.filter(t=>iY(t)&&t.t==='E')),yin=vsum(TX.filter(t=>iY(t)&&t.t==='I')),Y=yin?(yin-ysp)/yin:null;
  const run=avgSpend3(k),liv=balAt('LIV',end);
  $('ovh').textContent=`${pl(k)}: you ${F.saved>=0?'saved':'overspent by'} ${eur(Math.abs(F.saved))}${F.rate!=null?', '+Math.round(Math.abs(F.rate)*100)+'% of income':''}`;
  $('ovs').textContent=`Real spending across every account was ${eur(F.sp)}${P&&P.sp?`, ${F.sp>=P.sp?'up':'down'} ${Math.abs((F.sp/P.sp-1)*100).toFixed(0)}% on ${ps(p)}`:''}. Your accounts add up to ${eur(net)}${run?`, ${(net/run).toFixed(1)} months of spending at your recent pace`:''}.`;
  const d=(a,b,badUp)=>!b?'':`<span class="d ${((a>b)===badUp)?'up':'dn'}">${a>b?'▲':'▼'} ${pct(a/b-1)} vs ${ps(p)}</span>`;
  const items=[['Real spending',eur(F.sp),d(F.sp,P&&P.sp,true)||`<span class="d">about ${eur(F.sp/perMo(k))} a month</span>`],['Income',eur(F.inc),d(F.inc,P&&P.inc,false)],
    ['Saved',eur(F.saved),`<span class="d">${F.rate!=null?Math.round(F.rate*100)+'% of income':''}</span>`],['Savings rate this year',Y!=null?Math.round(Y*100)+'%':'–',`<span class="d">${ytdK.slice(0,4)}, to ${MN[+ytdK.slice(5)-1]}</span>`],
    ['Your accounts',eur(net),netP!=null?`<span class="d ${net>=netP?'dn':'up'}">${net>=netP?'▲':'▼'} ${sgn(net-netP)} vs ${ps(p)}</span>`:''],['Runway',run?(net/run).toFixed(1)+' months':'–',`<span class="d">at ${eur(run)} a month</span>`],
    ['Fixed costs',F.inc?Math.round(F.fixed/F.inc*100)+'%':'–',`<span class="d">of income, ${eur(F.fixed)}</span>`],['Livret A',eur(liv),`<span class="d">${eur(CAP-liv)} room under the cap</span>`]];
  $('kpis').innerHTML=items.map(([n,v,x])=>`<div class="kpi"><span>${n}</span><strong class="num">${v}</strong>${x}</div>`).join('');
  stack();sits(end);statement(k);
}
const monthEnds=()=>MONTHS.map(mo=>cover(mo,false).end);
function stack(){
  const s=$('stks'),W=s.clientWidth,H=s.clientHeight;if(!W||!MONTHS.length)return;
  const A=ACTIVE(),E=monthEnds(),P={l:52,r:W<520?12:110,t:12,b:28},iw=W-P.l-P.r,ih=H-P.t-P.b;
  const B=E.map(e=>A.map(a=>Math.max(0,balAt(a,e)))),tot=B.map(r=>r.reduce((s,v)=>s+v,0)),mx=Math.max(...tot,1)*1.08;
  const X=i=>P.l+(E.length===1?iw/2:i/(E.length-1)*iw),Y=v=>P.t+ih-v/mx*ih;
  let g='';for(let j=0;j<=4;j++){const v=mx/4*j;g+=`<line x1="${P.l}" x2="${P.l+iw}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${P.l-8}" y="${Y(v)+4}" text-anchor="end" font-size="12" fill="var(--mute)">${v>=1000?'€'+Math.round(v/1000)+'k':'€'+Math.round(v)}</text>`}
  const cum=B.map(r=>{let c=0;return r.map(v=>c+=v)});
  A.forEach((a,j)=>{const top=cum.map((r,i)=>`${X(i)},${Y(r[j])}`),bot=cum.map((r,i)=>`${X(i)},${Y(j?r[j-1]:0)}`).reverse();
    g+=`<polygon points="${top.concat(bot).join(' ')}" fill="var(--${a})" stroke="var(--bg)" stroke-width="2"/>`;
    if(W>=520){const i=E.length-1,mid=(Y(cum[i][j])+Y(j?cum[i][j-1]:0))/2;if(B[i][j]/mx>.05)g+=`<text x="${X(i)+8}" y="${mid+4}" font-size="12.5" font-weight="600" fill="var(--ink)">${ACC[a].n.replace(' current account','')}</text>`}});
  const cur=S.mode==='Q'?MONTHS.map(qOf).lastIndexOf(S.cur):MONTHS.indexOf(S.cur);
  if(cur>=0)g+=`<line x1="${X(cur)}" x2="${X(cur)}" y1="${P.t}" y2="${P.t+ih}" stroke="var(--ink)" stroke-width="1.5"/><circle cx="${X(cur)}" cy="${Y(tot[cur])}" r="5" fill="var(--amber)" stroke="var(--ink)"/>`;
  const step=Math.ceil(E.length/(W<520?6:12));
  E.forEach((e,i)=>{if(i%step)return;g+=`<text x="${X(i)}" y="${H-8}" text-anchor="middle" font-size="12" fill="var(--mute)">${MN[+e.slice(5,7)-1]}${e.slice(5,7)==='01'||i===0?' '+e.slice(2,4):''}</text>`});
  E.forEach((e,i)=>{const x0=i?(X(i-1)+X(i))/2:P.l,x1=i<E.length-1?(X(i)+X(i+1))/2:P.l+iw;g+=`<rect x="${x0}" y="${P.t}" width="${Math.max(0,x1-x0)}" height="${ih}" fill="transparent" data-tip="${dshort(e)}: ${A.map((a,j)=>ACC[a].n+' '+eur(B[i][j])).join(', ')}. Total ${eur(tot[i])}"/>`});
  s.innerHTML=g;$('stkkey').innerHTML=A.map(a=>`<span><i style="background:var(--${a})"></i>${ACC[a].n}</span>`).join('');
}
function sits(end){
  const A=ACTIVE(),v=A.map(a=>balAt(a,end)),T=v.reduce((s,x)=>s+Math.max(0,x),0)||1;
  $('sith').textContent='Where it sits on '+dshort(end);
  $('sitcap').textContent=`Total ${eur(v.reduce((s,x)=>s+x,0))}. Amazon shares and gold are in Net worth.`;
  $('tall').innerHTML=A.map((a,i)=>`<span style="width:${Math.max(0,v[i])/T*100}%;background:var(--${a})" data-tip="${ACC[a].n}: ${eur(v[i])}"></span>`).join('');
  $('sit').innerHTML=A.map((a,i)=>`<li><i style="background:var(--${a})"></i><span>${ACC[a].n}<small>opening from ${esc(OPEN[a].how)}</small></span><strong class="num">${eur(v[i])}</strong><span class="num" style="text-align:right;color:var(--ink2)">${Math.round(Math.max(0,v[i])/T*100)}%</span></li>`).join('');
}
function statement(k){
  const iK=inP(k),g=fn=>TX.filter(t=>iK(t)&&fn(t));
  const inc=vsum(g(t=>t.t==='I')),sal=vsum(g(t=>t.t==='I'&&t.c==='Salary')),sp=vsum(g(t=>t.t==='E'));
  const spBy=ac=>vsum(g(t=>t.t==='E'&&t.ac===ac));
  const left=inc-sp,end=cover(k).end,startD=iso(new Date(dt(S.mode==='T'?k.slice(0,4)+'-01-01':iso(span(k)[0]))-864e5));
  const dB=a=>balAt(a,end)-balAt(a,startD),liv=dB('LIV'),leb=dB('LEB'),oth=dB('OTH'),cur=dB('SG')+dB('REV'),mx=Math.max(inc,sp,1);
  const row=(n,v,col,cls='')=>`<div class="lb ${cls}">${n}</div><div class="bx">${Math.abs(v)>0?`<em style="width:${Math.min(100,Math.abs(v)/mx*100)}%;background:${col}"></em>`:''}</div><div class="vl num">${cls==='t'?'<b>'+eur(v)+'</b>':eur(v)}</div>`;
  $('sth').textContent=S.mode==='Q'?'The quarter on one page':S.mode==='T'?'The year so far on one page':'The month on one page';
  $('stcap').textContent=`${pl(k)}. Money in, real money out, and where the difference went.`;
  $('pl').innerHTML=row('Income',inc,'var(--ink2)','t')+row('Salary',sal,'var(--bar)','s')+row('Refunds and other',inc-sal,'var(--bar)','s')+row('Real spending',sp,'var(--red)','t')+
    ['SG','REV','LEB'].map(a=>{const v=spBy(a);return v?row('Paid from '+ACC[a].n.replace(' current account','').replace(' wallet',''),v,`var(--${a})`,'s'):''}).join('')+'<hr>'+
    row(left>=0?'Saved':'Drawn from savings',left,'var(--blue)','t')+row('Into Livret A',liv,'var(--LIV)','s')+row('Into the Lebanon wallet',leb,'var(--LEB)','s')+(oth?row('Into other savings',oth,'var(--OTH)','s'):'')+row(cur>=0?'Kept on SG and Revolut':'Taken from SG and Revolut',cur,'var(--SG)','s')+
    `<div class="rate"><strong class="num">${inc?Math.round(left/inc*100)+'%':'–'}</strong><span class="cap" style="margin:0">savings rate${S.mode==='T'?' this year so far':''}</span></div>`;
  const big=TX.filter(t=>iK(t)&&t.t==='E').sort((a,b)=>a.a-b.a).slice(0,6);
  $('bigcap').textContent=`${pl(k)}, every account. Tap one to open it in Spending.`;
  $('big').innerHTML=big.map(t=>`<li data-c="${esc(t.c)}" data-n="${esc(t.m)}"><span class="num">${dshort(t.d)}</span><b>${esc(t.m)}<small>${esc(t.c)} · ${ACC[t.ac].n}</small></b><strong class="num">${eur(-t.a)}</strong></li>`).join('')||'<li class="empty">Nothing spent in this period.</li>';
}

/* ---------- spending ---------- */
function level(k,p){
  const base=S.cat?SPEND.filter(t=>t.c===S.cat):SPEND,by=S.cat?(t=>t.m):(t=>t.c),m=new Map(),iK=inP(k),iP=p?inP(p):()=>false;
  for(const t of base){const ik=iK(t);if(!ik&&!iP(t))continue;const n=by(t),r=m.get(n)||{n,cur:0,prev:0,nc:0,np:0};if(ik){r.cur-=t.a;r.nc++}else{r.prev-=t.a;r.np++}m.set(n,r)}
  let rows=[...m.values()];
  if(S.cat&&rows.length>9){rows.sort((a,b)=>Math.max(b.cur,b.prev)-Math.max(a.cur,a.prev));const keep=rows.slice(0,8),rest=rows.slice(8);keep.push(rest.reduce((o,r)=>(o.cur+=r.cur,o.prev+=r.prev,o.nc+=r.nc,o.np+=r.np,o),{n:'Other merchants',cur:0,prev:0,nc:0,np:0,grp:true}));rows=keep}
  const TC=rows.reduce((s,r)=>s+r.cur,0),TP=rows.reduce((s,r)=>s+r.prev,0);
  for(const r of rows){r.dlt=r.cur-r.prev;r.rate=r.prev>0?r.cur/r.prev-1:null;r.mix=TC?r.cur/TC:0;r.mixp=TP?r.prev/TP:0;r.dmix=r.mix-r.mixp;r.ctc=TP?r.dlt/TP:0;r.avg=r.cur/perMo(k)}
  return{rows,TC,TP,NC:rows.reduce((s,r)=>s+r.nc,0),NP:rows.reduce((s,r)=>s+r.np,0)};
}
const monthly=f=>MONTHS.map(mo=>vsum(TX.filter(t=>t.mo===mo&&f(t))));
function crumbs(){let h=`<b>All spending</b>`;if(S.cat)h=`<button data-go="all">All spending</button><span>›</span>${S.merch?`<button data-go="cat">${esc(S.cat)}</button><span>›</span><b>${esc(S.merch)}</b>`:`<b>${esc(S.cat)}</b>`}`;$('crumb1').innerHTML=$('crumb2').innerHTML=h}
function finding(k,p){
  const c0=S.cat,m0=S.merch;S.cat=null;S.merch=null;const L0=level(k,p);S.cat=c0;S.merch=m0;
  const an=S.acf==='all'?'across every account':'on '+ACC[S.acf].n;
  if(!p){const top=[...L0.rows].sort((a,b)=>b.cur-a.cur)[0];$('finding').textContent=S.mode==='T'?`${eur(L0.TC)} of real spending this year so far, about ${eur(L0.TC/perMo(k))} a month`:`${pl(k)}: ${eur(L0.TC)} of real spending`;
    $('findsub').textContent=`${pl(k)} ${an}.${top?' '+top.n+' is the biggest line at '+(top.mix*100).toFixed(0)+'%.':''}${S.mode==='T'?' Year-on-year comparison switches on once last year is imported.':''}`;return}
  const tr=L0.TP?L0.TC/L0.TP-1:0,up=tr>=0,drv=[...L0.rows].filter(r=>up?r.ctc>0:r.ctc<0).sort((a,b)=>Math.abs(b.ctc)-Math.abs(a.ctc))[0];
  $('finding').textContent=`${pl(k)} spending ${up?'rose':'fell'} ${Math.abs(tr*100).toFixed(0)}% vs ${lbl(p).replace(/ \d{4}$/,m=>S.mode==='Y'||S.mode==='T'?m:'')}${drv?`, ${drv.n} ${up?'added':'took off'} ${Math.abs(drv.ctc*100).toFixed(1)} points`:''}`;
  $('findsub').textContent=`${eur(L0.TC)} of real spending ${an}. Transfers to Revolut, the Livret A and Lebanon are not spending, so they never appear here.`;
}
function yearView(){
  const years=[...new Set(MONTHS.map(m=>m.slice(0,4)))];if(!years.includes(S.yr))S.yr=years[years.length-1];
  const y=S.yr,py=String(+y-1),f=t=>isS(t)&&(!S.cat||t.c===S.cat)&&(!S.merch||t.m===S.merch);
  const mv=yy=>Array.from({length:12},(_,i)=>{const mo=`${yy}-${String(i+1).padStart(2,'0')}`;return MONTHS.includes(mo)?vsum(TX.filter(t=>t.mo===mo&&f(t))):null});
  const cur=mv(y),prv=mv(py),vals=cur.concat(prv).filter(v=>v!=null),mx=Math.max(...vals,1)*1.12;
  const have=cur.filter(v=>v!=null),avg=have.length?have.reduce((s,v)=>s+v,0)/have.length:0;
  $('years').innerHTML=years.map(yy=>`<button data-y="${yy}" aria-pressed="${yy===y}">${yy}</button>`).join('');
  $('yrh').textContent=`${y} at a glance${S.cat?': '+(S.merch||S.cat):''}`;
  const tot=have.reduce((s,v)=>s+v,0),sameP=prv.reduce((s,v,i)=>s+(cur[i]!=null&&v!=null?v:0),0),sameC=cur.reduce((s,v,i)=>s+(v!=null&&prv[i]!=null?v:0),0);
  $('yrcap').textContent=`${eur(tot)} over ${have.length} month${have.length===1?'':'s'}, ${eur(avg)} a month on average${sameP?`; the same months of ${py} came to ${eur(sameP)}, so ${pct(sameC/sameP-1)}`:''}. Tap a month to open it.`;
  $('yrk1').textContent=y;$('yrk2').textContent=prv.some(v=>v!=null)?py:py+' (not imported yet)';
  $('yr').innerHTML=`<div class="avg" style="bottom:${avg/mx*100}%"><span class="num">avg ${eur(avg)}</span></div>`+cur.map((v,i)=>{const mo=`${y}-${String(i+1).padStart(2,'0')}`,pv=prv[i];
    return`<button data-mo="${mo}" class="${S.mode==='M'&&S.cur===mo?'cur':''}" ${v==null?'disabled':''} data-tip="${MN[i]} ${y}: ${v==null?'no data':eur(v)}${pv!=null?`; ${MN[i]} ${py}: ${eur(pv)}${v!=null&&pv?' ('+pct(v/pv-1)+')':''}`:''}">${pv!=null?`<i class="gh" style="height:${pv/mx*100}%"></i>`:''}${v!=null?`<i class="so${S.cat?' sel':''}" style="height:${Math.max(0,v)/mx*100}%"><b class="num">${kfmt(v)}</b></i>`:''}</button>`}).join('');
  $('yrl').innerHTML=MN.map(m=>`<span>${m}</span>`).join('');
  const cats=SCATS.slice(0,12);
  $('sm').innerHTML=cats.map(c=>{const v=Array.from({length:12},(_,i)=>{const mo=`${y}-${String(i+1).padStart(2,'0')}`;return vsum(SPEND.filter(t=>t.mo===mo&&t.c===c))}),m=Math.max(...v,1),t=v.reduce((s,x)=>s+x,0);
    return`<button data-c="${esc(c)}" class="${S.cat===c?'on':''}"><div class="t"><b>${esc(c)}</b><span class="num">${eur(t)}</span></div><div class="bars">${v.map((x,i)=>`<i class="${S.mode==='M'&&S.cur===`${y}-${String(i+1).padStart(2,'0')}`?'c':''}" style="height:${Math.max(0,x)/m*100}%" data-tip="${esc(c)}, ${MN[i]} ${y}: ${eur(x)}"></i>`).join('')}</div></button>`}).join('');
}
function waterfall(L,k,p){
  $('wfh').textContent=p?'What moved spending':'Where it went';
  if(!p){const rows=[...L.rows].sort((a,b)=>b.cur-a.cur),mx=rows[0]?rows[0].cur:1;
    $('wf').innerHTML=rows.map(r=>`<div class="lb" title="${esc(r.n)}">${esc(r.n)}</div><div class="trk"><em class="tot${r.n===S.cat||r.n===S.merch?' sel':''}" style="left:0;width:${Math.max(.6,r.cur/mx*100)}%" data-n="${r.grp?'':esc(r.n)}" data-tip="${esc(r.n)}: ${eur(r.cur)}, ${(r.mix*100).toFixed(1)}% of spend, about ${eur(r.avg)} a month"></em></div><div class="vl num">${eur(r.cur)}</div>`).join('')+`<div class="lb t">Total</div><div></div><div class="vl num"><b>${eur(L.TC)}</b></div>`;
    $('wfcap').textContent=`${pl(k)}${S.cat?', inside '+S.cat:''}, largest first.`;return}
  const rows=[...L.rows].sort((a,b)=>Math.abs(b.dlt)-Math.abs(a.dlt)),top=rows.slice(0,7),rest=rows.slice(7);
  if(rest.length)top.push({n:'Everything else',dlt:rest.reduce((s,r)=>s+r.dlt,0),ctc:rest.reduce((s,r)=>s+r.ctc,0),grp:true});
  let run=L.TP;const steps=[{n:pl(p),v:L.TP,t:1}];for(const r of top){steps.push({n:r.n,a:run,b:run+r.dlt,d:r.dlt,c:r.ctc,grp:r.grp});run+=r.dlt}steps.push({n:pl(k),v:L.TC,t:1});
  const vals=steps.flatMap(s=>s.t?[s.v]:[s.a,s.b]);let lo=Math.min(...vals),hi=Math.max(...vals);const pad=(hi-lo)*.12||50;lo=Math.max(0,lo-pad*2.5);hi+=pad;const X=v=>(v-lo)/(hi-lo)*100;
  $('wf').innerHTML=steps.map(s=>{if(s.t)return`<div class="lb t">${esc(s.n)}</div><div class="trk"><em class="tot" style="left:0;width:${X(s.v)}%" data-tip="${esc(s.n)}: ${eur(s.v)}"></em></div><div class="vl num"><b>${eur(s.v)}</b></div>`;
    const l=Math.min(X(s.a),X(s.b)),w=Math.max(.6,Math.abs(X(s.b)-X(s.a)));
    return`<div class="lb" title="${esc(s.n)}">${esc(s.n)}</div><div class="trk"><em class="${s.d>=0?'u':'v'}${s.n===S.cat||s.n===S.merch?' sel':''}" style="left:${l}%;width:${w}%" data-n="${s.grp?'':esc(s.n)}" data-tip="${esc(s.n)}: ${sgn(s.d)}, ${pts(s.c)} of total change"></em></div><div class="vl num">${sgn(s.d)}</div>`}).join('')+`<div></div><div class="ax num"><span>${eur(lo)}</span><span>${eur(hi)}</span></div><div></div>`;
  $('wfcap').textContent=`${pl(p)} to ${pl(k)}${S.cat?', inside '+S.cat:''}. Red pushed spending up, blue pulled it down. Axis starts at ${eur(lo)}.`;
}
function drivers(L,k,p){
  const n0=L.NP,n1=L.NC,a0=n0?L.TP/n0:0,a1=n1?L.TC/n1:0;
  $('drvcap').textContent=`${S.merch||S.cat||'All spending'}: did it change because you bought more often, or spent more each time?`;
  if(!p){$('drv').innerHTML=`<dl><dt></dt><dd></dd><dd>${ps(k)}</dd><dt>Transactions</dt><dd></dd><dd class="num">${n1}</dd><dt>Average ticket</dt><dd></dd><dd class="num">€${a1.toFixed(2)}</dd></dl><p class="cap">The volume and ticket split needs a comparison: switch to MoM, QoQ or YoY.</p>`;return}
  const vol=(n1-n0)*a0,tic=(a1-a0)*n1,m=Math.max(Math.abs(vol),Math.abs(tic),1),bar=v=>`<em style="${v>=0?'left:50%':'right:50%'};width:${Math.abs(v)/m*50}%;background:var(--${v>=0?'red':'blue'})"></em>`;
  $('drv').innerHTML=`<dl><dt></dt><dd>${short(p)}</dd><dd>${short(k)}</dd><dt>Transactions</dt><dd class="num">${n0}</dd><dd class="num">${n1}</dd><dt>Average ticket</dt><dd class="num">€${a0.toFixed(2)}</dd><dd class="num">€${a1.toFixed(2)}</dd></dl>
  <div class="split"><span>More or fewer buys</span><div class="mid">${bar(vol)}</div><span class="num" style="text-align:right">${sgn(vol)}</span><span>Bigger or smaller tickets</span><div class="mid">${bar(tic)}</div><span class="num" style="text-align:right">${sgn(tic)}</span></div>`;
}
function spark(vals){const mx=Math.max(...vals,1),n=vals.length,i=S.mode==='M'||S.mode==='Y'?MONTHS.indexOf(S.cur):-1;const P=vals.map((v,j)=>`${(j/Math.max(1,n-1)*96).toFixed(1)},${(24-Math.max(0,v)/mx*22).toFixed(1)}`).join(' ');
  return`<svg class="sp" viewBox="0 0 96 26" aria-hidden="true"><polyline points="${P}" fill="none" stroke="var(--ink2)" stroke-width="1.6" stroke-linejoin="round"/>${i>=0?`<circle cx="${(i/Math.max(1,n-1)*96).toFixed(1)}" cy="${(24-Math.max(0,vals[i])/mx*22).toFixed(1)}" r="3.2" fill="var(--amber)" stroke="var(--ink)"/>`:''}</svg>`}
function table(L,k,p){
  const cols=p?[['n',S.cat?'Merchant':'Category'],['cur',short(k)],['dlt','vs '+short(p)],['rate','Rate'],['mix','Mix'],['dmix','Mix Δ'],['ctc','CTC'],['sp','Trend']]:[['n',S.cat?'Merchant':'Category'],['cur',ps(k)],['avg','Per month'],['mix','Mix'],['sp','Trend']];
  const sk=!p&&['ctc','dlt','rate','dmix'].includes(S.sort)?'cur':S.sort;
  const rows=[...L.rows].sort((a,b)=>{const x=sk==='ctc'?Math.abs(a.ctc):a[sk],y=sk==='ctc'?Math.abs(b.ctc):b[sk];return(typeof x==='string'?x.localeCompare(y):(x??-1e9)-(y??-1e9))*S.dir});
  const cl=v=>v>0?'up':v<0?'dn':'';
  const body=rows.map(r=>{const f=S.cat?(t=>isS(t)&&t.c===S.cat&&(r.grp||t.m===r.n)):(t=>isS(t)&&t.c===r.n),on=r.n===S.merch||(!S.cat&&r.n===S.cat),tr=`<td data-l="Trend">${r.grp?'':spark(monthly(f))}</td>`,nm=`<td data-l=""><span class="nm">${esc(r.n)}</span></td>`;
    if(!p)return`<tr class="ck${on?' on':''}" data-n="${r.grp?'':esc(r.n)}">${nm}<td data-l="${ps(k)}" class="num">${eur(r.cur)}</td><td data-l="Per month" class="num">${eur(r.avg)}</td><td data-l="Mix" class="num">${(r.mix*100).toFixed(1)}%</td>${tr}</tr>`;
    return`<tr class="ck${on?' on':''}" data-n="${r.grp?'':esc(r.n)}">${nm}<td data-l="${short(k)}" class="num">${eur(r.cur)}</td><td data-l="vs ${short(p)}" class="num ${cl(r.dlt)}">${sgn(r.dlt)}</td><td data-l="Rate" class="num ${cl(r.rate)}">${pct(r.rate)}</td><td data-l="Mix" class="num">${(r.mix*100).toFixed(1)}%</td><td data-l="Mix Δ" class="num">${r.dmix>0?'+':r.dmix<0?'−':''}${Math.abs(Math.round(r.dmix*1e4))} bps</td><td data-l="CTC" class="num ${cl(r.ctc)}"><b>${pts(r.ctc)}</b></td>${tr}</tr>`}).join('');
  const tr=L.TP?L.TC/L.TP-1:null;
  const foot=p?`<td data-l="">Total</td><td data-l="${short(k)}" class="num">${eur(L.TC)}</td><td data-l="vs ${short(p)}" class="num ${cl(L.TC-L.TP)}">${sgn(L.TC-L.TP)}</td><td data-l="Rate" class="num ${cl(tr)}">${pct(tr)}</td><td data-l="Mix" class="num">100%</td><td data-l="Mix Δ"></td><td data-l="CTC" class="num ${cl(tr)}">${pts(tr||0)}</td><td data-l="Trend"></td>`:`<td data-l="">Total</td><td data-l="${ps(k)}" class="num">${eur(L.TC)}</td><td data-l="Per month" class="num">${eur(L.TC/perMo(k))}</td><td data-l="Mix" class="num">100%</td><td data-l="Trend"></td>`;
  $('tbl').innerHTML=`<thead><tr>${cols.map(([c,n])=>`<th class="${c==='sp'?'':'s'}" data-s="${c}" ${sk===c?`aria-sort="${S.dir<0?'descending':'ascending'}"`:''}>${n}${sk===c?(S.dir<0?' ↓':' ↑'):''}</th>`).join('')}</tr></thead><tbody>${body}</tbody><tfoot><tr>${foot}</tr></tfoot>`;
}
function scatter(){
  const s=$('scs'),W=s.clientWidth,H=s.clientHeight;if(!W||S.view!=='spending'||!S.cur)return;
  const k=S.cur,p=prevOf(k);
  if(!p){s.innerHTML=`<text x="${W/2}" y="${H/2}" text-anchor="middle" font-size="15" fill="var(--ink2)">Growth needs a comparison: switch to MoM, QoQ or YoY.</text>`;return}
  const L=level(k,p),rows=L.rows.filter(r=>r.prev>0&&r.cur>0);if(!rows.length){s.innerHTML='';return}
  const P={l:44,r:14,t:14,b:34},iw=W-P.l-P.r,ih=H-P.t-P.b,cl=v=>Math.max(-1,Math.min(1.5,v));
  const mxX=Math.min(1,Math.max(...rows.map(r=>r.mix),.05)*1.1),ys=rows.map(r=>cl(r.rate));let y0=Math.min(-.5,...ys)-.1,y1=Math.max(.5,...ys)+.1;
  const X=v=>P.l+v/mxX*iw,Y=v=>P.t+(y1-v)/(y1-y0)*ih,mxV=Math.max(...rows.map(r=>r.cur),1),R=v=>4+Math.sqrt(v/mxV)*(W<520?14:20);
  const lab=new Set([...rows].sort((a,b)=>Math.abs(b.ctc)-Math.abs(a.ctc)).slice(0,W<520?3:5).map(r=>r.n));
  let g='';for(const t of[y0,0,y1]){const v=t===0?0:Math.round(t*10)/10;g+=`<line x1="${P.l}" x2="${W-P.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${v===0?'var(--mute)':'var(--line)'}"/><text x="${P.l-6}" y="${Y(v)+4}" text-anchor="end" font-size="12" fill="var(--mute)">${pct(v)}</text>`}
  g+=`<text x="${W-P.r}" y="${H-6}" text-anchor="end" font-size="12" fill="var(--mute)">share of spend ${Math.round(mxX*100)}%</text><text x="${P.l}" y="${H-6}" font-size="12" fill="var(--mute)">0%</text>`;
  for(const r of[...rows].sort((a,b)=>b.cur-a.cur)){const on=r.n===S.cat||r.n===S.merch,x=X(r.mix),y=Y(cl(r.rate)),rr=R(r.cur);
    g+=`<circle cx="${x}" cy="${y}" r="${rr}" fill="${on?'var(--amber)':r.rate>=0?'color-mix(in oklab,var(--red) 55%,var(--bg))':'color-mix(in oklab,var(--blue) 55%,var(--bg))'}" stroke="var(--bg)" stroke-width="2" style="cursor:pointer" data-n="${r.grp?'':esc(r.n)}" data-tip="${esc(r.n)}: ${eur(r.cur)}, ${(r.mix*100).toFixed(1)}% of spend, ${pct(r.rate)}"/>`;
    if(lab.has(r.n)||on){const rt=x<W*.7;g+=`<text x="${rt?x+rr+4:x-rr-4}" y="${y+4}" text-anchor="${rt?'start':'end'}" font-size="12.5" font-weight="600" fill="var(--ink)" pointer-events="none">${esc(r.n.length>18?r.n.slice(0,17)+'…':r.n)}</text>`}}
  s.innerHTML=g;
}
function months(){
  const tot=MONTHS.map(mo=>vsum(SPEND.filter(t=>t.mo===mo))),sel=S.cat?MONTHS.map(mo=>vsum(SPEND.filter(t=>t.mo===mo&&t.c===S.cat&&(!S.merch||t.m===S.merch)))):null,mx=Math.max(...tot,1);
  const many=MONTHS.length>14;
  $('mo').innerHTML=MONTHS.map((mo,i)=>{const cur=S.mode==='Q'?qOf(mo)===S.cur:S.mode==='T'?mo<=S.cur&&mo.slice(0,4)===S.cur.slice(0,4):mo===S.cur;
    return`<button class="${cur?'cur':''}" data-mo="${mo}" data-tip="${lbl(mo)}: ${eur(tot[i])}${sel?`, ${esc(S.merch||S.cat)} ${eur(sel[i])}`:''}"><div class="c" style="height:${Math.max(0,tot[i])/mx*100}%">${many?'':`<span class="t num">${kfmt(tot[i])}</span>`}${sel&&tot[i]>0?`<u style="height:${Math.max(0,sel[i])/tot[i]*100}%"></u>`:''}</div></button>`}).join('');
  $('mo').style.gap=many?'2px':'8px';$('mol').style.gap=many?'2px':'8px';
  $('mol').innerHTML=MONTHS.map((mo,i)=>`<span>${many?(mo.endsWith('-01')||i===0?MN[+mo.slice(5)-1].slice(0,1)+mo.slice(2,4):''):MN[+mo.slice(5)-1]}</span>`).join('');
  $('kname').textContent=S.merch||S.cat||'Tap a category to highlight it';
}
function heat(){
  $('hm').style.gridTemplateColumns=`minmax(110px,170px) repeat(${MONTHS.length},minmax(46px,1fr))`;
  let h=`<div></div>`+MONTHS.map(mo=>`<div class="ch">${MN[+mo.slice(5)-1]}${mo.endsWith('-01')||mo===MONTHS[0]?' '+mo.slice(2,4):''}</div>`).join('');
  for(const c of SCATS){const v=MONTHS.map(mo=>vsum(SPEND.filter(t=>t.mo===mo&&t.c===c))),mx=Math.max(...v,1);
    h+=`<div class="rh${c===S.cat?' on':''}" data-c="${esc(c)}">${esc(c)}</div>`+v.map((x,i)=>{const pr=i?v[i-1]:null,r=pr>0?x/pr-1:null,sh=Math.round(8+Math.max(0,x)/mx*82),on=c===S.cat&&S.mode==='M'&&MONTHS[i]===S.cur;
      return`<div class="cell${on?' on':''}" data-c="${esc(c)}" data-mo="${MONTHS[i]}" style="background:color-mix(in oklab,var(--blue) ${sh}%,var(--bg));color:${sh>50?'#fff':'var(--ink)'}" data-tip="${esc(c)}, ${lbl(MONTHS[i])}: ${eur(x)}${r!=null?`, ${pct(r)} MoM`:''}"><span class="num">${kfmt(x)}</span></div>`}).join('')}
  $('hm').innerHTML=h;
}
function txs(){
  const ql=S.q.toLowerCase(),iK=inP(S.cur);
  const list=TX.filter(t=>iK(t)&&(S.flow==='all'?(S.acf==='all'||t.ac===S.acf):isS(t))&&(!S.cat||t.c===S.cat)&&(!S.merch||t.m===S.merch)&&(!ql||t.m.toLowerCase().includes(ql)||(t.desc||'').toLowerCase().includes(ql)));
  $('txcap').textContent=`${pl(S.cur)}${S.cat?', '+(S.merch||S.cat):''}: ${list.length} lines.`;
  const ty={E:'Spending',I:'Income',T:'Transfer',X:'Ignored'};
  const opts=c=>CATS.map(x=>`<option${x===c?' selected':''}>${x}</option>`).join('');
  $('txt').innerHTML=list.length?`<thead><tr><th>Date</th><th style="text-align:left">Merchant</th><th style="text-align:left">Category</th><th style="text-align:left">Account</th><th>Amount</th></tr></thead><tbody>${list.slice(0,S.lim).map(t=>`<tr><td data-l="Date" class="num">${dshort(t.d)}</td><td data-l="Merchant" class="l" title="${esc(t.desc||'')}">${esc(t.m)}</td><td data-l="Category" class="l">${t.t==='E'?`<select class="cat" data-m="${esc(t.m)}" aria-label="Category for ${esc(t.m)}">${opts(t.c)}</select>`:`<span style="color:var(--ink2)">${esc(ty[t.t]+(t.t==='T'?', '+t.c.toLowerCase():t.t==='I'?', '+t.c.toLowerCase():''))}</span>`}</td><td data-l="Account" class="l"><span class="dot" style="background:var(--${t.ac})"></span>${ACC[t.ac].n.replace(' current account','')}</td><td data-l="Amount" class="num" style="color:${t.t==='T'?'var(--mute)':'inherit'}">${t.t==='E'?eur2(-t.a):(t.a>0?'+':'')+eur2(t.a)}</td></tr>`).join('')}</tbody>`:`<tbody><tr><td class="empty">Nothing matches. Clear the search or step back to all spending.</td></tr></tbody>`;
  $('more').hidden=list.length<=S.lim;
}
function spending(){const k=S.cur,p=prevOf(k);finding(k,p);yearView();crumbs();const L=level(k,p);waterfall(L,k,p);
  drivers(S.merch?(()=>{const r=L.rows.find(x=>x.n===S.merch);return{TC:r?r.cur:0,TP:r?r.prev:0,NC:r?r.nc:0,NP:r?r.np:0}})():L,k,p);table(L,k,p);scatter();months();heat();txs()}

/* ---------- savings ---------- */
function savings(){
  const k=S.cur,end=cover(k).end,A=ACTIVE(),net=holdAll(end),open=A.reduce((s,a)=>s+(OPEN[a].v||0),0),run=avgSpend3(k);
  const M=MONTHS.map(mo=>{const g=f=>vsum(TX.filter(t=>t.mo===mo&&f(t))),inc=g(t=>t.t==='I'),sp=g(t=>t.t==='E');return{mo,inc,sp,s:inc-sp,r:inc?(inc-sp)/inc:null}});
  const tot=M.reduce((s,m)=>s+m.s,0),inc=M.reduce((s,m)=>s+m.inc,0);
  $('svh').textContent=`You've saved ${eur(tot)} since ${dshort(START)}, ${inc?Math.round(tot/inc*100):0}% of what came in`;
  $('svs').textContent='Savings here means income minus real spending, wherever the difference ends up. Moving money to the Livret A or Lebanon changes where it sits, not how much you saved.';
  const best=M.filter(m=>cover(m.mo,false).got===cover(m.mo,false).full).sort((a,b)=>b.s-a.s)[0];
  $('facts').innerHTML=`<div><span>Your accounts on ${dshort(end)}</span><strong class="num">${eur(net)}</strong><span>${sgn(net-open)} since ${dshort(START)}</span></div><div><span>Runway</span><strong class="num">${run?(net/run).toFixed(1):'–'} months</strong><span>at ${eur(run)} of spending a month</span></div><div><span>Best month</span><strong class="num">${best?lbl(best.mo)+', '+eur(best.s):'–'}</strong><span>full months only</span></div>`;
  const pos=Math.max(...M.map(m=>m.s),0),neg=Math.min(...M.map(m=>m.s),0),rng=(pos-neg)||1,z=pos/rng*100,many=M.length>14;
  $('sv').style.gap=many?'2px':'8px';
  $('sv').innerHTML=`<div class="z" style="top:${z}%"></div>`+M.map(m=>{const h=Math.abs(m.s)/rng*100,up=m.s>=0,c=cover(m.mo,false),cur=S.mode==='Q'?qOf(m.mo)===S.cur:S.mode==='T'?m.mo<=S.cur&&m.mo.slice(0,4)===S.cur.slice(0,4):m.mo===S.cur;
    return`<button class="${cur?'cur':''}" data-mo="${m.mo}" data-tip="${lbl(m.mo)}: income ${eur(m.inc)}, spending ${eur(m.sp)}, saved ${eur(m.s)}${c.got<c.full?` (${c.got} of ${c.full} days)`:''}"><em style="${up?`top:${z-h}%`:`top:${z}%`};height:${Math.max(.5,h)}%;background:${c.got<c.full?`repeating-linear-gradient(135deg,var(--${up?'blue':'red'}) 0 5px,var(--bar2) 5px 9px)`:`var(--${up?'blue':'red'})`}"></em>${many?'':`<small style="top:calc(${up?z-h:z}% - 20px)" class="num">${m.r==null?'':m.r<-1?'below 0':Math.round(m.r*100)+'%'}</small>`}</button>`}).join('');
  $('svl').style.gap=many?'2px':'8px';$('svl').innerHTML=M.map((m,i)=>`<span>${many?(m.mo.endsWith('-01')||i===0?MN[+m.mo.slice(5)-1].slice(0,1)+m.mo.slice(2,4):''):MN[+m.mo.slice(5)-1]}</span>`).join('');
  const liv=balAt('LIV',end);$('livcap').textContent=`${eur(liv)} of the ${eur(CAP)} cap on ${dshort(end)}.`;$('livm').style.width=Math.min(100,Math.max(0,liv/CAP*100))+'%';
  const livIn=TX.filter(t=>t.ac==='LIV'&&inP(k)(t)).reduce((s,t)=>s+t.a,0),pace=(liv-(OPEN.LIV.v||0))/Math.max(1,days(dt(START),dt(END))/30.437);
  $('livt').textContent=`${sgn(livIn)} went in during ${pl(k)}. At your average pace since ${dshort(START)} the cap is ${pace>0?Math.ceil((CAP-liv)/pace)+' months away':'not getting closer'}. Interest is paid each January and counts as income.`;
  const fr=['SG','LIV','REV','OTH'].filter(a=>A.includes(a)).reduce((s,a)=>s+Math.max(0,balAt(a,end)),0),lb=Math.max(0,balAt('LEB',end)),T=fr+lb||1;
  $('fl').innerHTML=`<span style="width:${fr/T*100}%;background:var(--SG)" data-tip="France: ${eur(fr)}"></span><span style="width:${lb/T*100}%;background:var(--LEB)" data-tip="Lebanon: ${eur(lb)}"></span>`;
  $('flkey').innerHTML=`<span><i style="background:var(--SG)"></i>France ${eur(fr)}, ${Math.round(fr/T*100)}%</span><span><i style="background:var(--LEB)"></i>Lebanon cash ${eur(lb)}, ${Math.round(lb/T*100)}%</span>`;
  const iK=inP(k);$('abcap').textContent=`${pl(k)}: what each account started with, what moved in and out, and where it ended.`;
  const sd=iso(new Date(dt(S.mode==='T'?k.slice(0,4)+'-01-01':iso(span(k)[0]))-864e5));
  const rws=A.map(a=>{const inn=TX.filter(t=>t.ac===a&&iK(t)&&t.a>0).reduce((s,t)=>s+t.a,0),out=TX.filter(t=>t.ac===a&&iK(t)&&t.a<0).reduce((s,t)=>s+t.a,0);return{a,st:balAt(a,sd),inn,out,en:balAt(a,end)}});
  const sumf=f=>rws.reduce((s,r)=>s+f(r),0);
  $('abt').innerHTML=`<thead><tr><th>Account</th><th>Start</th><th>Money in</th><th>Money out</th><th>End</th><th>Change</th></tr></thead><tbody>${rws.map(r=>`<tr><td data-l=""><span class="dot" style="background:var(--${r.a})"></span><span class="nm">${ACC[r.a].n}</span></td><td data-l="Start" class="num">${eur(r.st)}</td><td data-l="Money in" class="num">${sgn(r.inn)}</td><td data-l="Money out" class="num">${sgn(r.out)}</td><td data-l="End" class="num"><b>${eur(r.en)}</b></td><td data-l="Change" class="num ${r.en>=r.st?'dn':'up'}">${sgn(r.en-r.st)}</td></tr>`).join('')}</tbody><tfoot><tr><td data-l="">Everything</td><td data-l="Start" class="num">${eur(sumf(r=>r.st))}</td><td data-l="Money in" class="num">${sgn(sumf(r=>r.inn))}</td><td data-l="Money out" class="num">${sgn(sumf(r=>r.out))}</td><td data-l="End" class="num">${eur(sumf(r=>r.en))}</td><td data-l="Change" class="num">${sgn(sumf(r=>r.en-r.st))}</td></tr></tfoot>`;
}

/* ---------- accounts ---------- */
function accounts(){
  const A=ACTIVE(),today=st().today||{};
  $('acc').innerHTML=A.map(a=>{const b=balAt(a,END),n=(BYAC[a]||[]).length,x=today[a],lastChk=CHECKS.filter(c=>c.ac===a).pop();
    const chk=lastChk?(Math.abs(lastChk.gap)<0.01?`<span class="d ok">Matches the statement of ${dshort(lastChk.date)}</span>`:`<span class="d up">Statement of ${dshort(lastChk.date)}: gap ${sgn(lastChk.gap)}</span>`):x!=null&&x!==''?(Math.abs(+x-b)<1?`<span class="d ok">Bank shows ${eur(+x)}, matches</span>`:`<span class="d up">Bank shows ${eur(+x)}, gap ${sgn(+x-b)}</span>`):'';
    return`<li><i style="background:var(--${a})"></i><div><b>${ACC[a].n}</b><small>${n} lines · opening from ${esc(OPEN[a].how)}</small></div><div><strong class="num">${eur(b)}</strong>${chk}</div></li>`}).join('');
  const dec=st().decisions||{},items=TX.filter(t=>t.f&&Q[t.f]),open=items.filter(t=>!dec[t.i]);
  $('rqcap').textContent=open.length?`${open.length} of ${items.length} lines the rules could not settle. Your answer is saved to your Sheet.`:'All settled. New doubtful lines will show up here.';
  $('nrev').textContent=open.length||'';
  $('rq').innerHTML=items.slice(0,40).map(t=>{const q=Q[t.f],d=dec[t.i];return`<li><p><b>${q.q}</b></p><p class="meta">${dshort(t.d)} · ${ACC[t.ac].n.replace(' current account','')} · ${esc(t.m)} · <span class="num">${sgn(t.a)}</span></p>${d?`<p class="done">Settled: ${(q.o.find(o=>o[0]===d)||[0,d])[1]}. <button class="btn" data-undo="${esc(t.i)}" style="min-height:36px;padding:0 12px">Undo</button></p>`:`<div class="acts">${q.o.map(([v,n])=>`<button class="btn" data-r="${esc(t.i)}" data-v="${v}">${n}</button>`).join('')}</div>`}</li>`}).join('');
  const iK=inP(S.cur),pairs=TX.filter(t=>t.t==='T'&&t.ac==='SG'&&iK(t));
  $('tpcap').textContent=`${pl(S.cur)}: ${pairs.length} transfers on the SG account, each matched to the account on the other side.`;
  $('tp').innerHTML=`<thead><tr><th>Date</th><th style="text-align:left">From</th><th style="text-align:left">To</th><th>Amount</th><th style="text-align:left">Match</th></tr></thead><tbody>${pairs.slice(0,S.tlim).map(t=>{const d=t.dest||'LIV',out=t.a<0,fr=out?'SG':d,to=out?d:'SG',leg=TX.find(x=>x.i===t.pr);
    return`<tr><td data-l="Date" class="num">${dshort(t.d)}</td><td data-l="From" class="l"><span class="dot" style="background:var(--${fr})"></span>${ACC[fr].n.replace(' current account','')}</td><td data-l="To" class="l"><span class="dot" style="background:var(--${to})"></span>${ACC[to].n.replace(' current account','')}</td><td data-l="Amount" class="num">${eur2(Math.abs(t.a))}</td><td data-l="Match" class="l">${leg?(leg.src==='leg'?'Recorded on both sides':'<span class="ok">Paired</span> with '+ACC[leg.ac].n.replace(' current account','')+' line'):'Waiting for the other side'}</td></tr>`}).join('')}</tbody>`;
  $('tpmore').hidden=pairs.length<=S.tlim;
  const lw=TX.filter(t=>t.ac==='LEB'),lb=st().lebanon||{};
  $('lwt2').innerHTML=`<thead><tr><th>Date</th><th style="text-align:left">What</th><th>Amount</th><th></th></tr></thead><tbody>${lw.map(t=>`<tr><td data-l="Date" class="num">${dshort(t.d)}</td><td data-l="What" class="l">${esc(t.m)}</td><td data-l="Amount" class="num">${sgn(t.a)}</td><td>${t.src==='manual'?`<button class="btn" data-delm="${esc(t.i)}" style="min-height:34px;padding:0 10px">Remove</button>`:''}</td></tr>`).join('')}<tr><td data-l="Date" class="num">${lb.asOf?dshort(lb.asOf):''}</td><td data-l="What" class="l">${lb.cash!=null&&lb.cash!==''?'Your figure in Net worth':'Opening: set your Lebanon figure in Net worth'}</td><td data-l="Amount" class="num">${eur(OPEN.LEB.v+lw.filter(t=>lb.asOf&&t.d<=lb.asOf).reduce((s,t)=>s+t.a,0))}</td><td></td></tr></tbody><tfoot><tr><td data-l="">Balance now</td><td></td><td data-l="Balance" class="num">${eur(balAt('LEB',END))}</td><td></td></tr></tfoot>`;
  $('bct').innerHTML=CHECKS.length?`<thead><tr><th>Date</th><th style="text-align:left">Account</th><th>Statement</th><th>App</th><th>Gap</th></tr></thead><tbody>${CHECKS.slice().reverse().slice(0,24).map(c=>`<tr><td data-l="Date" class="num">${dshort(c.date)}</td><td data-l="Account" class="l">${ACC[c.ac].n}</td><td data-l="Statement" class="num">${eur2(c.bal)}</td><td data-l="App" class="num">${eur2(c.calc)}</td><td data-l="Gap" class="num ${Math.abs(c.gap)<0.01?'':'up'}">${Math.abs(c.gap)<0.01?'<span class="ok">none</span>':eur2(c.gap)}</td></tr>`).join('')}</tbody>`:'<tbody><tr><td class="empty">Import a PDF statement or link a bank to get balances to check against.</td></tr></tbody>';
  if(!$('lwd').value)$('lwd').value=END||iso(new Date());
}

/* ---------- net worth ---------- */
function prices(){const o=st().px||{},q=DB.quote||{};return{price:+o.price||q.price||null,fx:+o.fx||q.fx||null,goldOz:+o.gold||q.goldOz||null}}
function networth(){
  const R=Object.assign({},DEF_RSU,st().rsu||{}),P=prices(),lb=st().lebanon||{},today=iso(new Date());
  const end=END||today,bank=['SG','LIV','REV','OTH'].reduce((s,a)=>s+balAt(a,end),0),lebCash=balAt('LEB',end);
  const goldG=(+lb.gold||0)*(+(lb.purity||21))/24,gold=P.goldOz&&P.fx?goldG*P.goldOz/31.1035*P.fx:0;
  const V=P.price&&P.fx?ER.rsu(R,{price:P.price,fx:P.fx}):[];
  const vg=V.filter(v=>v.vested),ug=V.filter(v=>!v.vested),sum=(a,k)=>a.reduce((s,v)=>s+v[k],0);
  const vNet=sum(vg,'net'),uNet=sum(ug,'net'),now=bank+lebCash+gold+vNet;
  $('nwh').textContent=`${eur(now)} today, after tax`;
  $('nws').textContent=`Bank accounts, your share in Lebanon and the Amazon shares already vested, net of what France would tax if you sold today. ${ug.length?`Another ${eur(uNet)} after tax arrives as the remaining ${ug.length} vest${ug.length>1?'s':''} land, at today's price.`:''}`;
  const k=[['Bank accounts',eur(bank),'SG, Livret A, Revolut'],['Lebanon, yours',eur(lebCash+gold),`${eur(lebCash)} cash, ${eur(gold)} gold`],['Amazon, vested',eur(vNet),`${eur(sum(vg,'gross'))} before tax`],['Amazon, to vest',eur(uNet),`${eur(sum(ug,'gross'))} before tax`]];
  $('nwk').innerHTML=k.map(([n,v,x])=>`<div class="kpi"><span>${n}</span><strong class="num">${v}</strong><span class="d" style="color:var(--ink2)">${x}</span></div>`).join('');
  const parts=[['SG',bank,'Bank accounts'],['LEB',lebCash+gold,'Lebanon, cash and gold'],['REV',vNet,'Amazon, vested, after tax']],T=parts.reduce((s,p)=>s+Math.max(0,p[1]),0)||1;
  $('nwbar').innerHTML=parts.map(([c,v,n])=>`<span style="width:${Math.max(0,v)/T*100}%;background:var(--${c})" data-tip="${n}: ${eur(v)}"></span>`).join('');
  $('nwlist').innerHTML=parts.map(([c,v,n])=>`<li><i style="background:var(--${c})"></i><span>${n}</span><strong class="num">${eur(v)}</strong><span class="num" style="text-align:right;color:var(--ink2)">${Math.round(Math.max(0,v)/T*100)}%</span></li>`).join('')+`<li><i style="background:transparent;border:1.5px dashed var(--REV)"></i><span>Still to vest, after tax<small>not counted in today's figure</small></span><strong class="num">${eur(uNet)}</strong><span></span></li>`;
  const q=DB.quote||{},o=st().px||{};
  $('px').textContent=P.price?`Amazon $${P.price.toFixed(2)}${o.price?' (your figure)':q.priceSrc?' from '+q.priceSrc:''}, 1 USD = €${(P.fx||0).toFixed(4)}${o.fx?' (your figure)':q.fxSrc?' from '+q.fxSrc:''}, gold $${Math.round(P.goldOz||0)} an ounce${o.gold?' (your figure)':q.goldSrc?' from '+q.goldSrc:''}.`:'Prices not loaded yet: connect your Sheet in Setup, or type them in below.';
  const mx=Math.max(...V.map(v=>v.gross),1);
  $('vcap').textContent=V.length?`${R.grant} shares in the grant, at $${P.price.toFixed(2)} and €${P.fx.toFixed(4)} per dollar. ${vg.length} vest${vg.length===1?'':'s'} done, ${ug.length} to come.`:'Prices are needed to value the shares.';
  $('vest').innerHTML=V.map(v=>`<div><b>${dshort(v.date)}</b><small>${v.pct}% · ${v.held.toFixed(2)} sh${v.vested?'':' · to come'}</small></div><div class="bx" data-tip="${esc(v.why)}"><em class="g" style="width:${v.gross/mx*100}%"></em><em class="n${v.vested?'':' f'}" style="width:${Math.max(0,v.net)/mx*100}%"></em></div><div class="num" style="text-align:right"><b>${eur(v.net)}</b><small>${eur(v.gross)} gross</small></div>`).join('');
  /* editors */
  const set=(id,v)=>{const e=$(id);if(document.activeElement!==e)e.value=v??''};
  set('rg',R.grant);set('rp',R.plan);set('rt',R.tmi);set('rs',R.social);set('rf',R.pfu);
  if(!$('rv').contains(document.activeElement))$('rv').innerHTML=`<thead><tr><th>Vest date</th><th>%</th><th>Sold</th><th>Price that day, $</th><th></th></tr></thead><tbody>${R.vests.map((v,i)=>`<tr><td><input type="date" data-v="${i}" data-k="date" value="${esc(v.date)}"></td><td><input type="number" step="1" min="0" max="100" data-v="${i}" data-k="pct" value="${esc(v.pct)}"></td><td><input type="number" step="0.01" min="0" data-v="${i}" data-k="sold" value="${esc(v.sold||'')}" placeholder="0"></td><td><input type="number" step="0.01" min="0" data-v="${i}" data-k="vestPrice" value="${esc(v.vestPrice||'')}" placeholder="${v.date<=today?'needed':'later'}"></td><td><button class="btn" type="button" data-delv="${i}" style="min-height:34px;padding:0 10px" aria-label="Remove vest">✕</button></td></tr>`).join('')}</tbody>`;
  const tp=R.vests.reduce((s,v)=>s+(+v.pct||0),0);$('rmsg').textContent=Math.abs(tp-100)>0.01?`The vests add up to ${tp}%, not 100%.`:'';$('rmsg').className='msg'+(Math.abs(tp-100)>0.01?' bad':'');
  set('la',lb.asOf||END);set('lc',lb.cash);set('lcu',lb.cur||'USD');set('lg',lb.gold);set('lp',lb.purity||21);
  set('pa',o.price);set('pf',o.fx);set('pg',o.gold);
}

/* ---------- setup ---------- */
function setup(){
  $('s1').className=conn?'fin':'';
  if(conn&&!$('cu').value){$('cu').value=conn.url}
  const s=st(),a=s.accounts||{};
  const set=(id,v)=>{const e=$(id);if(document.activeElement!==e)e.value=v??''};
  set('ame',s.me||'');set('aemp',s.employer||'');set('asg',a.sg||'');set('aliv',a.liv||'');
  $('s2').className=a.sg?'fin':'';$('s3').className=DB.ops.length?'fin':'';
  const files={};for(const o of DB.ops){const f=o.file||o.src;(files[f]=files[f]||{n:0,min:'9',max:'0',ac:new Set()});const x=files[f];x.n++;if(o.d<x.min)x.min=o.d;if(o.d>x.max)x.max=o.d;x.ac.add(o.ac)}
  $('files').innerHTML=Object.entries(files).sort((a,b)=>a[1].min.localeCompare(b[1].min)).map(([f,x])=>`<li><span><b>${esc(f)}</b><br><small>${x.n} lines · ${dshort(x.min)} to ${dshort(x.max)} · ${[...x.ac].map(c=>ACC[c].n).join(', ')}</small></span>${f==='bank'?'':`<button class="btn" data-delf="${esc(f)}">Remove</button>`}</li>`).join('');
  const today=s.today||{};
  $('opt').innerHTML=`<thead><tr><th>Account</th><th>Opening on ${dshort(START)}</th><th style="text-align:left">Worked out from</th><th>Bank shows today</th></tr></thead><tbody>${['SG','LIV','REV'].map(a=>`<tr><td>${ACC[a].n}</td><td class="num">${eur2(OPEN[a].v)}</td><td class="l" style="color:var(--ink2)">${esc(OPEN[a].how)}</td><td><input type="number" step="0.01" data-today="${a}" value="${esc(today[a]??'')}" placeholder="optional" inputmode="decimal"></td></tr>`).join('')}</tbody>`;
  const bad=CHECKS.filter(c=>Math.abs(c.gap)>=0.01);$('omsg').textContent=CHECKS.length?(bad.length?`${bad.length} of ${CHECKS.length} statement balances do not match; see Accounts, Balance check.`:`All ${CHECKS.length} statement balances match to the cent.`):'';$('omsg').className='msg '+(bad.length?'bad':'good');
  $('s4').className=CHECKS.length&&!bad.length?'fin':'';
  $('redir').textContent=location.origin+location.pathname;
  const B=DB.bank||{};$('s5').className=(B.links||[]).length?'fin':'';
  $('eblinks').innerHTML=(B.links||[]).map(l=>`<li><span><b>${esc(l.bank)}</b><br><small>${l.accounts.map(a=>esc(a.name||'Account')+' ending '+a.end).join(', ')} · approved until ${dshort((l.until||'').slice(0,10))}</small></span><button class="btn" data-forget="${esc(l.bank)}">Unlink</button></li>`).join('');
  $('ebmsg').textContent=B.configured?(B.lastSync?`Last sync ${dshort(B.lastSync.slice(0,10))}: ${B.lastResult}`:'Key saved. Link your banks.'):'Not set up yet.';
  $('s6').className=DB.claude?'fin':'';
  const unk=[...new Set(TX.filter(t=>t.t==='E'&&t.c==='Other').map(t=>t.m))];$('ckmsg').textContent=DB.claude?`${unk.length} merchant${unk.length===1?'':'s'} in Other right now.`:'No key saved yet.';
}

/* ---------- imports ---------- */
let pending=null;
async function readText(file,enc){const b=await file.arrayBuffer();return new TextDecoder(enc).decode(b)}
let pdfLib=null;
async function pdfjs(){if(!pdfLib){pdfLib=await import('./vendor/pdf.min.mjs');pdfLib.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.min.mjs',location.href).href}return pdfLib}
function showPending(){
  const P=$('prev');if(!pending){P.hidden=true;return}
  const have=new Set(DB.ops.map(o=>o.id)),fresh=pending.ops.filter(o=>!have.has(o.id));
  const after=ER.dedupe(DB.ops.concat(fresh)).dropped-ER.dedupe(DB.ops).dropped;
  P.hidden=false;
  P.innerHTML=`<p><b>${pending.files.length} file${pending.files.length>1?'s':''} read</b></p><ul class="files">${pending.files.map(f=>`<li><span>${esc(f.name)}<br><small>${f.note}</small></span></li>`).join('')}</ul>
  <p class="msg">${fresh.length} new lines${pending.ops.length-fresh.length?`, ${pending.ops.length-fresh.length} already saved`:''}${after?`, ${after} already present in another file and kept once`:''}.</p>
  <div class="row"><button class="btn pri" id="psave" type="button">Save to my Sheet</button><button class="btn" id="pcancel" type="button">Cancel</button></div>`;
}
async function onFiles(kind,files){
  pending=pending||{ops:[],balances:[],files:[]};
  const accts=engineSettings().accounts;
  for(const f of files){
    try{
      let r,note;
      if(kind==='pdf'){const lib=await pdfjs();const doc=await lib.getDocument({data:new Uint8Array(await f.arrayBuffer())}).promise;r=await ER.parseSGpdf(doc,accts);
        note=`${ACC[r.ac].n}${r.acct?' ending '+r.acct.slice(-4):''}, ${r.period?dshort(r.period[0])+' to '+dshort(r.period[1]):''}, ${r.ops.length} lines. `+(r.check?(r.check.ok?`Balance ${eur2(r.check.open)} to ${eur2(r.check.close)} adds up to the cent.`:`Warning: lines add to ${eur2(r.check.flows)} but the balance moved ${eur2(r.check.close-r.check.open)}.`):'No balance found.');
        if(!accts.some(a=>ER.matchAccount(r.acct,[a])))note+=' This account number does not match step 2; check the endings there.'}
      else if(kind==='csv'){r=ER.parseSGcsv(await readText(f,'windows-1252'),accts);const ds=r.ops.map(o=>o.d).sort();note=`${r.ops.length} lines, ${dshort(ds[0])} to ${dshort(ds[ds.length-1])}.`}
      else{r=ER.parseRevolut(await readText(f,'utf-8'));const ds=r.ops.map(o=>o.d).sort();note=`${r.ops.length} lines in euros, ${dshort(ds[0])} to ${dshort(ds[ds.length-1])}.`+(r.skipped.cur?` ${r.skipped.cur} lines in other currencies left out.`:'')}
      r.ops.forEach(o=>o.file=f.name);r.balances.forEach(b=>b.src=b.src||kind);
      pending.ops.push(...r.ops);pending.balances.push(...r.balances);pending.files.push({name:f.name,note});
    }catch(e){pending.files.push({name:f.name,note:'Could not read: '+e.message})}
  }
  showPending();
}
async function savePending(){
  if(!pending)return;const btn=$('psave');btn.disabled=true;btn.textContent='Saving…';
  try{
    const byFile={};for(const o of pending.ops)(byFile[o.file]=byFile[o.file]||[]).push(o);
    let added=0;
    for(const[f,ops]of Object.entries(byFile)){for(let i=0;i<ops.length;i+=400){const r=await call('putOps',{ops:ops.slice(i,i+400),balances:i?[]:pending.balances.filter(b=>pending.ops.some(o=>o.file===f&&o.ac===b.ac)),file:f});added+=r.added}}
    const have=new Set(DB.ops.map(o=>o.id));DB.ops.push(...pending.ops.filter(o=>!have.has(o.id)));
    const bk=b=>b.ac+'|'+b.date+'|'+b.src,hb=new Set(DB.balances.map(bk));DB.balances.push(...pending.balances.filter(b=>!hb.has(bk(b))));
    pending=null;cache();recompute();render();toast(`${added} lines saved to your Sheet`);
  }catch(e){btn.disabled=false;btn.textContent='Save to my Sheet';toast('Not saved: '+e.message)}
}

/* ---------- router ---------- */
const VIEWS=['overview','spending','savings','accounts','networth','setup'],DATA_VIEWS=['overview','spending','savings','accounts'];
function render(){
  prepS();
  const empty=!TX.length&&DATA_VIEWS.includes(S.view);
  for(const m of document.querySelectorAll('main'))m.hidden=empty||m.dataset.v!==S.view;
  $('nodata').hidden=!empty;$('nodatat').textContent=conn?'Your Sheet is connected but holds no bank lines yet. Import your first file in Setup.':'Connect your Google Sheet and import your first bank file in Setup. Everything you add is stored in your own Sheet, not here.';
  for(const a of document.querySelectorAll('nav.tabs a')){if(a.getAttribute('href')==='#'+S.view)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')}
  $('period').hidden=empty||!DATA_VIEWS.includes(S.view)||!S.cur;
  if(!empty&&S.cur){renderMetro();
    if(S.view==='overview')overview();if(S.view==='spending')spending();if(S.view==='savings')savings();if(S.view==='accounts')accounts()}
  if(S.view==='networth')networth();if(S.view==='setup')setup();
  if(S.view!=='accounts'){const dec=st().decisions||{},n=TX.filter(t=>t.f&&Q[t.f]&&!dec[t.i]).length;$('nrev').textContent=n||''}
}
function route(){const h=location.hash.slice(1);S.view=VIEWS.includes(h)?h:(TX.length?'overview':'setup');render();window.scrollTo(0,0)}
function pick(n){if(!n)return;if(!S.cat){S.cat=n;S.merch=null;S.sort='ctc';S.dir=-1}else S.merch=S.merch===n?null:n;S.lim=40;render()}
function setMode(m){const was=S.mode,last=MONTHS[MONTHS.length-1];S.mode=m;
  if(m==='Q')S.cur=qOf(S.cur.includes('Q')?(MONTHS.filter(x=>qOf(x)===S.cur).pop()||last):S.cur);else if(S.cur.includes('Q'))S.cur=MONTHS.filter(x=>qOf(x)===S.cur).pop()||last;
  if(m==='T'&&was!=='T')S.cur=last;
  if(m==='Y'&&!prevOf(S.cur)){const ok=MONTHS.filter(x=>prevOf(x));if(ok.length)S.cur=ok[ok.length-1]}
  if((m==='M'||m==='Q')&&!prevOf(S.cur)){const p=periods(m);S.cur=p[p.length-1]}
  S.lim=40;render()}

/* ---------- events ---------- */
$('mM').onclick=()=>setMode('M');$('mQ').onclick=()=>setMode('Q');$('mY').onclick=()=>setMode('Y');$('mT').onclick=()=>setMode('T');
$('metro').onclick=e=>{const b=e.target.closest('.st');if(b&&!b.disabled){S.cur=b.dataset.k;render()}};
$('acf').onclick=e=>{const b=e.target.closest('[data-a]');if(b){S.acf=b.dataset.a;S.cat=null;S.merch=null;render()}};
const go=e=>{const b=e.target.closest('[data-go]');if(!b)return;if(b.dataset.go==='all'){S.cat=null;S.merch=null}else S.merch=null;render()};
$('crumb1').onclick=go;$('crumb2').onclick=go;
$('wf').onclick=e=>{const b=e.target.closest('[data-n]');if(b)pick(b.dataset.n)};
$('scs').onclick=e=>{const b=e.target.closest('[data-n]');if(b)pick(b.dataset.n)};
$('tbl').onclick=e=>{const th=e.target.closest('th.s');if(th){const s=th.dataset.s;S.dir=S.sort===s?-S.dir:(s==='n'?1:-1);S.sort=s;render();return}const r=e.target.closest('tbody tr');if(r)pick(r.dataset.n)};
$('years').onclick=e=>{const b=e.target.closest('[data-y]');if(b){S.yr=b.dataset.y;render()}};
$('yr').onclick=e=>{const b=e.target.closest('button[data-mo]');if(!b||b.disabled)return;const mo=b.dataset.mo;if(S.mode!=='Y'||!MONTHS.includes((+mo.slice(0,4)-1)+mo.slice(4)))S.mode='M';S.cur=mo;render()};
$('sm').onclick=e=>{const b=e.target.closest('[data-c]');if(!b)return;const c=b.dataset.c;if(S.cat===c){S.cat=null}else{S.cat=c}S.merch=null;render()};
$('mo').onclick=e=>{const b=e.target.closest('button');if(!b)return;S.mode='M';S.cur=b.dataset.mo;render()};
$('sv').onclick=e=>{const b=e.target.closest('button');if(!b)return;S.mode='M';S.cur=b.dataset.mo;render()};
$('hm').onclick=e=>{const c=e.target.closest('[data-c]');if(!c)return;S.cat=c.dataset.c;S.merch=null;if(c.dataset.mo){S.mode='M';S.cur=c.dataset.mo}render()};
$('big').onclick=e=>{const li=e.target.closest('li[data-c]');if(!li)return;S.cat=li.dataset.c;S.merch=li.dataset.n;S.acf='all';location.hash='#spending'};
$('q').oninput=e=>{S.q=e.target.value;S.lim=40;txs()};
$('ff').onchange=e=>{S.flow=e.target.value;txs()};
$('more').onclick=()=>{S.lim+=40;txs()};
$('txt').onchange=e=>{const s=e.target.closest('select.cat');if(!s)return;const m=s.dataset.m,c=s.value;saveSettings({rules:(st().rules||[]).filter(r=>r.m!==m).concat({m,c})});toast(`Every line from ${m} is now ${c}`)};
$('tpmore').onclick=()=>{S.tlim+=40;accounts()};
$('rq').onclick=e=>{const b=e.target.closest('[data-r]');if(b){saveSettings({decisions:Object.assign({},st().decisions,{[b.dataset.r]:b.dataset.v})});return}
  const u=e.target.closest('[data-undo]');if(u){const d=Object.assign({},st().decisions);delete d[u.dataset.undo];saveSettings({decisions:d})}};
$('lw').onsubmit=e=>{e.preventDefault();const a=+$('lwa').value;if(!a)return;const t=$('lwt').value,note=$('lwn').value.trim();
  const man=(st().manual||[]).concat({i:'man:'+Date.now(),d:$('lwd').value,ac:'LEB',m:note||(t==='E'?'Spent in Lebanon':'Added to the wallet'),c:t==='E'?'Spent in Lebanon':'Cash added',t,a:t==='E'?-a:a});
  $('lwa').value='';$('lwn').value='';saveSettings({manual:man})};
$('lwt2').onclick=e=>{const b=e.target.closest('[data-delm]');if(b)saveSettings({manual:(st().manual||[]).filter(m=>m.i!==b.dataset.delm)})};
/* net worth editors */
const rsu=()=>JSON.parse(JSON.stringify(Object.assign({},DEF_RSU,st().rsu||{})));
const rsuSet=patch=>saveSettings({rsu:Object.assign(rsu(),patch)});
$('rg').onchange=e=>rsuSet({grant:+e.target.value});$('rp').onchange=e=>rsuSet({plan:e.target.value});
$('rt').onchange=e=>rsuSet({tmi:+e.target.value});$('rs').onchange=e=>rsuSet({social:+e.target.value});$('rf').onchange=e=>rsuSet({pfu:+e.target.value});
$('rv').onchange=e=>{const i=e.target.closest('[data-v]');if(!i)return;const R=rsu();R.vests[+i.dataset.v][i.dataset.k]=i.type==='number'?(i.value===''?'':+i.value):i.value;R.vests.sort((a,b)=>a.date.localeCompare(b.date));saveSettings({rsu:R})};
$('rv').onclick=e=>{const b=e.target.closest('[data-delv]');if(!b)return;const R=rsu();R.vests.splice(+b.dataset.delv,1);saveSettings({rsu:R})};
$('ramz').onclick=()=>{const first=prompt('Date of your first vest (YYYY-MM-DD)','');if(!first||!/^\d{4}-\d{2}-\d{2}$/.test(first))return;const R=rsu();const d0=dt(first);R.vests=AMZ_SCHEDULE.map((p,i)=>{const d=new Date(d0);d.setUTCMonth(d.getUTCMonth()+(i===0?0:6+6*(i-1)+6));return{date:iso(d),pct:p}});saveSettings({rsu:R})};
$('raddv').onclick=()=>{const R=rsu();const last=R.vests[R.vests.length-1];const d=last?new Date(dt(last.date).getTime()+182*864e5):new Date();R.vests.push({date:iso(d),pct:0});saveSettings({rsu:R})};
$('rfetch').onclick=async()=>{const R=rsu(),today=iso(new Date()),need=R.vests.filter(v=>v.date<=today);
  try{$('rmsg').textContent='Asking your script for the closing prices…';const r=await call('vestPrices',{symbol:'AMZN',dates:need.map(v=>v.date)});
    r.prices.forEach(p=>{const v=R.vests.find(x=>x.date===p.date);if(v&&p.price)v.vestPrice=Math.round(p.price*100)/100});saveSettings({rsu:R});$('rmsg').textContent='Vest-day prices filled from Yahoo Finance. Your payslip value wins if it differs; type it over.'}
  catch(e){$('rmsg').textContent='Could not fetch prices: '+e.message;$('rmsg').className='msg bad'}};
const leb=()=>Object.assign({},st().lebanon||{});
$('la').onchange=e=>saveSettings({lebanon:Object.assign(leb(),{asOf:e.target.value})});
$('lc').onchange=e=>saveSettings({lebanon:Object.assign(leb(),{cash:e.target.value===''?null:+e.target.value,asOf:leb().asOf||END})});
$('lcu').onchange=e=>saveSettings({lebanon:Object.assign(leb(),{cur:e.target.value})});
$('lg').onchange=e=>saveSettings({lebanon:Object.assign(leb(),{gold:+e.target.value})});
$('lp').onchange=e=>saveSettings({lebanon:Object.assign(leb(),{purity:+e.target.value})});
const pxSet=(k,v)=>saveSettings({px:Object.assign({},st().px||{},{[k]:v===''?null:+v})});
$('pa').onchange=e=>pxSet('price',e.target.value);$('pf').onchange=e=>pxSet('fx',e.target.value);$('pg').onchange=e=>pxSet('gold',e.target.value);
$('prefresh').onclick=async()=>{try{DB.quote=await call('quote');cache();render();toast('Prices refreshed')}catch(e){toast('Could not refresh: '+e.message)}};
/* setup */
$('cgo').onclick=async()=>{let u=$('cu').value.trim(),t=$('ct').value.trim();
  if(/^[\w-]{30,}$/.test(u))u=`https://script.google.com/macros/s/${u}/exec`;
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec/.test(u)){$('cmsg').textContent='The link should start with https://script.google.com/macros/s/ and end with /exec.';$('cmsg').className='msg bad';return}
  const old=conn;conn={url:u,token:t};$('cmsg').textContent='Checking…';$('cmsg').className='msg';
  try{const r=await call('ping');localStorage.setItem('er_conn',JSON.stringify(conn));$('cmsg').textContent=`Connected to “${r.sheet}”.`;$('cmsg').className='msg good';$('ct').value='';await loadAll()}
  catch(e){conn=old;$('cmsg').textContent=e.message==='Failed to fetch'?'Could not reach the script. Check the link, and that the deployment gives access to Anyone.':e.message;$('cmsg').className='msg bad'}};
$('asave').onclick=()=>{saveSettings({me:$('ame').value.trim().toUpperCase(),employer:$('aemp').value.trim().toUpperCase(),accounts:{sg:$('asg').value.replace(/\D/g,''),liv:$('aliv').value.replace(/\D/g,'')}});$('amsg').textContent='Saved.';$('amsg').className='msg good'};
$('fpdf').onchange=e=>{onFiles('pdf',[...e.target.files]);e.target.value=''};
$('fcsv').onchange=e=>{onFiles('csv',[...e.target.files]);e.target.value=''};
$('frev').onchange=e=>{onFiles('rev',[...e.target.files]);e.target.value=''};
$('prev').onclick=e=>{if(e.target.id==='psave')savePending();if(e.target.id==='pcancel'){pending=null;showPending()}};
$('files').onclick=async e=>{const b=e.target.closest('[data-delf]');if(!b)return;const f=b.dataset.delf;
  if(b.dataset.sure!=='1'){b.dataset.sure='1';b.textContent='Tap again to remove';return}
  try{const r=await call('deleteFile',{file:f});DB.ops=DB.ops.filter(o=>(o.file||o.src)!==f);cache();recompute();render();toast(`${r.deleted} lines removed`)}catch(err){toast(err.message)}};
$('opt').onchange=e=>{const i=e.target.closest('[data-today]');if(i)saveSettings({today:Object.assign({},st().today,{[i.dataset.today]:i.value===''?null:+i.value})})};
$('ebsave').onclick=async()=>{const f=$('ebkey').files[0];try{const r=await call('bankConfig',{appId:$('ebid').value.trim(),key:f?await f.text():''});DB.bank=r.bank;$('ebkey').value='';render();toast('Saved in your Google script')}catch(e){$('ebmsg').textContent=e.message;$('ebmsg').className='msg bad'}};
async function link(code,re,country){
  try{$('ebmsg').textContent='Asking Enable Banking…';let banks=(await call('bankBanks',{country})).banks;let name=banks.find(b=>re.test(b));
    if(!name&&code==='REV'){country='LT';banks=(await call('bankBanks',{country})).banks;name=banks.find(b=>re.test(b))}
    if(!name)throw new Error('Bank not found in the list: '+banks.filter(b=>/soci|revol/i.test(b)).join(', '));
    const r=await call('bankStart',{bank:name,country,code,redirect:location.origin+location.pathname});location.href=r.url}
  catch(e){$('ebmsg').textContent=e.message;$('ebmsg').className='msg bad'}}
$('ebsg').onclick=()=>link('SG',/^soci[ée]t[ée] g[ée]n[ée]rale$/i,'FR');
$('ebrev').onclick=()=>link('REV',/^revolut/i,'FR');
$('ebsync').onclick=async()=>{try{$('ebmsg').textContent='Syncing…';const r=await call('bankSync',{days:DB.bank&&DB.bank.lastSync?30:90});toast(`${r.added} new lines from your banks`);await loadAll()}catch(e){$('ebmsg').textContent=e.message;$('ebmsg').className='msg bad'}};
$('eblinks').onclick=async e=>{const b=e.target.closest('[data-forget]');if(!b)return;try{DB.bank=(await call('bankForget',{bank:b.dataset.forget})).bank;render()}catch(err){toast(err.message)}};
$('cksave').onclick=async()=>{try{const r=await call('claudeConfig',{key:$('ck').value.trim()});DB.claude=r.claude;$('ck').value='';render();toast(r.claude?'Key saved in your Google script':'Key removed')}catch(e){$('ckmsg').textContent=e.message}};
$('ckrun').onclick=async()=>{const items=[...new Map(TX.filter(t=>t.t==='E'&&t.c==='Other').map(t=>[t.m,{m:t.m,desc:t.desc}])).values()];
  if(!items.length){toast('Nothing in Other to sort');return}
  try{$('ckmsg').textContent=`Asking Claude about ${items.length} merchants…`;const r=await call('categorize',{items,categories:CATS.filter(c=>c!=='Other'&&c!=='Spent via Revolut')});
    const add=Object.entries(r.map).map(([m,c])=>({m,c,by:'claude'}));const keep=(st().rules||[]).filter(x=>!r.map[x.m]);saveSettings({rules:keep.concat(add)});$('ckmsg').textContent=`${add.length} merchants sorted. Change any of them in Spending, Transactions.`}
  catch(e){$('ckmsg').textContent=e.message;$('ckmsg').className='msg bad'}};
addEventListener('hashchange',route);
const tip=$('tip');
document.addEventListener('pointerover',e=>{const t=e.target.closest('[data-tip]');if(!t){tip.style.opacity=0;return}tip.textContent=t.getAttribute('data-tip');tip.style.opacity=1});
document.addEventListener('pointermove',e=>{if(tip.style.opacity==='1'){const x=Math.min(e.clientX+14,innerWidth-tip.offsetWidth-8),y=e.clientY+18+tip.offsetHeight>innerHeight?e.clientY-tip.offsetHeight-12:e.clientY+18;tip.style.left=x+'px';tip.style.top=y+'px'}});
new ResizeObserver(()=>{if(S.view==='overview'&&TX.length)stack()}).observe($('stks'));
new ResizeObserver(()=>{if(S.view==='spending'&&TX.length)scatter()}).observe($('scs'));

/* ---------- start ---------- */
(async function start(){
  try{const c=JSON.parse(localStorage.getItem('er_cache')||'null');if(c&&(conn||window.ER_MOCK)){Object.assign(DB,c)}}catch(e){}
  recompute();route();
  const qs=new URLSearchParams(location.search);
  if(qs.get('code')&&qs.get('state')){
    history.replaceState(null,'',location.pathname+'#setup');
    try{const r=await call('bankFinish',{code:qs.get('code'),state:qs.get('state')});DB.bank=r.bank;toast('Bank linked. Press Sync now to bring in the lines.');route()}
    catch(e){toast('Bank link failed: '+e.message)}
  }else if(qs.get('error')){history.replaceState(null,'',location.pathname+'#setup');toast('The bank link was cancelled: '+qs.get('error'))}
  if(conn||window.ER_MOCK)await loadAll();else setConn('','Not connected');
  if('serviceWorker'in navigator&&location.protocol==='https:')navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
}
