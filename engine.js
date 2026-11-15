/* ExpensaReview engine: reads bank files, removes duplicates, classifies every line once,
   pairs transfers between your own accounts, and works out balances. No data lives in this file. */
(function(root){
'use strict';
const MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const num=s=>{s=String(s).trim().replace(/\s/g,'');if(/,\d{1,2}$/.test(s))s=s.replace(/\./g,'').replace(',','.');return parseFloat(s)};
const isoFR=s=>{const m=String(s).match(/(\d{2})\/(\d{2})\/(\d{4})/);return m?`${m[3]}-${m[2]}-${m[1]}`:null};
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(36)}
const up=s=>String(s||'').toUpperCase();

/* ---------- CSV ---------- */
function splitCSV(text,sep){
  const rows=[];let row=[],cur='',q=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(q){if(c==='"'){if(text[i+1]==='"'){cur+='"';i++}else q=false}else cur+=c}
    else if(c==='"')q=true;else if(c===sep){row.push(cur);cur=''}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cur);cur='';if(row.some(x=>x!==''))rows.push(row);row=[]}
    else cur+=c}
  row.push(cur);if(row.some(x=>x!==''))rows.push(row);return rows;
}
function withIds(ops){const seen={};for(const o of ops){const k=[o.ac,o.d,o.a,o.desc].join('|');seen[k]=(seen[k]||0)+1;o.id=o.src+':'+hash(k+'#'+seen[k])}return ops}

/* Société Générale CSV export (semicolon, Latin-1) */
function parseSGcsv(text,accounts){
  const rows=splitCSV(text,';');const h=rows[0].map(x=>x.trim());
  const ix=n=>h.findIndex(x=>x.toLowerCase().startsWith(n));
  const iD=ix('date comptabilisation'),iT=ix('date transaction'),iN=ix('num compte'),iO=h.findIndex(x=>/libell.*op/i.test(x)),iF=h.findIndex(x=>/libell.*complet/i.test(x)),iC=ix('cat'),iS=ix('sous'),iM=ix('montant');
  if(iM<0||(iD<0&&iT<0))throw new Error('This does not look like an SG export: no Date or Montant column.');
  const ops=[];
  for(const r of rows.slice(1)){if(!r[iM])continue;
    const d=isoFR(r[iD>=0?iD:iT]);if(!d)continue;
    ops.push({src:'csv',ac:matchAccount(r[iN]||'',accounts)||'SG',d,td:isoFR(r[iT>=0?iT:iD]),a:Math.round(num(r[iM])*100)/100,short:(r[iO]||'').trim(),desc:(r[iF]||r[iO]||'').trim(),cat0:[(r[iC]||'').trim(),(r[iS]||'').trim()].filter(Boolean).join(' / ')})}
  return{ops:withIds(ops),balances:[]};
}

/* Revolut CSV/Excel export: Type, Product, Started Date, Completed Date, Description, Amount, Fee, Currency, State, Balance */
function parseRevolut(text){
  const sep=(text.split('\n')[0].match(/;/g)||[]).length>(text.split('\n')[0].match(/,/g)||[]).length?';':',';
  const rows=splitCSV(text,sep);const h=rows[0].map(x=>x.trim().toLowerCase());
  const ix=n=>h.indexOf(n);
  const iTy=ix('type'),iCd=ix('completed date'),iSd=ix('started date'),iDe=ix('description'),iAm=ix('amount'),iFe=ix('fee'),iCu=ix('currency'),iSt=ix('state'),iBa=ix('balance'),iPr=ix('product');
  if(iAm<0||iDe<0)throw new Error('This does not look like a Revolut statement: no Description or Amount column.');
  const ops=[],bal={},skipped={cur:0,state:0};
  for(const r of rows.slice(1)){
    const st=up(r[iSt]);if(st&&st!=='COMPLETED'){skipped.state++;continue}
    const cu=up(r[iCu]||'EUR');if(cu!=='EUR'){skipped.cur++;continue}
    if(iPr>=0&&/savings|pocket|vault/i.test(r[iPr]||''))continue;
    const ds=(r[iCd]||r[iSd]||'').slice(0,10);const d=/^\d{4}-\d{2}-\d{2}$/.test(ds)?ds:isoFR(ds);if(!d)continue;
    const a=Math.round((num(r[iAm])-(iFe>=0?num(r[iFe]||0)||0:0))*100)/100;
    ops.push({src:'rev',ac:'REV',d,td:d,a,short:(r[iDe]||'').trim(),desc:(r[iDe]||'').trim(),cat0:up(r[iTy]).replace(/\s+/g,'_')});
    if(iBa>=0&&r[iBa]!=='')bal[d]=num(r[iBa]);
  }
  return{ops:withIds(ops),balances:Object.entries(bal).map(([date,b])=>({ac:'REV',date,bal:b,src:'rev'})),skipped};
}

