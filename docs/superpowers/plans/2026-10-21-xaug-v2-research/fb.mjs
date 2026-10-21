import fs from 'fs';import {loadApp,bars} from './load.mjs';
const A=loadApp();const d=bars().slice(0,-1);A.calculateIndicators(d);
const N=d.length, W=1000, FEE=0.04;
const idxOf=new Map(d.map((b,i)=>[b.time,i]));
const W1=0.5,W2=0.25,W3=0.25;
function fin(kind,e,dir,px){const s=dir==='LONG'?1:-1;const r=p=>s*(p-e)/e*100;
 if(kind==='SL')return r(px)-FEE; if(kind==='BE')return W1*0.5+(W2+W3)*r(px)-FEE; if(kind==='P50')return W1*0.5+W2*0.75+W3*r(px)-FEE;
 if(kind==='TP3')return W1*0.5+W2*0.75+W3*1.0-FEE; return null;}
function openPnl(stage,e,dir,px){const s=dir==='LONG'?1:-1;const r=s*(px-e)/e*100;return (stage===0?r:stage===1?W1*0.5+0.5*r:W1*0.5+W2*0.75+0.25*r)-FEE;}
// WSB exit — копия логики updateTradeMarkers (WSB)
function wsbExit(i0,dir,e,top,bot,atr){const L=dir==='LONG';const rd=atr*1.5;let sl=L?Math.min(e-rd,bot):Math.max(e+rd,top);
 const t1=L?e*1.005:e*0.995,t2=L?e*1.0075:e*0.9925,t3=L?e*1.01:e*0.99,be=L?e*1.0004:e*0.9996,ph=L?e*1.005:e*0.995;let st=0,j;
 const hit=(b,p)=>L?b.high>=p:b.low<=p, stop=(b,p)=>L?b.low<=p:b.high>=p;
 for(j=i0+1;j<Math.min(i0+150,N);j++){const b=d[j];
  if(st===0){if(stop(b,sl))return{k:'SL',p:fin('SL',e,dir,sl),j};
    if(hit(b,t1)){st=1;sl=be;if(hit(b,t2)){st=2;sl=ph;if(hit(b,t3))return{k:'TP3',p:fin('TP3',e,dir),j};}}}
  else if(st===1){if(stop(b,sl))return{k:'BE',p:fin('BE',e,dir,be),j};if(hit(b,t2)){st=2;sl=ph;if(hit(b,t3))return{k:'TP3',p:fin('TP3',e,dir),j};}}
  else {if(stop(b,sl))return{k:'P50',p:fin('P50',e,dir,ph),j};if(hit(b,t3))return{k:'TP3',p:fin('TP3',e,dir),j};}}
 const jj=Math.min(j,N-1);return{k:jj>=N-1?'OPEN':'T150',p:openPnl(st,e,dir,d[jj].close),j:jj};}
// MR exit — копия логики симуляции разворота
function mrExit(i0,dir,e){const L=dir==='LONG';let sl=L?e*0.99:e*1.0075;const t1=L?e*1.005:e*0.995,t2=L?e*1.0075:e*0.9925,t3=L?e*1.01:e*0.99,be=L?e*1.0004:e*0.9996,ph=L?e*1.005:e*0.995;let st=0;
 const hit=(b,p)=>L?b.high>=p:b.low<=p, stop=(b,p)=>L?b.low<=p:b.high>=p;
 for(let j=i0+1;j<N;j++){const b=d[j];
  if(st===0){if(stop(b,sl))return{k:'SL',p:fin('SL',e,dir,sl),j};if(hit(b,t1)){st=1;sl=be;}}
  if(st===1){if(stop(b,sl))return{k:'BE',p:fin('BE',e,dir,be),j};if(hit(b,t2)){st=2;sl=ph;}}
  if(st===2){if(stop(b,sl))return{k:'P50',p:fin('P50',e,dir,ph),j};if(hit(b,t3))return{k:'TP3',p:fin('TP3',e,dir),j};}}
 return{k:'OPEN',p:openPnl(st,e,dir,d[N-1].close),j:N-1};}
function stats(name,tr){const done=tr.filter(t=>t.r.k!=='OPEN');const p=done.map(t=>t.r.p);const c={};done.forEach(t=>c[t.r.k]=(c[t.r.k]||0)+1);
 const months=(d[N-1].time-d[W].time)/2.63e6;
 return {variant:name,signals:tr.length,perMonth:+(tr.length/months).toFixed(1),long:tr.filter(t=>t.dir==='LONG').length,short:tr.filter(t=>t.dir==='SHORT').length,
  winPct:+(100*p.filter(x=>x>0).length/p.length).toFixed(1),avgPct:+(p.reduce((a,b)=>a+b,0)/p.length).toFixed(3),sumPct:+p.reduce((a,b)=>a+b,0).toFixed(1),exits:c};}
