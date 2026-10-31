import {useCallback,useEffect,useRef,useState} from 'react';
import {playSfx,unlockAudio} from './game/sfx';
import {captureFrame,requestLevel} from './game/api';
import type {Level} from './game/types';
import {useCamera} from './vision/useCamera'; import {useRemoteCamera} from './link/useRemoteCamera';import {PairPanel} from './link/PairPanel';import {usePose} from './vision/usePose';import type {Action} from './vision/actions';import {Arena} from './Arena';import './game2.css';
type Phase='idle'|'playing'|'win'|'lose';
const ACTION_ZH:Record<string,string>={punch:'挥拳',left:'向左侧身',right:'向右侧身',duck:'下蹲',special:'双手举高',ready:'准备姿势','—':'暂无'};
export default function Game2(){
 const cam=useCamera(), link=useRemoteCamera(cam.videoRef);const [cameraLarge,setCameraLarge]=useState(false);const [generated,setGenerated]=useState<Level|null>(null);const [scanStatus,setScanStatus]=useState('');const [scanning,setScanning]=useState(false);const [pair,setPair]=useState(false),[theme,setTheme]=useState<'lava'|'digital'>('lava');const [phase,setPhase]=useState<Phase>('idle');const [hp,setHp]=useState(100),[player,setPlayer]=useState(100),[energy,setEnergy]=useState(0),[time,setTime]=useState(75),[hit,setHit]=useState(0),[message,setMessage]=useState('站直并校准，然后举起双手准备');const [warning,setWarning]=useState(false);const state=useRef({phase,hp,player,energy,warning});state.current={phase,hp,player,energy,warning}; const dodged=useRef(false);
 const start=useCallback(()=>{unlockAudio();playSfx('start');setHp(100);setPlayer(100);setEnergy(0);setTime(75);setWarning(false);dodged.current=false;setPhase('playing');setMessage('挥拳攻击 · 侧身闪避');},[]);
 const action=useCallback((a:Action)=>{const s=state.current;if(a==='ready'&&s.phase==='idle'){start();return;} if(s.phase!=='playing')return;
 if(a==='punch'){playSfx('fist');setHp(v=>Math.max(0,v-5));setEnergy(v=>Math.min(100,v+9));setHit(v=>v+1);setMessage('命中！');}
 if((a==='left'||a==='right'||a==='duck')&&s.warning){dodged.current=true;playSfx('block');setEnergy(v=>Math.min(100,v+15));setMessage('闪避成功 · 能量 +15');}
 if(a==='special'){if(s.energy>=100){playSfx('special');setHp(v=>Math.max(0,v-35));setEnergy(0);setHit(v=>v+1);setMessage('现实封印！');}else setMessage('能量未满，继续攻击');}
 },[start]);
 const on=cam.status==='ready'||link.status==='live';const pose=usePose(cam.videoRef,on,action);
 useEffect(()=>{if(phase!=='playing')return;let resolveAttack: ReturnType<typeof setTimeout> | undefined;const clock=setInterval(()=>setTime(t=>Math.max(0,t-1)),1000);const attacks=setInterval(()=>{dodged.current=false;playSfx('wave');setWarning(true);setMessage('危险！侧身或下蹲');resolveAttack=setTimeout(()=>{if(!dodged.current){playSfx('hit');setPlayer(p=>Math.max(0,p-20));}setWarning(false);},2200);},9000);return()=>{clearInterval(clock);clearInterval(attacks);clearTimeout(resolveAttack);};},[phase]);
 useEffect(()=>{if(phase==='playing'&&hp<=0){playSfx('success');setPhase('win');setMessage('异常体已封印');}else if(phase==='playing'&&(player<=0||time<=0)){playSfx('failure');setPhase('lose');setMessage('现实防线崩坏');}},[hp,player,time,phase]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key===' '){e.preventDefault();if(state.current.phase!=='playing')start();else action('punch');}if(e.key==='ArrowLeft')action('left');if(e.key==='ArrowRight')action('right');if(e.key==='ArrowDown')action('duck');if(e.key==='f')action('special');};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[action,start]);
 const scan=async()=>{const image=cam.videoRef.current&&captureFrame(cam.videoRef.current,800);if(!image){setScanStatus('请先连接摄像头');return;}setScanning(true);setScanStatus('正在识别物品并生成设定…');const result=await requestLevel({image});setScanning(false);if(!result.ok){setGenerated(null);setScanStatus('扫描失败，继续使用本地预设：'+result.error);return;}const level=result.level;setGenerated(level);const text=(level.object+level.theme+level.story).toLowerCase();setTheme(/手机|电脑|电子|数字|网络|屏幕|phone|digital/.test(text)?'digital':'lava');setScanStatus('来源：'+(level.source==='ai'?'AI 生成':'手动输入')+' · '+level.object+' → '+level.fantasyName+'；场景匹配为两套本地模板之一');};
 const toggle=()=>{if(pair||link.status!=='off'){link.stop();setPair(false);}else{cam.stop();link.start();setPair(true);}};
 return <div className="game2"><Arena theme={theme} hit={hit} phase={phase}/><div className="g-shade"/><header className="g-header"><div><b>REALITY<span>GLITCH</span></b><small>2.0 / 现实崩坏</small></div><div className="g-controls"><button onClick={()=>void cam.start()}>本机摄像头</button><button onClick={toggle}>手机直连</button><button onClick={pose.calibrate}>重新校准</button><a href="?classic">原版</a></div></header>
 <div className={`g-camera ${cameraLarge ? "expanded" : ""}`}><div className="g-camera-head"><span>玩家画面 / 横屏</span><button onClick={()=>setCameraLarge(v=>!v)}>{cameraLarge?"缩小":"放大"}</button></div><video ref={cam.videoRef} muted playsInline/><div>{on?'摄像头在线':'等待摄像头'} · {pose.status}</div><small>{pose.detail}<br/>最近动作：{ACTION_ZH[pose.last] ?? pose.last}<br/>手机横放，肩膀、双手和髋部入镜</small></div>
 {pair&&<PairPanel status={link.status} code={link.code} facing={link.facing} error={link.error} onClose={()=>{link.stop();setPair(false);}}/>}
 <div className="g-top"><span>{generated?.fantasyName ?? (theme==='lava'?'熔核守卫':'数字病毒')}</span><div className="bar bossbar"><i style={{width:`${hp}%`}}/></div><strong>{time}</strong></div>
 {warning&&phase==='playing'&&<div className="g-warning">⚠ 冲击来袭 · 侧身闪避</div>}
 <div className="g-message">{message}</div><div className="g-bottom"><div>生命 <b>{player}</b><div className="bar"><i style={{width:`${player}%`}}/></div></div><div>封印能量 <b>{energy}%</b><div className="bar energy"><i style={{width:`${energy}%`}}/></div></div><p>挥拳攻击　/　侧身或下蹲闪避　/　双手举高终结</p></div>
 {phase!=='playing'&&<div className="g-overlay"><div className="g-card"><p className="eyebrow">REALITY BREACH // 体感战斗原型</p><h1>{phase==='win'?'封印成功':phase==='lose'?'现实崩坏':'现实，即将崩坏'}</h1><p>{phase==='idle'?'连接摄像头，站直后点击校准。挥拳攻击，侧身闪避，双手举高释放终结技。':'再次挑战异常体，守住现实边界。'}</p><div className="g-themes"><button className={theme==='lava'?'active':''} onClick={()=>{setTheme('lava');setGenerated(null);setScanStatus('');}}>01 熔核世界 · 本地预设</button><button className={theme==='digital'?'active':''} onClick={()=>{setTheme('digital');setGenerated(null);setScanStatus('');}}>02 数字世界 · 本地预设</button></div><button onClick={()=>void scan()} disabled={scanning || !on} className="g-scan">{scanning?"识别中…":"扫描现实物品"}</button>{scanStatus&&<p className="g-scan-status">{scanStatus}</p>}<button className="g-start" onClick={start} disabled={scanning}>开始战斗 →</button><small>调试备用：空格攻击 / 方向键闪避 / F 终结技</small></div></div>}
 </div>;
}