/* Société Générale PDF statement, read with pdf.js text positions */
async function parseSGpdf(pdf,accounts){
  const ops=[],bal=[];let acct='',period=null,ac=null;
  for(let p=1;p<=pdf.numPages;p++){
    const page=await pdf.getPage(p),vp=page.getViewport({scale:1}),tc=await page.getTextContent();
    const words=tc.items.filter(i=>i.str&&i.str.trim()&&Math.abs(i.transform[1])<0.01).map(i=>({t:i.str,x0:i.transform[4],x1:i.transform[4]+i.width,y:vp.height-i.transform[5]}));
    const all=words.map(w=>w.t).join(' ');
    if(!acct){const m=all.replace(/\s+/g,' ').match(/n°\s*((?:\d[\s]*){23})/);if(m){acct=m[1].replace(/\s/g,'');ac=matchAccount(acct,accounts)}}
    if(!period){const m=all.replace(/\s+/g,'').match(/du(\d\d\/\d\d\/\d{4})au(\d\d\/\d\d\/\d{4})/);if(m)period=[isoFR(m[1]),isoFR(m[2])]}
    const hD=words.find(w=>w.t.trim()==='Débit'),hC=words.find(w=>w.t.trim()==='Crédit');if(!hD||!hC)continue;
    const top=hD.y,xd=hD.x1,xc=hC.x1;
    const ws=words.filter(w=>w.y>top+2&&w.x1<vp.width-30).sort((a,b)=>a.y-b.y||a.x0-b.x0);
    const lines=[];for(const w of ws){const L=lines[lines.length-1];if(L&&Math.abs(w.y-L.y)<3)L.w.push(w);else lines.push({y:w.y,w:[w]})}
    for(const L of lines){
      const lw=L.w.sort((a,b)=>a.x0-b.x0),t=lw.map(w=>w.t.trim()).join(' ').replace(/\s+/g,' ');
      const sm=t.match(/SOLDE.*?AU\s*(\d\d\/\d\d\/\d{4})\s*([+-])?\s*([\d.]+,\d\d)/);
      if(/SOLDE/.test(t)&&sm){const kind=/PR[ÉE]C[ÉE]DENT/.test(t)?'open':/NOUVEAU/.test(t)?'close':'mid';if(kind!=='mid')bal.push({date:isoFR(sm[1]),bal:num(sm[3])*(sm[2]==='-'?-1:1),src:'pdf',kind});continue}
      const dm=t.match(/^(\d\d\/\d\d\/\d{4}) (\d\d\/\d\d\/\d{4}) (.*)$/);
      if(dm){const last=lw[lw.length-1];const am=last.t.trim();if(!/^[\d.]+,\d\d$/.test(am))continue;
        const v=num(am),debit=Math.abs(last.x1-xd)<Math.abs(last.x1-xc);
        ops.push({src:'pdf',d:isoFR(dm[1]),td:isoFR(dm[2]),a:debit?-v:v,short:dm[3].replace(/\s*[\d.]+,\d\d$/,'').trim(),more:[]});continue}
      const o=ops[ops.length-1];
      if(o&&lw[0].x0>60&&lw[lw.length-1].x1<xd-30&&!/suite >>>|RELEV|Page \d|ADEME|TOTAUX/.test(t)&&o.more.length<8)o.more.push(t);
    }
  }
  for(const o of ops){o.ac=ac||'SG';o.desc=(o.short+' '+o.more.join(' ')).replace(/\s+/g,' ').trim();o.cat0='';delete o.more}
  for(const b of bal)b.ac=ac||'SG';
  const open=bal.find(b=>b.kind==='open'),close=[...bal].reverse().find(b=>b.kind==='close');
  const sum=Math.round(ops.reduce((s,o)=>s+o.a,0)*100)/100;
  const check=open&&close?{open:open.bal,close:close.bal,flows:sum,ok:Math.abs(open.bal+sum-close.bal)<0.005}:null;
  return{ops:withIds(ops),balances:bal,acct,ac:ac||'SG',period,check};
}
function matchAccount(no,accounts){const d=String(no).replace(/\D/g,'');if(!d)return null;
  for(const a of accounts||[])for(const m of a.match||[]){const k=String(m).replace(/\D/g,'');if(k&&(d.endsWith(k)||d.slice(0,-2).endsWith(k)))return a.code}
  return null}

