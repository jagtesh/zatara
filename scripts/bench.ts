import fs from 'node:fs';
import os from 'node:os';
import { processes } from './measure';
import { Harness, delay, until } from './harness';
async function main() {
  const h = new Harness(); const results: any[] = [];
  try {
    await h.ready();
    const shell = (await h.request({ type: 'launch', app: 'shell' })).id;
    const demo = (await h.request({ type: 'launch', app: 'demo' })).id;
    await h.attach(); await delay(500);
    const roots = [h.server.pid!, h.desktop!.pid!];
    async function measure(name: string, work: () => Promise<void>) {
      const start = performance.now(), frames = h.frames, bytes = h.bytes, before = processes(roots);
      await work(); const elapsedMs = performance.now() - start, after = processes(roots);
      results.push({ name, elapsedMs, frames: h.frames - frames, rawLocalSurfaceBytes: h.bytes - bytes, rssMiB: after.reduce((n,r) => n+r.rssKiB,0)/1024,
        cpuPercentOneCore: 100000 * (after.reduce((n,r)=>n+r.cpuSeconds,0) - before.reduce((n,r)=>n+r.cpuSeconds,0))/elapsedMs, processCount: after.length });
    }
    await measure('idle, shell + Pixel app', () => delay(3000));
    await measure('drag, 12 mouse updates per gesture', async () => {
      for (let i=0;i<4;i++) { const w=(await h.request({type:'inspect'})).state.windows.find((w:any)=>w.id===demo); await h.drag(w.x+130,w.y+18,i%2?-160:160,i%2?-70:70); }
    });
    const latencies: number[] = [];
    await measure('counter clicks', async () => {
      const w=(await h.request({type:'inspect'})).state.windows.find((w:any)=>w.id===demo);
      for(let i=0;i<10;i++){const next=h.nextFrame(), start=performance.now(); h.mouse('down',w.x+70,w.y+270); h.mouse('up',w.x+70,w.y+270); await next; latencies.push(performance.now()-start); await delay(60);}
    });
    await h.request({type:'action',id:shell,op:'focus'});
    await measure('50000 lines of shell output', async()=>{
      await h.request({type:'input',id:shell,event:{type:'text',text:"python3 -c 'for i in range(50000): print(i)'\r"}});
      await until(async()=>(await h.request({type:'screen',id:shell})).screen.rows.map((r:any[])=>r.map(c=>c.text).join('')).join('\n').includes('49999'));
    });
    await measure('idle after output',()=>delay(3000));
    const sorted=latencies.sort((a,b)=>a-b);
    const report={host:{platform:os.platform(),arch:os.arch(),release:os.release(),cpu:os.cpus()[0].model,node:process.version,pixel:'0.0.15',viewport:[h.width,h.height]},results,
      inputToCapturedFrameMs:{p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],samples:sorted.length,method:'native host frame callback'},
      caveats:['Native offscreen Pixel host, not a physical Ghostty display.','Raw local BGRA surface bytes are not SSH bandwidth.','Frame capture latency ends at the native host frame callback, not at the physical display.','RSS sum can double-count shared pages. CPU derives from ps accumulated process CPU time.'],serverMetrics:(await h.request({type:'inspect'})).metrics};
    fs.mkdirSync('.artifacts',{recursive:true});fs.writeFileSync('.artifacts/benchmark.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
  }finally{await h.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
