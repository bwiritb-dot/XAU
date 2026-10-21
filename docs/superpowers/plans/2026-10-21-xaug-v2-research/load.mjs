import fs from 'fs'; import vm from 'vm';
const APP='C:/Users/00000/Downloads/Telegram Desktop/XAUG/XAUG/app.js';
export function loadApp(){
  const el=new Proxy(function(){},{get:(t,k)=>k==='style'||k==='classList'||k==='dataset'?new Proxy({}, {get:()=>()=>{} ,set:()=>true}):(k==='querySelector'?()=>el:(k==='querySelectorAll'?()=>[]:(typeof k==='string'&&/^(add|remove|append|set|insert|click|focus)/.test(k)?()=>{}:el))),set:()=>true,apply:()=>el});
  const doc={getElementById:()=>el,querySelector:()=>el,querySelectorAll:()=>[],addEventListener:()=>{},createElement:()=>el,body:el,readyState:'loading'};
  const ctx={document:doc,window:{addEventListener:()=>{}},console:{log(){},warn(){},error(){}},setInterval:()=>0,setTimeout:()=>0,clearInterval(){},Date,Math,JSON,Set,Map,parseFloat,isNaN,Number,String,Array,Object,Infinity,localStorage:{getItem:()=>null,setItem(){}},LightweightCharts:{}};
  ctx.globalThis=ctx; vm.createContext(ctx);
  const src=fs.readFileSync(APP,'utf8')+`
;globalThis.__api={calculateIndicators,calculateWSBOrderFlow,calculateBreakoutProbability,calculateMeanReversionProbability,isDeathZone,classifyCandleWick,
 run(data,strategy){activeStrategy=strategy;historicalTrades=[];wsbCurrentState=null;let m=[];candleSeries={setMarkers:x=>m=x};updateTradeMarkers(data);return m;}};`;
  vm.runInContext(src,ctx); return ctx.__api;
}
export function bars(){return JSON.parse(fs.readFileSync('klines.json')).map(k=>{const vol=parseFloat(k[5]);const takerBuy=parseFloat(k[9]||(vol*0.5));
 return {time:Math.floor(k[0]/1000),open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:vol,takerBuy,delta:2*takerBuy-vol};});}
