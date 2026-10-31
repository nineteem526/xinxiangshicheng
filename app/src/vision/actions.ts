export type Point = { x: number; y: number; z: number; visibility?: number };
export type Action = 'punch' | 'left' | 'right' | 'duck' | 'special' | 'ready';
export class ActionRecognizer {
  private baseline: {x:number; y:number; scale:number} | null = null;
  private prev: {t:number; wrists: [Point,Point]} | null = null;
  private last: Record<Action,number> = {punch:-Infinity,left:-Infinity,right:-Infinity,duck:-Infinity,special:-Infinity,ready:-Infinity};
  private armed = { punch:true, lean:true, duck:true, special:true, ready:true };
  private held = { special:0, ready:0 };
  reset() { this.baseline=null; this.prev=null; this.armed={punch:true,lean:true,duck:true,special:true,ready:true}; this.held={special:0,ready:0}; }
  update(p: Point[], t: number): {actions:Action[]; status:string} {
    const ids=[11,12,15,16,23,24];
    if (ids.some(i=>!p[i] || (p[i].visibility ?? 0)<0.55)) { this.prev=null; this.held={special:0,ready:0}; return {actions:[],status:'请确保肩、手和髋部完整入镜'}; }
    const [ls,rs,lw,rw,lh,rh]=ids.map(i=>p[i]);
    const x=(ls.x+rs.x+lh.x+rh.x)/4, y=(lh.y+rh.y)/2;
    const scale=Math.hypot(ls.x-rs.x,ls.y-rs.y);
    if(scale<0.06) return {actions:[],status:'请靠近摄像头'};
    if(!this.baseline) { this.baseline={x,y,scale}; this.prev={t,wrists:[lw,rw]}; return {actions:[],status:'已校准，站直后开始'}; }
    const b=this.baseline, dx=(x-b.x)/b.scale, dy=(y-b.y)/b.scale;
    const dt=this.prev ? Math.max(0.016,Math.min(.2,(t-this.prev.t)/1000)) : .2;
    const velocities=this.prev ? [lw,rw].map((w,i)=>Math.hypot(w.x-this.prev!.wrists[i].x,w.y-this.prev!.wrists[i].y)/b.scale/dt) : [0,0];
    this.prev={t,wrists:[lw,rw]};
    const actions:Action[]=[];
    const emit=(a:Action,cd:number)=>{if(t-this.last[a]>cd){actions.push(a);this.last[a]=t;}};
    const raised=lw.y<ls.y-.08 && rw.y<rs.y-.08;
    const ready=lw.y<lh.y && rw.y<rh.y && !raised;
    if(raised) { if(!this.held.special)this.held.special=t; if(this.armed.special && t-this.held.special>650){emit('special',1800);this.armed.special=false;} } else {this.held.special=0;this.armed.special=true;}
    if(ready){if(!this.held.ready)this.held.ready=t; if(this.armed.ready && t-this.held.ready>900){emit('ready',1800);this.armed.ready=false;}}else{this.held.ready=0;this.armed.ready=true;}
    const punch=!raised && velocities.some((v,i)=>v>2.3 && [lw,rw][i].y<y);
    if(punch && this.armed.punch){emit('punch',420);this.armed.punch=false;} else if(Math.max(...velocities)<.65)this.armed.punch=true;
    if(Math.abs(dx)>.45 && this.armed.lean){emit(dx<0?'left':'right',700);this.armed.lean=false;}else if(Math.abs(dx)<.2)this.armed.lean=true;
    if(dy>.32 && this.armed.duck){emit('duck',700);this.armed.duck=false;}else if(dy<.14)this.armed.duck=true;
    return {actions,status:`水平 ${dx.toFixed(2)} · 下蹲 ${dy.toFixed(2)} · 挥拳速度 ${Math.max(...velocities).toFixed(1)}`};
  }
}