/* ---------- merchants and categories ---------- */
function merchant(o){
  let s=o.short||o.desc||'';
  s=s.replace(/^000001 /,'').replace(/^CARTE X\d+ (REMBT |TRANSF )?(\d\d\/\d\d )?/,'').replace(/^(PRELEVEMENT EUROPEEN (\d+ )?(POUR CPTE )?DE: ?|PRLV EUROPEEN ACC\s+\d+ DE: |VIR RECU (\d+\w? )?DE: |VIR EMIS\s+POUR: |VIR INST RE \d+ (WERO )?DE: )/,'');
  if(/^VIR (RECU|INSTANTANE|EUROPEEN)|^PRELEVEMENT/.test(s)){const m=(o.desc||'').match(/(?:DE|POUR): ?([^:]+?)(?: \d\d \d\d | IBAN| DATE| REF| MOTIF| ID:| MANDAT| CHEZ|$)/);if(m)s=m[1]}
  s=s.replace(/COMMERCE ELECTRONIQUE/,'').replace(/\s\d+,\d\d (EUR|USD).*$/,'').replace(/\s+(MANDAT|ID:|REF:|MOTIF:|CHEZ:).*$/i,'').replace(/\s+\d{3,}\S*\s*$/,'').replace(/^(NYX\*|UBR\* PENDING\.|SumUp\s+\*|SC- )/,'').replace(/\s+/g,' ').trim();
  s=s.toLowerCase().replace(/(^|[\s\-'(./])\S/g,c=>c.toUpperCase());
  return s.slice(0,32)||'Unknown';
}
const RULES=[
 [/DELIVEROO|UBER ?\*? ?EATS|JUST ?EAT|STUART|ZOMATO|TALABAT|TOTERS/,'Food delivery'],
 [/FOURNIL|PAIN BENI|MICHALAK|BOULANG|BOUBAKER|FRANPRIX|E\.N\.E SUPER|LIDL|AUCHAN|EPICERIE|CARREFOUR|MONOPRIX|PATISSER|PICARD|INTERMARCHE|LECLERC|NATURALIA|BIOCOOP|CASINO|G20 |CARDINET|LA GRANDE EPICERIE|ALDI|SUPERMARCH/,'Groceries'],
 [/MIDDLE EAST AIRLINES|SNCB|FLIXBUS|CAREEM|TRAINLINE|OUIGO|EUROSTAR|NAVIGO|COMUTITRES|UBER(?! ?\*? ?EATS)|BOLT|SNCF|TRANSAVIA|RATP|AIR FRANCE|EASYJET|RYANAIR|VUELING|LIME|BLABLACAR|PANASONIC AVIONICS|HEETCH|G7 |TOTAL ?ENERGIES|ESSO|SHELL/,'Transport & travel'],
 [/AIRBNB|BOOKING\.COM|HOTEL|ACCOR/,'Transport & travel'],
 [/^APPLE$|BOUYGUES|APPLE\.COM|HBOMAX|HBO MAX|AMAZON PRIME|AMZ DIGITAL|PRIME VIDEO|DATAFORD|COACHAKEN|SPOTIFY|NETFLIX|DISNEY|YOUTUBE|GOOGLE ?\*|ICLOUD|FREE MOBILE|SFR|ORANGE|CANAL|CHATGPT|OPENAI|ANTHROPIC|CLAUDE\.AI|BASIC.?FIT|FITNESS PARK/,'Subscriptions & phone'],
 [/FRANCE CAMPUS|PROXIWASH|LOYER|EDF|ENGIE|TOTALENERGIES ELEC|IKEA|LEROY MERLIN|CASTORAMA|ASSURANCE HABITATION/,'Housing'],
 [/PHARMACIE|DOCTOLIB|MIKALOU|MEDECIN|DENTIST|LABO|OPTIC|COIFF/,'Health & care'],
 [/R[EÉ]PUBLIQUE FRAN[CÇ]AISE|ANTS |TIMBRE FISCAL|DGFIP|IMPOT|COTISATION MENSUELLE|COMMISSION D.INTERVENTION|FRAIS PAIEMENT|ARRETE|AVANTAGE COMMERCIAL|INTERET.*DEBIT|AGIOS|FRAIS /,'Bank fees & taxes'],
 [/ZALANDO|CELIO|COURIR|NIKE|C&A|MORGAN|FURLA|LAGERFELD|SHOWROOMPRIVE|DUTY FREE|VF J FRANCE|ADIDAS|MANGO|COS |JD SPORTS|COFIDIS|AMAZON|ZARA|FNAC|DARTY|DECATHLON|H&M|UNIQLO|SEPHORA|ACTION |PRIMARK|BOULANGER|ALIEXPRESS|SHEIN|VINTED/,'Shopping'],
 [/HIPPOPOTAMUS|ENTREC[OÔ]TE|VAGENENDE|BOBUN|ALICI|SAVEURS|GARDEN|EASYMEAL|CARONSERVICE|KRISPY|MIDELI|MCDONALD|KFC|BURGER|STARBUCKS|PRET A MANGER|PAUL |COLUMBUS|RESTAU|BRASSERIE|CAFE|PIZZ|SUSHI|TAWOUK|BECKY/,'Eating out'],
 [/UGC|PATHE|MK2|MEGARAMA|CINEMA|FDJ|THEATRE|CONCERT|FNAC SPECTACLES|BAR /,'Going out'],
 [/WERO|ASSOCIATION|DON |CROIX.ROUGE|UNICEF/,'Friends & gifts'],
];
const CATS=['Spent via Revolut','Housing','Groceries','Eating out','Food delivery','Transport & travel','Subscriptions & phone','Shopping','Going out','Health & care','Friends & gifts','Bank fees & taxes','Cash withdrawals','Insurance','Other'];
function sgFallback(cat0){const c=up(cat0);
  if(/RESTAURANT/.test(c))return'Eating out';if(/ALIMENTATION/.test(c))return'Groceries';if(/VOYAGE|TRANSPORT/.test(c))return'Transport & travel';
  if(/SANT/.test(c))return'Health & care';if(/ABONNEMENT|T[EÉ]L[EÉ]PHON/.test(c))return'Subscriptions & phone';if(/LOGEMENT/.test(c))return'Housing';
  if(/IMP[OÔ]T|SERVICES FINANCIERS/.test(c))return'Bank fees & taxes';if(/V[EÊ]TEMENT|ELECTRONIQUE|LIVRES/.test(c))return'Shopping';
  if(/JEUX|LOISIRS/.test(c))return'Going out';if(/CADEAUX|SOLIDARIT/.test(c))return'Friends & gifts';return null}

/* classify one line on one account. Returns {t:'E'|'I'|'T'|'X', c, m, dest?, flag?} */
function classify(o,S){
  const D=up(o.desc),a=o.a,me=up(S.me||'\u0000'),m=merchant(o);
  const rule=(S.rules||[]).find(r=>r.m&&up(m)===up(r.m));
  const pick=()=>{if(rule)return rule.c;for(const[re,c]of RULES)if(re.test(D))return c;return sgFallback(o.cat0)||'Other'};
  if(o.ac==='REV'){
    const ty=up(o.cat0).replace(/\s+/g,'_');
    if(ty==='EXCHANGE')return{t:'X',c:'Exchange',m};
    if(/TAPTAP/.test(D)&&a<0)return{t:'T',c:'To Lebanon wallet',m:'TapTap Send',dest:'LEB'};
    const pf=(o.desc||'').match(/^Payment from (?:M\.? |MME |MR )?(.+)$/i);
    if(a>0&&pf&&!D.includes(me))return{t:'E',c:rule?rule.c:'Friends & gifts',m:pf[1].trim().replace(/\b\w+/g,w=>w[0]+w.slice(1).toLowerCase()),flag:'payback'};
    if(ty==='TOPUP'||/TOP.?UP|^TRANSFER FROM .*?(SOCIETE|GENERALE)/i.test(o.desc)||(a>0&&D.includes(me)))return{t:'T',c:'From SG',m:'Top-up from SG',dest:'SG'};
    if(/WHISH|CREDIT LIBANAIS|OMT |BOB FINANCE/.test(D)&&a<0)return{t:'E',c:rule?rule.c:'Friends & gifts',m,flag:'p2p'};
    if(a<0&&(D.includes(me)||/TO EUR/.test(D)||(me.length>2&&new RegExp('TRANSFER TO .*'+me.split(' ').pop()).test(D))))return{t:'T',c:'To SG',m:'Back to SG',dest:'SG'};
    if(ty==='CARD_REFUND'||ty==='REFUND'||ty==='CHARGE_REFUND')return{t:'E',c:pick(),m};
    if(ty==='FEE'||ty==='CHARGE')return{t:'E',c:'Bank fees & taxes',m};
    if(ty==='TRANSFER'&&a>0)return{t:'E',c:rule?rule.c:'Friends & gifts',m,flag:'payback'};
    if(ty==='TRANSFER'&&a<0)return{t:'E',c:rule?rule.c:'Friends & gifts',m,flag:Math.abs(a)>=100?'p2p':''};
    if(ty==='ATM')return{t:'E',c:'Cash withdrawals',m:'Cash withdrawal',flag:'cash'};
    return{t:'E',c:pick(),m};
  }
  if(o.ac==='LIV'){
    if(/INTER[EÊ]TS?/.test(D)&&a>0)return{t:'I',c:'Interest',m:'Livret A interest'};
    return{t:'T',c:a>0?'From current account':'To current account',m:a>0?'From current account':'To current account',dest:'SG'};
  }
  /* SG current account */
  if(/TAPTAP/.test(D))return{t:'T',c:'To Lebanon wallet',m:'TapTap Send',dest:'LEB'};
  if(/REVOLUT\*\*|BQ (REVO|28233)|SENT FROM REVOLUT/.test(D)||(/REVO|REVOLUT/.test(D)&&(D.includes(me)||/TRANSF/.test(D))))return{t:'T',c:a<0?'To Revolut':'From Revolut',m:'Revolut (own)',dest:'REV'};
  if(D.includes(me)||(S.livretNo&&D.includes(S.livretNo)))return{t:'T',c:a<0?'To own account':'From own account',m:'Own account',dest:'OWN'};
  if(/VERST ESP/.test(D))return{t:'I',c:'Cash deposit',m:'Cash deposit',flag:'cashdep'};
  if(/^CARTE .*RETRAIT DAB/.test(up(o.short)||D))return{t:'E',c:'Cash withdrawals',m:'Cash withdrawal',flag:'cash'};
  if(/SOGECAP/.test(D))return{t:'E',c:'Insurance',m:'Sogecap',flag:'sogecap'};
  if(a>0&&(/SALAIRE/.test(up(o.cat0))||(S.employer&&D.includes(up(S.employer)))))return{t:'I',c:'Salary',m};
  if(a>0&&/^(VIR RECU|VIR INST RE|VIR SEPA RECU)/.test(up(o.short))){
    if(!/WERO|HENNER|CPAM|AMELI|MUTUELLE|PHARMACIE/.test(D))for(const[re,c]of RULES)if(re.test(D)&&['Transport & travel','Shopping','Subscriptions & phone','Food delivery','Groceries','Housing'].includes(c))return{t:'E',c,m};   /* a merchant refunding you */
    return{t:'I',c:'Refunds & other in',m};
  }
  if(a<0&&/TRWIBEB|WISE/.test(D)&&Math.abs(a)>=100)return{t:'E',c:rule?rule.c:'Friends & gifts',m,flag:'p2p'};
  return{t:'E',c:pick(),m};
}

/* ---------- build the ledger ---------- */
const PRI={pdf:4,bank:3,csv:2,rev:2};
function dedupe(raw){
  const g=new Map();
  for(const o of raw){const k=o.ac+'|'+o.d+'|'+Math.round(o.a*100);if(!g.has(k))g.set(k,{});const b=g.get(k);(b[o.src]=b[o.src]||[]).push(o)}
  const out=[];let dropped=0;
  for(const b of g.values()){const srcs=Object.keys(b).sort((x,y)=>b[y].length-b[x].length||PRI[y]-PRI[x]);const keep=b[srcs[0]];out.push(...keep);for(const s of srcs.slice(1))dropped+=b[s].length;
    /* borrow a category hint from the CSV twin when the kept line is from a PDF */
    if(b.csv&&srcs[0]!=='csv')keep.forEach((o,i)=>{if(!o.cat0&&b.csv[i])o.cat0=b.csv[i].cat0})}
  return{ops:out,dropped};
}
const addDays=(d,n)=>{const x=new Date(d+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)};
const dd=(a,b)=>Math.abs((new Date(a)-new Date(b))/864e5);
/* when the name or employer was left empty, read them from the data itself */
function infer(ops){
  const cnt=(m,k)=>{if(k)m[k]=(m[k]||0)+1},top=m=>Object.entries(m).sort((a,b)=>b[1]-a[1])[0];
  const me={},emp={};
  for(const o of ops){const D=up(o.desc);
    let x=D.match(/POUR: (?:M\.? |MME )?([A-Z][A-Z .'-]+?) \d\d \d\d BQ (?:REVO|28233)/);if(x)cnt(me,x[1].trim());
    x=o.ac==='REV'&&D.match(/^PAYMENT FROM (?:M\.? |MME )?(.+)$/);if(x&&o.cat0==='TOPUP')cnt(me,x[1].trim());
    x=o.a>800&&D.match(/DE: ([A-Z0-9][A-Z0-9 .&'-]+?) (MOTIF|REF|$)/);if(x&&/SALAIRE|^VIR RECU/.test(D))cnt(emp,x[1].trim())}
  const m=top(me),e=top(emp);
  return{me:m&&m[1]>=2?m[0]:'',employer:e&&e[1]>=3?e[0]:''};
}
function build(raw,S){
  S=Object.assign({},S||{});const dec=S.decisions||{};
  if(!S.me||!S.employer){const g=infer(raw);S.me=S.me||g.me;S.employer=S.employer||g.employer;S.inferred=g}
  const{ops,dropped}=dedupe(raw);
  const tx=[];
  for(const o of ops){
    const k=classify(o,S);let d=o.d;
    const rm=(o.short||'').match(/REMBT (\d\d)\/(\d\d)/);if(rm){const y=+d.slice(0,4)-(+rm[2]>+d.slice(5,7)?1:0);d=`${y}-${rm[2]}-${rm[1]}`}
    tx.push({i:o.id,d,mo:d.slice(0,7),ac:o.ac,m:k.m,c:k.c,t:k.t,a:o.a,dest:k.dest,f:k.flag||'',src:o.src,desc:o.desc})
  }
  /* decisions from the review list */
  for(const t of tx){const v=dec[t.i];if(!v)continue;
    if(v==='leb'){t.t='T';t.c='To Lebanon wallet';t.dest='LEB'}
    else if(v==='sav'){t.t='T';t.c='To other savings';t.dest='OTH'}
    else if(v==='own'){t.t='E';t.c='Cash withdrawals';t.m='Cash paid back in'}
    else if(v.startsWith('cat:')){t.t='E';t.c=v.slice(4)}
    else if(v==='income'){t.t='I';t.c='Refunds & other in'}
  }
  /* pair transfers between own accounts */
  const has=new Set(tx.map(t=>t.ac));
  /* no Revolut file or link yet: money sent there is counted as spent, since that is where it gets spent */
  if(!has.has('REV'))for(const t of tx)if(t.t==='T'&&t.dest==='REV'){t.t='E';t.c='Spent via Revolut';t.m='Revolut top-up';delete t.dest}
  const pool=tx.filter(t=>t.t==='T'&&t.ac!=='SG'&&t.dest!=='LEB');
  const used=new Set();
  const legs=[];
  const sgDays=new Set(tx.filter(t=>t.ac==='SG').map(t=>t.d));
  const sgNear=d=>{for(let i=-5;i<=5;i++)if(sgDays.has(addDays(d,i)))return true;return false};
  for(const t of tx.filter(t=>t.t==='T'&&t.ac==='REV'&&t.dest==='LEB')){const leg={i:'leg:'+t.i,d:t.d,mo:t.mo,ac:'LEB',m:'TapTap Send from Revolut',c:'From Revolut',t:'T',a:-t.a,pr:t.i,src:'leg'};t.pr=leg.i;legs.push(leg)}
  for(const t of tx.filter(t=>t.t==='T'&&t.ac==='SG').sort((a,b)=>a.d.localeCompare(b.d))){
    const dests=t.dest==='OWN'?['LIV','REV']:[t.dest];
    let hit=null;
    for(const ac of dests){if(!has.has(ac))continue;
      hit=pool.find(p=>!used.has(p.i)&&p.ac===ac&&Math.abs(p.a+t.a)<0.005&&dd(p.d,t.d)<=5);if(hit)break}
    if(hit){used.add(hit.i);t.pr=hit.i;hit.pr=t.i;t.dest=hit.ac}
    else{const ac=t.dest==='OWN'?'LIV':t.dest;t.dest=ac;
      if(has.has(ac)&&ac!=='LEB'&&ac!=='OTH'){t.f=t.f||'unpaired'}
      else{const leg={i:'leg:'+t.i,d:t.d,mo:t.mo,ac,m:ac==='LEB'?'TapTap Send from SG':'Transfer from SG',c:'From SG',t:'T',a:-t.a,pr:t.i,src:'leg'};t.pr=leg.i;legs.push(leg)}}
    if(t.dest==='LIV'&&t.c.includes('own account'))t.c=t.a<0?'To Livret A':'From Livret A';
    if(t.dest==='REV'&&t.c.includes('own account'))t.c=t.a<0?'To Revolut':'From Revolut';
  }
  for(const p of pool)if(!used.has(p.i)&&p.ac==='REV'&&p.c==='From SG'&&sgNear(p.d))p.f=p.f||'unpaired';
  for(const m of S.manual||[])legs.push({...m,mo:m.d.slice(0,7),src:'manual'});
  const all=tx.concat(legs).sort((a,b)=>b.d.localeCompare(a.d)||String(a.i).localeCompare(String(b.i)));
  return{tx:all,dropped,me:S.me,employer:S.employer};
}

/* balances: opening from the earliest statement balance, else today's balance, else manual */
function openings(tx,balances,S){
  const res={},start=tx.length?tx[tx.length-1].d:null;
  for(const ac of['SG','LIV','REV','LEB','OTH']){
    const flows=d=>tx.filter(t=>t.ac===ac&&t.d<=d).reduce((s,t)=>s+t.a,0);
    const bs=(balances||[]).filter(b=>b.ac===ac).sort((a,b)=>a.date.localeCompare(b.date));
    const today=(S.today||{})[ac];
    if(ac==='LEB'&&S.lebanon&&S.lebanon.cash!=null){res[ac]={v:(+S.lebanon.cash||0)-tx.filter(t=>t.ac==='LEB'&&t.d<=(S.lebanon.asOf||'9999')).reduce((s,t)=>s+t.a,0),how:'your Lebanon figure'};continue}
    if(bs.length){res[ac]={v:bs[0].bal-flows(bs[0].date),how:'statement of '+bs[0].date};continue}
    if(today!=null&&today!==''){res[ac]={v:+today-flows('9999'),how:"today's balance you entered"};continue}
    res[ac]={v:+((S.open||{})[ac]||0),how:'opening you entered'};
  }
  return res;
}
/* statement balances as anchors: the balance on a day is the last statement balance before it plus the lines since.
   A missing statement then only affects its own weeks, not everything after it. */
function anchors(balances){
  const ok=b=>b.src!=='pdf'||b.kind==='open'||b.kind==='close';
  const m={};for(const b of(balances||[]).filter(ok)){(m[b.ac]=m[b.ac]||new Map()).set(b.date,+b.bal)}
  const out={};for(const ac in m)out[ac]=[...m[ac]].sort((x,y)=>x[0].localeCompare(y[0]));return out;
}
function balanceChecks(tx,balances,open){
  return(balances||[]).map(b=>{const calc=open[b.ac].v+tx.filter(t=>t.ac===b.ac&&t.d<=b.date).reduce((s,t)=>s+t.a,0);return{...b,calc:Math.round(calc*100)/100,gap:Math.round((b.bal-calc)*100)/100||0}});
}

/* ---------- Amazon RSUs, French tax ---------- */
function rsu(R,px){
  /* R: {grant, vests:[{date,pct,sold,vestPrice}], plan:'nq'|'q', tmi, social, pfu}, px: {price,fx} price in USD, fx = EUR per USD */
  const P=px.price,fx=px.fx,today=new Date().toISOString().slice(0,10);
  const tmi=(+R.tmi||30)/100,soc=(+R.social||22)/100,pfu=(+R.pfu||31.4)/100,ps=0.186,nd=0.029;
  return(R.vests||[]).map(v=>{
    const sh=(+R.grant||0)*(+v.pct||0)/100,held=Math.max(0,sh-(+v.sold||0)),vested=v.date<=today;
    const gross=held*P*fx,pv=(+v.vestPrice||P),acq=held*pv*fx,gain=Math.max(0,(P-pv)*held*fx);
    let tax,why;
    if(R.plan==='q'){tax=acq*tmi*0.5+acq*ps+gain*pfu;why='Qualified plan: income tax on half the vesting value, 18.6% social levies on all of it, flat tax on any rise since vesting'}
    else if(vested){tax=gain*pfu;why='Taxed as salary through payroll when it vested; only the rise since then would be taxed, at the 31.4% flat tax'}
    else{tax=gross*soc+gross*(1-soc+nd)*tmi;why=`Will be taxed as salary when it vests: about ${Math.round(soc*100)}% social charges plus income tax at ${Math.round(tmi*100)}%`}
    return{...v,shares:sh,held,vested,gross,tax,net:gross-tax,why};
  });
}

const api={anchors,infer,MN,CATS,parseSGcsv,parseSGpdf,parseRevolut,merchant,classify,build,openings,balanceChecks,rsu,dedupe,hash,matchAccount,addDays};
if(typeof module!=='undefined')module.exports=api;else root.ER=api;
})(typeof window!=='undefined'?window:globalThis);
