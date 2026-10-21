const out=[];let start=Date.UTC(2025,11,25);const end=Date.now();
while(start<end){const u=`https://fapi.binance.com/fapi/v1/klines?symbol=XAUUSDT&interval=15m&limit=1500&startTime=${start}`;
const r=await fetch(u);const a=await r.json();if(!Array.isArray(a)||!a.length){console.log('stop',a);break;}
out.push(...a);start=a[a.length-1][0]+900000;}
const fs=await import('fs');fs.writeFileSync('klines.json',JSON.stringify(out));
console.log(out.length,new Date(out[0][0]).toISOString(),new Date(out.at(-1)[0]).toISOString());
