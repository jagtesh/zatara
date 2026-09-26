// Exercise the actual inline Kitty transport through a PTY. This emulates
// terminal capability replies; it neither opens nor automates Ghostty.
import * as pty from 'node-pty';
import fs from 'node:fs';
import { Harness, delay, until } from './harness';
async function main() {
  const h = new Harness(); let terminal: pty.IPty | undefined;
  try {
    await h.ready(); const id=(await h.request({type:'launch',app:'demo'})).id;
    terminal=pty.spawn(process.execPath,['dist/cli.js','attach','test'],{cwd:process.cwd(),cols:150,rows:44,env:{...process.env,ZATARA_RUNTIME:h.dir,TERM:'xterm-ghostty',TERM_PROGRAM:'ghostty',TERMINAL_BROWSER_FRAMES:'inline',NATIVE_SCROLL_HELPER:'/nonexistent'} as any});
    let bytes=0, frameStarts=0, buffer='', initial='';
    terminal.onData(data=>{
      bytes+=Buffer.byteLength(data);if(initial.length<12000)initial+=data;
      buffer+=data;
      if(buffer.includes('i=4207,a=q')) { terminal!.write('\x1b_Gi=4207;OK\x1b\\'); buffer=buffer.replace('i=4207,a=q','PROBED'); } let m:RegExpExecArray|null;
      while((m=/\x1b\[\?(\d+)\$p/.exec(buffer))){terminal!.write(`\x1b[?${m[1]};${m[1]==='1016'?'1':'2'}$y`);buffer=buffer.slice(0,m.index)+buffer.slice(m.index+m[0].length);}
      if(buffer.includes('\x1b[?u')){terminal!.write('\x1b[?27u');buffer=buffer.replace('\x1b[?u','');}
      if(buffer.includes('\x1b[16t')){terminal!.write('\x1b[6;18;8t');buffer=buffer.replace('\x1b[16t','');}
      if(buffer.includes('\x1b[14t')){terminal!.write('\x1b[4;792;1200t');buffer=buffer.replace('\x1b[14t','');}
      if(buffer.includes('\x1b[c')){terminal!.write('\x1b[?62;4;22c');buffer=buffer.replace('\x1b[c','');}
      frameStarts+=(data.match(/\x1b\[\?2026h/g)??[]).length;
      if(buffer.length>8192)buffer=buffer.slice(-128);
    });
    await until(async()=>(await h.request({type:'inspect'})).state.attached,10000);
    await delay(500); const baseline=bytes, idleStart=Date.now();await delay(2000);const idleBytes=bytes-baseline;
    const dragStart=bytes, frames=frameStarts, t=Date.now();
    for(let i=0;i<50;i++){await h.request({type:'action',id,op:'move',rect:{x:160+i*4,y:60+i*2,width:680,height:450}});await delay(20);}
    await delay(200);
    const report={transport:'inline Kitty over local PTY; emulated terminal replies',viewport:[1200,792],idle:{durationMs:Date.now()-idleStart-(Date.now()-t),bytes:idleBytes},drag:{durationMs:Date.now()-t,bytes:bytes-dragStart,frames:frameStarts-frames},totalBytes:bytes,caveat:'No real SSH connection, network shaping, or physical display. Measures actual encoded terminal bytes.'};
    fs.writeFileSync('.artifacts/terminal-bandwidth.json',JSON.stringify(report,null,2)+'\n'); console.log(JSON.stringify(report,null,2));
    terminal.kill('SIGHUP');await until(async()=>!(await h.request({type:'inspect'})).state.attached);
    const after=(await h.request({type:'inspect'})).state.windows.find((w:any)=>w.id===id);if(after.status!=='Running')throw new Error('App did not survive terminal hangup');
  }finally{terminal?.kill();await h.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