const out={range:[new Date(d[W].time*1e3).toISOString(),new Date(d[N-1].time*1e3).toISOString()],bars:N-W};
// ---------- WSB A: метки/звук ----------
const wsbFull=A.calculateWSBOrderFlow(d);const seen=new Set();const wA=[];
for(const b of wsbFull.allBoxes){if(!b.breakoutOccurred)continue;const bb=b.breakoutBar;if(A.isDeathZone(bb.time))continue;const key=bb.time+'_'+b.breakoutDir;if(seen.has(key))continue;seen.add(key);
 const i=idxOf.get(bb.time);if(i<W)continue;wA.push({i,dir:b.breakoutDir,e:bb.close,top:b.top,bot:b.bottom,atr:bb.atr||5,prob:b.probability,sig:b.signalDir});}
wA.forEach(t=>t.r=wsbExit(t.i,t.dir,t.e,t.top,t.bot,t.atr));
const lab={SL:/Stop Loss/,BE:/Б\/У/,P50:/Стоп \+0.5/,TP3:/TP3/};
const mk=A.run(d,'wsb');const mc={};for(const[k,re]of Object.entries(lab))mc[k]=mk.filter(m=>re.test(m.text)).length;
const wAll=[];const seen2=new Set();for(const b of wsbFull.allBoxes){if(!b.breakoutOccurred)continue;const bb=b.breakoutBar;if(A.isDeathZone(bb.time))continue;const key=bb.time+'_'+b.breakoutDir;if(seen2.has(key))continue;seen2.add(key);const i=idxOf.get(bb.time);wAll.push(wsbExit(i,b.breakoutDir,bb.close,b.top,b.bottom,bb.atr||5));}
// Ложный пробой: после свечи пробоя цена ЗАКРЫЛАСЬ обратно внутри бокса раньше, чем сделка закрылась
const L_=t=>t.dir==='LONG';
const inside=(t,b)=>L_(t)?b.close<=t.top:b.close>=t.bot;
for(const t of wA){t.back=null;for(let j=t.i+1;j<=t.r.j;j++){if(inside(t,d[j])){t.back=j-t.i;break;}}
 // дошёл ли до TP1 до возврата
 const e=t.e,tp1=L_(t)?e*1.005:e*0.995;t.tp1First=false;for(let j=t.i+1;j<=(t.back?t.i+t.back:t.r.j);j++){if(L_(t)?d[j].high>=tp1:d[j].low<=tp1){t.tp1First=true;break;}}}
const done=wA.filter(t=>t.r.k!=='OPEN');
const grp=(name,s)=>{const p=s.map(t=>t.r.p);const c={};s.forEach(t=>c[t.r.k]=(c[t.r.k]||0)+1);return `${name}: n=${s.length} (${(100*s.length/done.length).toFixed(0)}%) win=${s.length?(100*p.filter(x=>x>0).length/s.length).toFixed(0):'-'}% avg=${s.length?(p.reduce((a,b)=>a+b,0)/s.length).toFixed(2):'-'} sum=${p.reduce((a,b)=>a+b,0).toFixed(1)} ${JSON.stringify(c)}`;};
const fb=done.filter(t=>t.back&&!t.tp1First), ok=done.filter(t=>!(t.back&&!t.tp1First));
console.log(grp('ложный (вернулся в бокс до TP1)',fb));console.log(grp('остальные',ok));
for(const k of [1,2,3,4]){console.log(`вернулся за ${k} свеч.:`,fb.filter(t=>t.back===k).length);}
console.log('вернулся позже 4:',fb.filter(t=>t.back>4).length);
// Подтверждение: следующая свеча тоже закрылась за боксом
const conf=done.filter(t=>t.i+1<N&&!inside(t,d[t.i+1]));const nconf=done.filter(t=>t.i+1<N&&inside(t,d[t.i+1]));
console.log(grp('след. свеча осталась за боксом',conf));console.log(grp('след. свеча вернулась',nconf));
// Сколько ложных пробоев закончились стопом, и куда ушла цена потом: пробила ли противоположную границу
const opp=fb.filter(t=>{for(let j=t.i+1;j<=Math.min(N-1,t.i+60);j++){if(L_(t)?d[j].close<t.bot:d[j].close>t.top)return true;}return false;}).length;
console.log('ложный → закрытие за противоположной границей в 60 свечах:',opp,'из',fb.length);
// баллы у ложных и нормальных
const avgp=s=>(s.reduce((a,t)=>a+t.prob,0)/s.length).toFixed(1);console.log('средний процент: ложные',avgp(fb),'остальные',avgp(ok));
const c2=wA.filter(t=>t.i+1<N-1&&!inside(t,d[t.i+1])).map(t=>({...t,r:wsbExit(t.i+1,t.dir,d[t.i+1].close,t.top,t.bot,d[t.i+1].atr)})).filter(t=>t.r.k!=='OPEN');
const p=c2.map(t=>t.r.p);console.log('ЧЕСТНО: вход на закрытии свечи-подтверждения: n',c2.length,'win',(100*p.filter(x=>x>0).length/p.length).toFixed(0),'avg',(p.reduce((a,b)=>a+b,0)/p.length).toFixed(3),'sum',p.reduce((a,b)=>a+b,0).toFixed(1));
