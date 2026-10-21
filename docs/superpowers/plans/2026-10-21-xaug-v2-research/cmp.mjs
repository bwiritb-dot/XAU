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
// ---------- WSB B: карточка >= 90 ----------
const wB=[];let prevKey=null;
for(let i=W;i<N;i++){const w=d.slice(i-W+1,i+1).map(o=>({...o}));const st=A.calculateWSBOrderFlow(w);const last=w[W-1];const box=st.activeBox;
 if(A.isDeathZone(last.time)){prevKey=null;continue;}
 const dr=st.deltaRatio,gate=Math.abs(st.currentZScore)>=1.0;let L=0,S=0;
 if(box&&box.active){if(box.signalDir==='LONG'){L+=40;if(dr>0.15)L+=30;if(gate)L+=20;if(last.close>box.top)L+=10;}else{S+=40;if(dr<-0.15)S+=30;if(gate)S+=20;if(last.close<box.bottom)S+=10;}}
 const fire=L>=90?'LONG':S>=90?'SHORT':null;const key=fire&&box?box.startTime+fire:null;
 if(fire&&key!==prevKey){const brk=fire==='LONG'?last.close>box.top:last.close<box.bottom;wB.push({i,dir:fire,e:last.close,top:box.top,bot:box.bottom,atr:last.atr||5,brk});}
 prevKey=key;}
wB.forEach(t=>t.r=wsbExit(t.i,t.dir,t.e,t.top,t.bot,t.atr));
// ---------- MR A: звук ----------
const rA=[];let lst=null;
for(let i=W;i<N;i++){const cur=d[i],prev=d[i-1];if(A.isDeathZone(cur.time))continue;
 const la=(cur.bbLower<=cur.vwapL2)&&(cur.smiTsi<0)&&(cur.ao<0)&&(cur.uo<40)&&(cur.lrs<-3.0);const sa=(cur.bbUpper>=cur.vwapU2)&&(cur.smiTsi>0)&&(cur.ao>0)&&(cur.uo>60)&&(cur.lrs>3.0);
 const lt=(cur.aoColor===1&&prev.aoColor===-1)||(cur.smiTsi>cur.smiSig&&prev.smiTsi<=prev.smiSig);const stt=(cur.aoColor===-1&&prev.aoColor===1)||(cur.smiTsi<cur.smiSig&&prev.smiTsi>=prev.smiSig);
 if(la&&lt&&lst!==cur.time){lst=cur.time;rA.push({i,dir:'LONG',e:cur.close});}else if(sa&&stt&&lst!==cur.time){lst=cur.time;rA.push({i,dir:'SHORT',e:cur.close});}}
rA.forEach(t=>t.r=mrExit(t.i,t.dir,t.e));
// ---------- MR B: метки ----------
const mm=A.run(d,'mr');const rBall=mm.filter(m=>m.shape!=='square').map(m=>{const i=idxOf.get(m.time);return{i,dir:m.shape==='arrowUp'?'LONG':'SHORT',e:d[i].close};});
rBall.forEach(t=>t.r=mrExit(t.i,t.dir,t.e));const rB=rBall.filter(t=>t.i>=W);
const mrm={};for(const[k,re]of Object.entries(lab))mrm[k]=mm.filter(m=>re.test(m.text)).length;
// ---------- сводка ----------
out.WSB=[stats('A метка/звук',wA),stats('B карточка>=90',wB)];
out.WSB_B_withBreakout=wB.filter(t=>t.brk).length;
out.WSB_A_boxDir_ne_breakDir=wA.filter(t=>t.sig!==t.dir).length;
out.WSB_same_bar_overlap=wB.filter(t=>wA.some(a=>a.i===t.i&&a.dir===t.dir)).length;
out.MR=[stats('A звук',rA),stats('B метка',rB)];out.MR_overlap=rB.filter(t=>rA.some(a=>a.i===t.i&&a.dir===t.dir)).length;
out.MR_B_byDir=[stats('B long',rB.filter(t=>t.dir==='LONG')),stats('B short',rB.filter(t=>t.dir==='SHORT'))];
out.MR_A_byDir=[stats('A long',rA.filter(t=>t.dir==='LONG')),stats('A short',rA.filter(t=>t.dir==='SHORT'))];
const med=a=>{a=[...a].sort((x,y)=>x-y);return +a[Math.floor(a.length/2)].toFixed(3)};
const same=wA.filter(t=>t.sig===t.dir);
out.P3={chartStopMedPct:med(wA.map(t=>{const L=t.dir==='LONG';const sl=L?Math.min(t.e-1.5*t.atr,t.bot):Math.max(t.e+1.5*t.atr,t.top);return Math.abs(sl-t.e)/t.e*100;})),
 cardStopMedPct:med(same.map(t=>{const L=t.dir==='LONG';const sl=L?t.bot-0.5*t.atr:t.top+0.5*t.atr;return Math.abs(sl-t.e)/t.e*100;})),
 cardTp1MedPct:med(same.map(t=>{const L=t.dir==='LONG';const sl=L?t.bot-0.5*t.atr:t.top+0.5*t.atr;return Math.max(Math.abs(t.e-sl),t.atr)/t.e*100;}))};
let dis=0;for(const t of wA){const i=t.i;const z=(n,incl)=>{const s=d.slice(Math.max(0,i-n+(incl?1:0)),incl?i+1:i).map(b=>b.delta);const m=s.reduce((a,b)=>a+b,0)/s.length;const sd=Math.sqrt(s.reduce((a,b)=>a+(b-m)**2,0)/s.length)||1;return (d[i].delta-m)/sd;};
 const g60=t.dir==='LONG'?z(60,false)>=1:z(60,false)<=-1;const g100=Math.abs(z(100,true))>=1;if(g60!==g100)dis++;}out.P5_disagree=[dis,wA.length];
const cnt=a=>a.reduce((c,r)=>(c[r.k]=(c[r.k]||0)+1,c),{});
out.check_wsb_exits={markers:mc,mine:cnt(wAll)};out.check_mr_exits={markers:mrm,mine:cnt(rBall.map(t=>t.r))};
fs.writeFileSync('result.json',JSON.stringify(out,null,1));console.log(JSON.stringify(out,null,1));
